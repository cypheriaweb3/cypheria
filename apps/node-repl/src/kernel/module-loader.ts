import fs from "node:fs"
import { builtinModules, createRequire, findPackageJSON } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import vm from "node:vm"

export interface ModuleContext {
  context: vm.Context
  kind: "module" | "package"
  isPackage?: boolean
}

export type ResolvedModule =
  | { kind: "builtin"; specifier: string }
  | { kind: "file"; path: string }
  | { kind: "package" | "esm-package"; path: string; specifier: string }

type ModuleNamespace = Record<string, unknown>

const builtinModuleSet = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
])
// The kernel transport itself writes JSONL over stdout/stderr, so exposing raw
// `process` would make it easy for user code to corrupt the stdio protocol.
// Keep this denylist narrow for now; if node_repl moves off stdio transport in
// the future, we can revisit whether `process` still needs to stay blocked.
const deniedBuiltinModules = new Set(["process", "node:process"])
const importResolveConditions = new Set(["node", "import"])

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function errorCode(err: unknown): unknown {
  return (err as { code?: unknown } | null)?.code
}

function toNodeBuiltinSpecifier(specifier: string): string {
  return specifier.startsWith("node:") ? specifier : `node:${specifier}`
}

function isDeniedBuiltin(specifier: string): boolean {
  const normalized = specifier.startsWith("node:") ? specifier.slice(5) : specifier
  return deniedBuiltinModules.has(specifier) || deniedBuiltinModules.has(normalized)
}

function canonicalizePath(value: string): string {
  try {
    return fs.realpathSync.native(value)
  } catch {
    return value
  }
}

function isModuleNotFoundError(err: unknown): boolean {
  const code = errorCode(err)
  return code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND"
}

function isEsmPackageFile(modulePath: string): boolean {
  const extension = path.extname(modulePath).toLowerCase()
  if (extension === ".mjs") {
    return true
  }
  if (extension !== ".js") {
    return false
  }

  const packageJsonPath = findPackageJSON(pathToFileURL(modulePath).href)
  return (
    packageJsonPath !== undefined &&
    JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).type === "module"
  )
}

function isWithinBaseNodeModules(base: string, resolvedPath: string): boolean {
  const nodeModulesRoot = path.resolve(canonicalizePath(base), "node_modules")
  const relative = path.relative(nodeModulesRoot, canonicalizePath(resolvedPath))
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function isExplicitRelativePathSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith(".\\") ||
    specifier.startsWith("..\\")
  )
}

function isFileUrlSpecifier(specifier: string): boolean {
  if (!specifier.startsWith("file:")) {
    return false
  }
  try {
    return new URL(specifier).protocol === "file:"
  } catch {
    return false
  }
}

function isPathSpecifier(specifier: string): boolean {
  if (!specifier || specifier.trim() !== specifier) {
    return false
  }
  return (
    isExplicitRelativePathSpecifier(specifier) ||
    path.isAbsolute(specifier) ||
    isFileUrlSpecifier(specifier)
  )
}

function isBarePackageSpecifier(specifier: string): boolean {
  if (!specifier || specifier.trim() !== specifier) {
    return false
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return false
  }
  if (specifier.startsWith("/") || specifier.startsWith("\\")) {
    return false
  }
  if (path.isAbsolute(specifier)) {
    return false
  }
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(specifier)) {
    return false
  }
  return !specifier.includes("\\")
}

function resolvePathSpecifier(
  specifier: string,
  referrerIdentifier: string | undefined,
  moduleContext: ModuleContext,
  isWithinModuleSearchBases: (resolvedPath: string) => boolean
): ResolvedModule {
  let candidate: string
  if (isFileUrlSpecifier(specifier)) {
    try {
      candidate = fileURLToPath(new URL(specifier))
    } catch (err) {
      throw new Error(`Failed to resolve module "${specifier}": ${errorMessage(err)}`)
    }
  } else {
    const baseDir =
      referrerIdentifier && path.isAbsolute(referrerIdentifier)
        ? path.dirname(referrerIdentifier)
        : process.cwd()
    candidate = path.isAbsolute(specifier) ? specifier : path.resolve(baseDir, specifier)
  }

  let resolvedPath: string
  try {
    resolvedPath = fs.realpathSync.native(candidate)
  } catch (err) {
    if (errorCode(err) === "ENOENT") {
      throw new Error(`Module not found: ${specifier}`)
    }
    throw new Error(`Failed to resolve module "${specifier}": ${errorMessage(err)}`)
  }

  let stats: fs.Stats
  try {
    stats = fs.statSync(resolvedPath)
  } catch (err) {
    if (errorCode(err) === "ENOENT") {
      throw new Error(`Module not found: ${specifier}`)
    }
    throw new Error(`Failed to inspect module "${specifier}": ${errorMessage(err)}`)
  }

  if (!stats.isFile()) {
    throw new Error(
      `Unsupported import specifier "${specifier}" in node_repl. Directory imports are not supported.`
    )
  }

  const extension = path.extname(resolvedPath).toLowerCase()
  if (extension !== ".js" && extension !== ".mjs") {
    throw new Error(
      `Unsupported import specifier "${specifier}" in node_repl. Only .js and .mjs files are supported.`
    )
  }
  if (moduleContext.isPackage && !isWithinModuleSearchBases(resolvedPath)) {
    throw new Error(
      `Unsupported import specifier "${specifier}" in node_repl. Packages may only import files within configured node_modules roots.`
    )
  }

  return { kind: "file", path: resolvedPath }
}

function importNativeResolved(resolved: ResolvedModule): Promise<ModuleNamespace> {
  if (resolved.kind === "builtin") {
    return import(resolved.specifier)
  }
  if (resolved.kind === "package") {
    return import(pathToFileURL(resolved.path).href)
  }
  throw new Error(`Unsupported module resolution kind: ${resolved.kind}`)
}

export interface ModuleLoader {
  readonly packageModuleContext: ModuleContext
  addModuleSearchBase(entry: string): void
  clearLocalFileModuleCaches(): void
  importResolved(resolved: ResolvedModule, referrerModuleContext: ModuleContext): Promise<unknown>
  resolveSpecifier(
    specifier: string,
    referrerIdentifier: string | undefined,
    moduleContext: ModuleContext
  ): ResolvedModule
  setImportMeta(
    meta: ImportMeta,
    mod: vm.SourceTextModule,
    moduleContext: ModuleContext,
    isMain?: boolean
  ): void
}

/**
 * Resolves and links user imports inside the REPL VM context. Bare package
 * specifiers resolve only within configured `node_modules` roots; ESM packages
 * are linked in a persistent package context, while local files are re-read on
 * every exec.
 */
export function createModuleLoader({
  context,
  cwd,
  moduleDirs,
}: {
  context: vm.Context
  cwd: string
  moduleDirs: string[]
}): ModuleLoader {
  const packageModuleContext: ModuleContext = Object.freeze({
    context,
    isPackage: true,
    kind: "package",
  })

  const moduleSearchBases: string[] = []
  const moduleSearchBaseSet = new Set<string>()
  const requireByBase = new Map<string, NodeJS.Require>()
  const linkedFileModules = new Map<string, vm.SourceTextModule>()
  const linkedFileModuleContexts = new WeakMap<vm.Module, ModuleContext>()
  const linkedNativeModules = new Map<string, Promise<vm.SyntheticModule>>()
  const linkedModuleLinkTails = new Map<vm.Context, Promise<unknown>>()
  const linkedModuleEvaluations = new Map<string, Promise<void>>()

  function normalizeModuleSearchBase(entry: string): string | null {
    const trimmed = entry.trim()
    if (!trimmed) {
      return null
    }
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed)
    return path.basename(resolved) === "node_modules" ? path.dirname(resolved) : resolved
  }

  function addModuleSearchBase(entry: string): void {
    const base = normalizeModuleSearchBase(entry)
    if (!base || moduleSearchBaseSet.has(base)) {
      return
    }
    moduleSearchBaseSet.add(base)
    const cwdIndex = moduleSearchBases.indexOf(cwd)
    if (cwdIndex === -1) {
      moduleSearchBases.push(base)
    } else {
      moduleSearchBases.splice(cwdIndex, 0, base)
    }
  }

  for (const entry of moduleDirs) {
    addModuleSearchBase(entry)
  }
  if (!moduleSearchBaseSet.has(cwd)) {
    moduleSearchBaseSet.add(cwd)
    moduleSearchBases.push(cwd)
  }

  function clearLocalFileModuleCaches(): void {
    const persistentPrefix = `${packageModuleContext.kind}:`
    for (const cache of [linkedFileModules, linkedModuleEvaluations]) {
      for (const key of cache.keys()) {
        if (!key.startsWith(persistentPrefix)) {
          cache.delete(key)
        }
      }
    }
  }

  function moduleCacheKey(moduleContext: ModuleContext, value: string): string {
    return `${moduleContext.kind}:${value}`
  }

  function isWithinModuleSearchBases(resolvedPath: string): boolean {
    return moduleSearchBases.some((base) => isWithinBaseNodeModules(base, resolvedPath))
  }

  function getRequireForBase(base: string): NodeJS.Require {
    let req = requireByBase.get(base)
    if (!req) {
      req = createRequire(path.join(base, "__node_repl__.cjs"))
      requireByBase.set(base, req)
    }
    return req
  }

  function resolveBareSpecifier(
    specifier: string,
    referrerIdentifier: string | undefined,
    moduleContext: ModuleContext
  ): ResolvedModule | null {
    let firstResolutionError: unknown = null
    const searchBases =
      moduleContext.isPackage && referrerIdentifier && path.isAbsolute(referrerIdentifier)
        ? [path.dirname(referrerIdentifier)]
        : moduleSearchBases

    for (const base of searchBases) {
      try {
        const resolved = getRequireForBase(base).resolve(specifier, {
          // Node accepts resolve conditions here although @types/node omits them.
          conditions: importResolveConditions,
        } as NodeJS.RequireResolveOptions)
        if (isWithinModuleSearchBases(resolved)) {
          if (isEsmPackageFile(resolved)) {
            return { kind: "esm-package", path: resolved, specifier }
          }
          return { kind: "package", path: resolved, specifier }
        }
        // Ignore resolutions that escape this base via parent node_modules lookup.
      } catch (err) {
        if (isModuleNotFoundError(err)) {
          continue
        }
        if (!firstResolutionError) {
          firstResolutionError = err
        }
      }
    }

    if (firstResolutionError) {
      throw firstResolutionError
    }
    return null
  }

  function resolveSpecifier(
    specifier: string,
    referrerIdentifier: string | undefined,
    moduleContext: ModuleContext
  ): ResolvedModule {
    if (specifier.startsWith("node:") || builtinModuleSet.has(specifier)) {
      if (isDeniedBuiltin(specifier)) {
        throw new Error(`Importing module "${specifier}" is not allowed in node_repl`)
      }
      return { kind: "builtin", specifier: toNodeBuiltinSpecifier(specifier) }
    }

    if (isPathSpecifier(specifier)) {
      return resolvePathSpecifier(
        specifier,
        referrerIdentifier,
        moduleContext,
        isWithinModuleSearchBases
      )
    }

    if (!isBarePackageSpecifier(specifier)) {
      throw new Error(
        `Unsupported import specifier "${specifier}" in node_repl. Use a package name like "lodash" or "@scope/pkg", or a relative/absolute/file:// .js/.mjs path.`
      )
    }

    const resolvedBare = resolveBareSpecifier(specifier, referrerIdentifier, moduleContext)
    if (!resolvedBare) {
      throw new Error(`Module not found: ${specifier}`)
    }
    return resolvedBare
  }

  function resolveResultToUrl(resolved: ResolvedModule): string {
    if (resolved.kind === "file") {
      return pathToFileURL(resolved.path).href
    }
    return resolved.specifier
  }

  function setImportMeta(
    meta: ImportMeta,
    mod: vm.SourceTextModule,
    moduleContext: ModuleContext,
    isMain = false
  ): void {
    meta.url = pathToFileURL(mod.identifier).href
    meta.filename = mod.identifier
    meta.dirname = path.dirname(mod.identifier)
    meta.main = isMain
    meta.resolve = (specifier: string) =>
      resolveResultToUrl(resolveSpecifier(specifier, mod.identifier, moduleContext))
  }

  function loadLinkedNativeModule(
    resolved: ResolvedModule,
    moduleContext: ModuleContext
  ): Promise<vm.SyntheticModule> {
    const key =
      resolved.kind === "builtin"
        ? moduleCacheKey(moduleContext, `builtin:${resolved.specifier}`)
        : moduleCacheKey(moduleContext, `package:${resolved.path}`)
    let modulePromise = linkedNativeModules.get(key)
    if (!modulePromise) {
      modulePromise = (async () => {
        const namespace = await importNativeResolved(resolved)
        const exportNames = Object.getOwnPropertyNames(namespace)
        return new vm.SyntheticModule(
          exportNames,
          function initSyntheticModule(this: vm.SyntheticModule) {
            for (const name of exportNames) {
              this.setExport(name, namespace[name])
            }
          },
          { context: moduleContext.context }
        )
      })()
      linkedNativeModules.set(key, modulePromise)
    }
    return modulePromise
  }

  function getOrCreateLinkedFileModule(
    modulePath: string,
    moduleContext: ModuleContext,
    createdFileModules: Map<string, vm.SourceTextModule>
  ): vm.SourceTextModule {
    const key = moduleCacheKey(moduleContext, modulePath)
    let module = linkedFileModules.get(key)
    if (!module) {
      const source = fs.readFileSync(modulePath).toString("utf8")
      module = new vm.SourceTextModule(source, {
        context: moduleContext.context,
        identifier: modulePath,
        initializeImportMeta(meta, mod) {
          setImportMeta(meta, mod, moduleContext, false)
        },
        importModuleDynamically(specifier, referrer) {
          return importResolved(
            resolveSpecifier(specifier, referrer?.identifier, moduleContext),
            moduleContext
          ) as Promise<vm.Module>
        },
      })
      linkedFileModules.set(key, module)
      linkedFileModuleContexts.set(module, moduleContext)
      createdFileModules.set(key, module)
    }

    return module
  }

  async function loadLinkedModule(
    resolved: ResolvedModule,
    moduleContext: ModuleContext,
    createdFileModules: Map<string, vm.SourceTextModule>
  ): Promise<vm.Module> {
    if (resolved.kind === "file" || resolved.kind === "esm-package") {
      const childModuleContext =
        resolved.kind === "esm-package" ? packageModuleContext : moduleContext
      return getOrCreateLinkedFileModule(resolved.path, childModuleContext, createdFileModules)
    }
    return loadLinkedNativeModule(resolved, moduleContext)
  }

  function loadLinkedFileModule(
    modulePath: string,
    moduleContext: ModuleContext
  ): Promise<vm.SourceTextModule> {
    const previousLinking = linkedModuleLinkTails.get(moduleContext.context) ?? Promise.resolve()
    const linking = previousLinking.then(async () => {
      const createdFileModules = new Map<string, vm.SourceTextModule>()
      const module = getOrCreateLinkedFileModule(modulePath, moduleContext, createdFileModules)
      try {
        if (module.status === "unlinked") {
          await module.link(async (specifier, referencingModule) => {
            const referencingModuleContext =
              linkedFileModuleContexts.get(referencingModule) ?? moduleContext
            const resolved = resolveSpecifier(
              specifier,
              referencingModule?.identifier,
              referencingModuleContext
            )
            return loadLinkedModule(resolved, referencingModuleContext, createdFileModules)
          })
        }
        return module
      } catch (error) {
        for (const [failedKey, failedModule] of createdFileModules) {
          if (linkedFileModules.get(failedKey) === failedModule) {
            linkedFileModules.delete(failedKey)
          }
        }
        throw error
      }
    })
    linkedModuleLinkTails.set(
      moduleContext.context,
      linking.catch(() => undefined)
    )
    return linking
  }

  async function importResolved(
    resolved: ResolvedModule,
    referrerModuleContext: ModuleContext
  ): Promise<unknown> {
    if (resolved.kind === "file" || resolved.kind === "esm-package") {
      const resolvedModuleContext =
        resolved.kind === "esm-package" ? packageModuleContext : referrerModuleContext
      const module = await loadLinkedFileModule(resolved.path, resolvedModuleContext)
      const key = moduleCacheKey(resolvedModuleContext, resolved.path)
      let evaluation = linkedModuleEvaluations.get(key)
      if (!evaluation) {
        evaluation = module.evaluate()
        linkedModuleEvaluations.set(key, evaluation)
      }
      await evaluation
      return module.namespace
    }
    return importNativeResolved(resolved)
  }

  return {
    packageModuleContext,
    addModuleSearchBase,
    clearLocalFileModuleCaches,
    importResolved,
    resolveSpecifier,
    setImportMeta,
  }
}
