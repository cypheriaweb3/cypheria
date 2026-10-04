import type { ESTree } from "meriyah"

export type { ESTree }

export type BindingKind = "const" | "let" | "var" | "function" | "class"

export interface Binding {
  name: string
  kind: BindingKind
}

export interface Replacement {
  start: number
  end: number
  text: string
}

/** A loosely typed AST node for generic traversal. */
export type AstNode = ESTree.Node & Record<string, unknown>

// Meriyah is always invoked with `ranges: true`, so every node has offsets.
export function startOf(node: ESTree.Node): number {
  return node.start as number
}

export function endOf(node: ESTree.Node): number {
  return node.end as number
}

export function sourceOf(code: string, node: ESTree.Node): string {
  return code.slice(startOf(node), endOf(node))
}

export function isAstNode(value: unknown): value is AstNode {
  return Boolean(value) && typeof value === "object" && typeof (value as AstNode).type === "string"
}

/** Calls `visit` for each direct child node of `node`, with its property key. */
export function forEachChild(node: AstNode, visit: (child: AstNode, key: string) => void): void {
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isAstNode(child)) visit(child, key)
      }
    } else if (isAstNode(value)) {
      visit(value, key)
    }
  }
}

export function applyReplacements(code: string, replacements: Replacement[]): string {
  let replacedCode = code
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    replacedCode =
      replacedCode.slice(0, replacement.start) +
      replacement.text +
      replacedCode.slice(replacement.end)
  }
  return replacedCode
}

function collectPatternNames(
  pattern: ESTree.Node | null | undefined,
  kind: string,
  map: Map<string, string>
): void {
  if (!pattern) return
  switch (pattern.type) {
    case "Identifier":
      if (!map.has(pattern.name)) map.set(pattern.name, kind)
      return
    case "ObjectPattern":
      for (const prop of pattern.properties ?? []) {
        if (prop.type === "Property") {
          collectPatternNames(prop.value, kind, map)
        } else if (prop.type === "RestElement") {
          collectPatternNames(prop.argument, kind, map)
        }
      }
      return
    case "ArrayPattern":
      for (const elem of pattern.elements ?? []) {
        if (!elem) continue
        if (elem.type === "RestElement") {
          collectPatternNames(elem.argument, kind, map)
        } else {
          collectPatternNames(elem, kind, map)
        }
      }
      return
    case "AssignmentPattern":
      collectPatternNames(pattern.left, kind, map)
      return
    case "RestElement":
      collectPatternNames(pattern.argument, kind, map)
      return
    default:
      return
  }
}

export function collectPatternBindingNames(pattern: ESTree.Node | null | undefined): string[] {
  const map = new Map<string, string>()
  collectPatternNames(pattern, "binding", map)
  return Array.from(map.keys())
}

function isVarDeclaration(
  node: ESTree.Node | null | undefined
): node is ESTree.VariableDeclaration {
  return node?.type === "VariableDeclaration" && node.kind === "var"
}

/**
 * Returns the `var` declaration hoisted from a top-level `for`, `for...in`, or
 * `for...of` statement head, if any.
 */
export function loopHeadVarDeclaration(stmt: ESTree.Statement): ESTree.VariableDeclaration | null {
  if (stmt.type === "ForStatement") {
    return isVarDeclaration(stmt.init) ? stmt.init : null
  }
  if (stmt.type === "ForInStatement" || stmt.type === "ForOfStatement") {
    return isVarDeclaration(stmt.left) ? stmt.left : null
  }
  return null
}

/** Collects top-level bindings declared by a cell, in declaration order. */
export function collectBindings(ast: ESTree.Program): Binding[] {
  const map = new Map<string, BindingKind>()
  const addPattern = (pattern: ESTree.Node, kind: BindingKind) => {
    for (const name of collectPatternBindingNames(pattern)) {
      if (!map.has(name)) map.set(name, kind)
    }
  }
  for (const stmt of ast.body ?? []) {
    if (stmt.type === "VariableDeclaration") {
      for (const decl of stmt.declarations) {
        addPattern(decl.id, stmt.kind)
      }
    } else if (stmt.type === "FunctionDeclaration" && stmt.id) {
      map.set(stmt.id.name, "function")
    } else if (stmt.type === "ClassDeclaration" && stmt.id) {
      map.set(stmt.id.name, "class")
    } else {
      for (const decl of loopHeadVarDeclaration(stmt)?.declarations ?? []) {
        addPattern(decl.id, "var")
      }
    }
  }
  return Array.from(map.entries()).map(([name, kind]) => ({ name, kind }))
}
