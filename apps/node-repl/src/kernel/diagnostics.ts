import {
  type AstNode,
  applyReplacements,
  type Binding,
  collectPatternBindingNames,
  type ESTree,
  forEachChild,
  type Replacement,
} from "./ast.ts"

const redactedDiagnosticSourceMaxLength = 16_384

export interface SourceToken {
  token: string
  start: number
  end: number
}

export interface SourceRange {
  start: number
  end: number
}

function redactTemplateToken(raw: string): string {
  if (raw.startsWith("`")) {
    return raw.endsWith("${") ? "`${" : "``"
  }
  return raw.endsWith("${") ? "}${" : "}`"
}

function collectRedactedDiagnosticBindingNames(
  ast: ESTree.Program,
  currentBindings: Binding[],
  priorBindings: Binding[]
): Set<string> {
  const bindingNames = new Set(
    [...currentBindings, ...priorBindings].map((binding) => binding.name)
  )

  const addPatternNames = (pattern: ESTree.Node | null | undefined) => {
    for (const name of collectPatternBindingNames(pattern)) {
      bindingNames.add(name)
    }
  }

  const visit = (node: AstNode) => {
    switch (node.type) {
      case "VariableDeclaration":
        for (const decl of node.declarations ?? []) {
          addPatternNames(decl.id)
        }
        break
      case "FunctionDeclaration":
      case "FunctionExpression":
        if (node.id) {
          bindingNames.add(node.id.name)
        }
        for (const param of node.params ?? []) {
          addPatternNames(param)
        }
        break
      case "ArrowFunctionExpression":
        for (const param of node.params ?? []) {
          addPatternNames(param)
        }
        break
      case "ClassDeclaration":
      case "ClassExpression":
        if (node.id) {
          bindingNames.add(node.id.name)
        }
        break
      case "CatchClause":
        addPatternNames(node.param)
        break
      default:
        break
    }

    forEachChild(node, visit)
  }

  visit(ast as AstNode)
  return bindingNames
}

function collectRedactedDiagnosticIdentifierStarts(
  ast: ESTree.Program,
  bindingNames: Set<string>
): Set<number> {
  const starts = new Set<number>()

  const visit = (node: AstNode, parent: AstNode | null = null, key: string | null = null) => {
    if (node.type === "Identifier" && bindingNames.has(node.name)) {
      const isMemberProperty =
        parent?.type === "MemberExpression" && key === "property" && parent.computed !== true
      const isPropertyKey =
        (parent?.type === "Property" || parent?.type === "MethodDefinition") &&
        key === "key" &&
        parent.computed !== true &&
        parent.shorthand !== true
      if (!isMemberProperty && !isPropertyKey) {
        starts.add(node.start as number)
      }
      return
    }

    forEachChild(node, (child, childKey) => visit(child, node, childKey))
  }

  visit(ast as AstNode)
  return starts
}

/**
 * Produces a shape-preserving copy of submitted code for diagnostics: user
 * binding names, string and template contents, regular expressions, and
 * comments are replaced so the source can be logged without leaking data.
 */
export function redactDiagnosticSource(
  code: string,
  ast: ESTree.Program,
  currentBindings: Binding[],
  priorBindings: Binding[],
  tokens: SourceToken[],
  comments: SourceRange[]
): string {
  const bindingNames = collectRedactedDiagnosticBindingNames(ast, currentBindings, priorBindings)
  const identifierStarts = collectRedactedDiagnosticIdentifierStarts(ast, bindingNames)
  const identifierNames = new Map<string, string>()
  const replacements: Replacement[] = []

  const identifierReplacement = (raw: string) => {
    let replacement = identifierNames.get(raw)
    if (!replacement) {
      replacement = `id${identifierNames.size}`
      identifierNames.set(raw, replacement)
    }
    return raw.startsWith("#") ? `#${replacement}` : replacement
  }

  for (const token of tokens) {
    const raw = code.slice(token.start, token.end)
    const range = { start: token.start, end: token.end }
    if (token.token === "Identifier" && identifierStarts.has(token.start)) {
      replacements.push({ ...range, text: identifierReplacement(raw) })
    } else if (token.token === "StringLiteral") {
      replacements.push({ ...range, text: '""' })
    } else if (token.token === "TemplateLiteral") {
      replacements.push({ ...range, text: redactTemplateToken(raw) })
    } else if (token.token === "RegularExpression") {
      replacements.push({ ...range, text: "/(?:)/" })
    }
  }

  for (const comment of comments) {
    replacements.push({ start: comment.start, end: comment.end, text: "/* */" })
  }

  const redacted = applyReplacements(code, replacements)
  if (redacted.length <= redactedDiagnosticSourceMaxLength) {
    return redacted
  }
  return `${redacted.slice(0, redactedDiagnosticSourceMaxLength)}\n/* truncated */`
}
