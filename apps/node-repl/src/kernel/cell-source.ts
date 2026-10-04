import { parseModule } from "meriyah"
import {
  type AstNode,
  applyReplacements,
  type Binding,
  type BindingKind,
  collectBindings,
  collectPatternBindingNames,
  type ESTree,
  endOf,
  forEachChild,
  loopHeadVarDeclaration,
  type Replacement,
  sourceOf,
  startOf,
} from "./ast.ts"
import { redactDiagnosticSource, type SourceRange, type SourceToken } from "./diagnostics.ts"

// REPL state model:
// - Every exec is compiled as a fresh ESM "cell".
// - The previous cell's module namespace is imported as `@prev`.
// - `priorBindings` tracks which top-level names should be carried forward.
// Each new cell imports a synthetic view of the previous namespace and
// redeclares those names so user variables behave like a persistent REPL.

export interface CellSourceOptions {
  /** Bindings exported by the last committed cell; empty for the first cell. */
  priorBindings: Binding[]
  /** Returns a fresh internal identifier that user code is unlikely to spell. */
  nextInternalBindingName: () => string
}

export interface CellSource {
  source: string
  redactedSource: string
  currentBindings: Binding[]
  nextBindings: Binding[]
  priorBindings: Binding[]
  warnedConstNames: Set<string>
}

const parseOptions = {
  next: true,
  module: true,
  ranges: true,
  loc: false,
  webcompat: false,
} as const

const isFunctionNode = (
  node: ESTree.Node
): node is
  | ESTree.FunctionDeclaration
  | ESTree.FunctionExpression
  | ESTree.ArrowFunctionExpression =>
  node.type === "FunctionDeclaration" ||
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression"

const isForInOrOf = (node: ESTree.Node): node is ESTree.ForInStatement | ESTree.ForOfStatement =>
  node.type === "ForInStatement" || node.type === "ForOfStatement"

function collectReassignedConstNames(
  ast: ESTree.Program,
  priorBindings: Binding[],
  currentBindingNames: Set<string>
): Set<string> {
  const priorConstNames = new Set(
    priorBindings
      .filter((binding) => binding.kind === "const" && !currentBindingNames.has(binding.name))
      .map((binding) => binding.name)
  )
  const reassignedNames = new Set<string>()

  const visit = (node: AstNode, shadowedNames: Set<string>): void => {
    if (node.type === "BlockStatement") {
      const blockShadowedNames = new Set(shadowedNames)
      for (const statement of node.body ?? []) {
        if (statement.type === "VariableDeclaration" && statement.kind !== "var") {
          for (const declaration of statement.declarations ?? []) {
            for (const name of collectPatternBindingNames(declaration.id)) {
              blockShadowedNames.add(name)
            }
          }
        } else if (
          (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") &&
          statement.id
        ) {
          blockShadowedNames.add(statement.id.name)
        }
      }
      for (const statement of node.body ?? []) {
        visit(statement as AstNode, blockShadowedNames)
      }
      return
    }

    if (isFunctionNode(node)) {
      const functionShadowedNames = new Set(shadowedNames)
      if (node.type !== "ArrowFunctionExpression" && node.id) {
        functionShadowedNames.add(node.id.name)
      }
      for (const parameter of node.params ?? []) {
        for (const name of collectPatternBindingNames(parameter)) {
          functionShadowedNames.add(name)
        }
      }
      visit(node.body as AstNode, functionShadowedNames)
      return
    }

    if (
      isForInOrOf(node) &&
      node.left?.type === "VariableDeclaration" &&
      node.left.kind !== "var"
    ) {
      const loopShadowedNames = new Set(shadowedNames)
      for (const declaration of node.left.declarations ?? []) {
        for (const name of collectPatternBindingNames(declaration.id)) {
          loopShadowedNames.add(name)
        }
      }
      visit(node.right as AstNode, shadowedNames)
      visit(node.left as AstNode, loopShadowedNames)
      visit(node.body as AstNode, loopShadowedNames)
      return
    }

    const target =
      node.type === "AssignmentExpression" ||
      (isForInOrOf(node) && node.left?.type !== "VariableDeclaration")
        ? (node.left as ESTree.Node)
        : node.type === "UpdateExpression"
          ? node.argument
          : null

    for (const name of collectPatternBindingNames(target)) {
      if (priorConstNames.has(name) && !shadowedNames.has(name)) {
        reassignedNames.add(name)
      }
    }

    forEachChild(node, (child) => visit(child, shadowedNames))
  }

  visit(ast as AstNode, new Set())

  return reassignedNames
}

function buildMarkCommittedExpression(names: string[], markCommittedFnName: string): string {
  const serializedNames = names.map((name) => JSON.stringify(name)).join(", ")
  return `(${markCommittedFnName}(${serializedNames}), undefined)`
}

function collectHoistedVarDeclarationStarts(ast: ESTree.Program): Map<string, number> {
  const varDeclarationStarts = new Map<string, number>()

  const recordVarDeclarationStarts = (declaration: ESTree.VariableDeclarator) => {
    for (const name of collectPatternBindingNames(declaration.id)) {
      const existingStart = varDeclarationStarts.get(name)
      if (existingStart === undefined || startOf(declaration) < existingStart) {
        varDeclarationStarts.set(name, startOf(declaration))
      }
    }
  }

  for (const stmt of ast.body ?? []) {
    const varDeclaration =
      stmt.type === "VariableDeclaration" && stmt.kind === "var"
        ? stmt
        : loopHeadVarDeclaration(stmt)
    for (const declaration of varDeclaration?.declarations ?? []) {
      recordVarDeclarationStarts(declaration)
    }
  }

  return varDeclarationStarts
}

class CellInstrumenter {
  constructor(
    private readonly code: string,
    private readonly markCommittedFnName: string,
    private readonly nextInternalBindingName: () => string
  ) {}

  // Failed-cell hoisted tracking intentionally stays small here. We only mark
  // direct top-level writes to future `var` bindings, plus top-level
  // declaration-site markers handled later in `instrumentCurrentBindings`.
  // We do not recurse through nested statement structure because that quickly
  // requires real lexical-scope tracking for blocks, loop scopes, catch
  // bindings, and similar shadowing cases. Supported write recovery is limited
  // to direct top-level expression statements such as `x = 1`, `x += 1`,
  // `x++`, and logical assignments.
  collectFutureVarWriteReplacements(
    ast: ESTree.Program,
    helperDeclarations: string[]
  ): Replacement[] {
    const { code, markCommittedFnName } = this
    const varDeclarationStarts = collectHoistedVarDeclarationStarts(ast)
    if (varDeclarationStarts.size === 0) {
      return []
    }
    const replacements: Replacement[] = []
    const replacementKeys = new Set<string>()

    const addReplacement = (node: ESTree.Node, text: string) => {
      const key = `${startOf(node)}:${endOf(node)}`
      if (!replacementKeys.has(key)) {
        replacementKeys.add(key)
        replacements.push({ start: startOf(node), end: endOf(node), text })
      }
    }

    const getFutureVarName = (identifier: ESTree.Node): string | null => {
      if (identifier.type !== "Identifier") {
        return null
      }
      const declarationStart = varDeclarationStarts.get(identifier.name)
      if (declarationStart === undefined || startOf(identifier) >= declarationStart) {
        return null
      }
      return identifier.name
    }

    const instrumentUpdateExpression = (node: ESTree.UpdateExpression) => {
      const bindingName = getFutureVarName(node.argument)
      if (!bindingName) {
        return
      }
      addReplacement(
        node,
        `(${markCommittedFnName}(${JSON.stringify(bindingName)}), ${sourceOf(code, node)})`
      )
    }

    const instrumentAssignmentExpression = (node: ESTree.AssignmentExpression) => {
      if (node.left.type !== "Identifier") {
        return
      }
      const bindingName = getFutureVarName(node.left)
      if (!bindingName) {
        return
      }
      const name = node.left.name
      const marker = buildMarkCommittedExpression([bindingName], markCommittedFnName)

      if (node.operator === "&&=" || node.operator === "||=" || node.operator === "??=") {
        const helperName = this.nextInternalBindingName()
        helperDeclarations.push(`let ${helperName};`)
        const shortCircuitOperator = node.operator.slice(0, -1)
        addReplacement(
          node,
          `((${helperName} = ${name}), ${helperName} ${shortCircuitOperator} ((${name} = ${sourceOf(code, node.right)}), ${marker}, ${name}))`
        )
        return
      }

      addReplacement(node, `((${sourceOf(code, node)}), ${marker}, ${name})`)
    }

    for (const statement of ast.body ?? []) {
      if (statement.type !== "ExpressionStatement") {
        continue
      }

      // Meriyah drops parentheses unless `preserveParens` is set.
      const expression = statement.expression
      if (expression.type === "UpdateExpression" && expression.argument.type === "Identifier") {
        instrumentUpdateExpression(expression)
      } else if (expression.type === "AssignmentExpression") {
        instrumentAssignmentExpression(expression)
      }
    }

    return replacements
  }

  private instrumentVariableDeclarationSource(declaration: ESTree.VariableDeclaration): string {
    const { code } = this
    const first = declaration.declarations[0]
    const last = declaration.declarations.at(-1)
    if (!first || !last) {
      return sourceOf(code, declaration)
    }

    const prefix = code.slice(startOf(declaration), startOf(first))
    const suffix = code.slice(endOf(last), endOf(declaration))
    const parts: string[] = []

    for (const decl of declaration.declarations) {
      parts.push(sourceOf(code, decl))

      const names = collectPatternBindingNames(decl.id)
      if (names.length > 0) {
        const helperName = this.nextInternalBindingName()
        parts.push(
          `${helperName} = ${buildMarkCommittedExpression(names, this.markCommittedFnName)}`
        )
      }
    }

    return `${prefix}${parts.join(", ")}${suffix}`
  }

  private instrumentLoopBody(body: ESTree.Statement, names: string[], guardName: string): string {
    const marker = `if (${guardName}) { ${guardName} = false; ${this.markCommittedFnName}(${names
      .map((name) => JSON.stringify(name))
      .join(", ")}); }`
    const bodyCode = sourceOf(this.code, body)

    if (body.type === "BlockStatement") {
      return `{ ${marker}${bodyCode.slice(1)}`
    }

    return `{ ${marker} ${bodyCode} }`
  }

  instrumentCurrentBindings(ast: ESTree.Program, currentBindings: Binding[]): string {
    const { code, markCommittedFnName } = this
    if (currentBindings.length === 0) {
      return code
    }

    const replacements: Replacement[] = []
    const replace = (stmt: ESTree.Node, text: string) =>
      replacements.push({ start: startOf(stmt), end: endOf(stmt), text })

    for (const stmt of ast.body ?? []) {
      if (stmt.type === "VariableDeclaration") {
        replace(stmt, this.instrumentVariableDeclarationSource(stmt))
        continue
      }

      if ((stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration") && stmt.id) {
        // Keep function source text stable for things like `foo.toString()`.
        // Pre-declaration uses are tracked separately by instrumenting the
        // top-level expressions that actually read the hoisted function value.
        replace(
          stmt,
          `${sourceOf(code, stmt)}\n;${markCommittedFnName}(${JSON.stringify(stmt.id.name)});`
        )
        continue
      }

      if (stmt.type === "ForStatement" && stmt.init?.type === "VariableDeclaration") {
        const init = loopHeadVarDeclaration(stmt)
        if (init) {
          replace(
            stmt,
            `${code.slice(startOf(stmt), startOf(init))}${this.instrumentVariableDeclarationSource(
              init
            )}${code.slice(endOf(init), endOf(stmt))}`
          )
        }
        continue
      }

      const loopVar = isForInOrOf(stmt) ? loopHeadVarDeclaration(stmt) : null
      if (isForInOrOf(stmt) && loopVar) {
        const names = loopVar.declarations.flatMap((decl) => collectPatternBindingNames(decl.id))
        if (names.length > 0) {
          const guardName = this.nextInternalBindingName()
          // Mark top-level `for...in` / `for...of` vars on the first body
          // execution instead of every iteration. This keeps hot loops cheap
          // after the first pass while still preserving vars for the common
          // case where the loop actually ran before a later throw.
          //
          // The tradeoff is that `for (var x of []) {}` in a failed cell will
          // not carry `x` forward as `undefined`, because the body never runs
          // and the one-time marker never fires. We accept that edge case:
          // `var` is redeclarable, and the only lost state is an unassigned
          // `undefined` from an empty top-level loop in a cell that later
          // fails.
          replace(
            stmt,
            `let ${guardName} = true;\n${code.slice(startOf(stmt), startOf(stmt.body))}${this.instrumentLoopBody(
              stmt.body,
              names,
              guardName
            )}`
          )
        }
      }
    }

    return applyReplacements(code, replacements)
  }
}

/**
 * Compiles a submitted snippet into an ES module cell that recreates carried
 * bindings, records which bindings were committed before any failure, and
 * exports the merged binding set for the next cell.
 */
export function buildModuleSource(code: string, options: CellSourceOptions): CellSource {
  const { priorBindings, nextInternalBindingName } = options
  const diagnosticTokens: SourceToken[] = []
  const diagnosticComments: SourceRange[] = []
  const ast = parseModule(code, {
    ...parseOptions,
    onToken(token, start, end) {
      diagnosticTokens.push({ token, start, end })
    },
    onComment(_kind, _value, start, end) {
      diagnosticComments.push({ start, end })
    },
  })
  const currentBindings = collectBindings(ast)
  const currentBindingNames = new Set(currentBindings.map((binding) => binding.name))
  const reassignedConstNames = collectReassignedConstNames(ast, priorBindings, currentBindingNames)
  const warnedConstNames = new Set(reassignedConstNames)
  for (const binding of currentBindings) {
    if (
      binding.kind === "const" &&
      priorBindings.some((prior) => prior.name === binding.name && prior.kind === "const")
    ) {
      warnedConstNames.add(binding.name)
    }
  }
  const carriedBindings = priorBindings.filter((binding) => !currentBindingNames.has(binding.name))
  const redactedSource = redactDiagnosticSource(
    code,
    ast,
    currentBindings,
    priorBindings,
    diagnosticTokens,
    diagnosticComments
  )
  const markCommittedFnName = nextInternalBindingName()
  const markPreludeCompletedFnName = nextInternalBindingName()
  const helperDeclarations = [
    // `import.meta` is syntax-level and cannot be shadowed by user bindings
    // like `const globalThis = ...`, so alias the marker helper through it
    // once in the prelude and use that stable local binding everywhere.
    // Then delete the raw import.meta hooks so user code cannot spoof
    // committed bindings by calling them directly.
    `const ${markCommittedFnName} = import.meta.__codexInternalMarkCommittedBindings;`,
    `const ${markPreludeCompletedFnName} = import.meta.__codexInternalMarkPreludeCompleted;`,
    "delete import.meta.__codexInternalMarkCommittedBindings;",
    "delete import.meta.__codexInternalMarkPreludeCompleted;",
  ]
  const writeInstrumentedCode = applyReplacements(
    code,
    new CellInstrumenter(
      code,
      markCommittedFnName,
      nextInternalBindingName
    ).collectFutureVarWriteReplacements(ast, helperDeclarations)
  )
  const instrumentedAst = parseModule(writeInstrumentedCode, parseOptions)
  const instrumentedCode = new CellInstrumenter(
    writeInstrumentedCode,
    markCommittedFnName,
    nextInternalBindingName
  ).instrumentCurrentBindings(instrumentedAst, currentBindings)

  let prelude = ""
  if (carriedBindings.length > 0) {
    // Recreate carried bindings before running user code in this new cell.
    prelude += 'import * as __prev from "@prev";\n'
    prelude += carriedBindings
      .map((b) => {
        let keyword = "let"
        if (b.kind === "var") {
          keyword = "var"
        } else if (b.kind === "const" && !reassignedConstNames.has(b.name)) {
          keyword = "const"
        }
        return `${keyword} ${b.name} = __prev.${b.name};`
      })
      .join("\n")
    prelude += "\n"
  }
  prelude += `${helperDeclarations.join("\n")}\n`
  prelude += `${markPreludeCompletedFnName}();\n`

  const mergedBindings = new Map<string, BindingKind>()
  for (const binding of [...priorBindings, ...currentBindings]) {
    mergedBindings.set(binding.name, binding.kind)
  }
  // Export the merged binding set so the next cell can import it through @prev.
  const exportNames = Array.from(mergedBindings.keys())
  const exportStmt = exportNames.length ? `\nexport { ${exportNames.join(", ")} };` : ""

  return {
    source: `${prelude}${instrumentedCode}${exportStmt}`,
    redactedSource,
    currentBindings,
    nextBindings: Array.from(mergedBindings, ([name, kind]) => ({ name, kind })),
    priorBindings,
    warnedConstNames,
  }
}
