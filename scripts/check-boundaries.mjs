#!/usr/bin/env node

import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const PURE_SOURCE_EXTENSIONS = new Set([".ts"]);

const PURE_AREA_PREFIXES = [
  ["history/domain", "history/domain"],
  ["domain", "domain"],
  ["engine", "engine"],
  ["ghosts", "ghosts"],
  ["levels", "levels"],
];

// This acyclic matrix is intentionally explicit. Adapters/applications compose
// these capabilities; pure packages do not reach sideways through adapters.
const PURE_IMPORT_MATRIX = new Map([
  ["domain", new Set(["domain"])],
  ["engine", new Set(["domain", "engine"])],
  ["ghosts", new Set(["domain", "engine", "ghosts"])],
  ["levels", new Set(["domain", "engine", "levels"])],
  ["history/domain", new Set(["domain", "engine", "history/domain"])],
]);

// External dependencies are denied by default. A domain-neutral package must be
// reviewed and added here explicitly, which prevents an unknown browser/cloud
// SDK from bypassing a necessarily finite prohibited-package list.
const ALLOWED_PURE_EXTERNAL_PACKAGES = new Set(["zod"]);

const PROHIBITED_EXTERNAL_PACKAGES = new Map([
  ["@angular/", "UI framework"],
  ["@firebase/", "cloud/browser SDK"],
  ["@pixi/", "rendering SDK"],
  ["@reduxjs/toolkit", "framework state"],
  ["@sentry/", "browser/telemetry SDK"],
  ["@supabase/supabase-js", "cloud/browser SDK"],
  ["@xstate/", "framework state"],
  ["dexie", "browser persistence SDK"],
  ["firebase", "cloud/browser SDK"],
  ["history", "browser-history SDK"],
  ["idb", "browser persistence SDK"],
  ["jotai", "framework state"],
  ["lit", "UI framework"],
  ["localforage", "browser persistence SDK"],
  ["mobx", "framework state"],
  ["mobx-", "framework state"],
  ["phaser", "rendering SDK"],
  ["pinia", "framework state"],
  ["pixi.js", "rendering SDK"],
  ["preact", "UI framework"],
  ["react", "UI framework"],
  ["react-dom", "UI framework"],
  ["recoil", "framework state"],
  ["redux", "framework state"],
  ["solid-js", "UI framework"],
  ["svelte", "UI framework"],
  ["three", "rendering SDK"],
  ["vue", "UI framework"],
  ["workbox-", "browser service-worker SDK"],
  ["xstate", "framework state"],
  ["zustand", "framework state"],
]);

const AMBIENT_RUNTIME_BOUNDARIES = new Map([
  ["Atomics", "shared-memory scheduling"],
  ["BroadcastChannel", "cross-context messaging"],
  ["Bun", "host runtime state"],
  ["Date", "wall-clock and host date parsing state"],
  ["Deno", "host runtime state"],
  ["EventSource", "network input"],
  ["Function", "runtime code generation"],
  ["FinalizationRegistry", "garbage-collection timing"],
  ["Intl", "host locale/timezone data"],
  ["SharedArrayBuffer", "shared-memory scheduling"],
  ["SharedWorker", "cross-context scheduling"],
  ["WeakRef", "garbage-collection timing"],
  ["WebSocket", "network input"],
  ["Worker", "cross-context scheduling"],
  ["XMLHttpRequest", "network input"],
  ["caches", "browser persistence state"],
  ["cancelAnimationFrame", "render-loop scheduling"],
  ["clearInterval", "wall-clock scheduling"],
  ["clearTimeout", "wall-clock scheduling"],
  ["crypto", "host cryptography and randomness state"],
  ["document", "browser UI state"],
  ["eval", "runtime code generation"],
  ["fetch", "network input"],
  ["history", "browser history state"],
  ["indexedDB", "browser persistence state"],
  ["localStorage", "browser persistence state"],
  ["location", "browser navigation state"],
  ["navigator", "host/browser state"],
  ["performance", "wall-clock timing"],
  ["process", "host runtime state"],
  ["queueMicrotask", "host scheduling"],
  ["requestAnimationFrame", "render-loop scheduling"],
  ["self", "host/browser state"],
  ["sessionStorage", "browser persistence state"],
  ["setInterval", "wall-clock scheduling"],
  ["setTimeout", "wall-clock scheduling"],
  ["window", "browser UI state"],
]);

const NONDETERMINISTIC_MEMBER_PATHS = new Map([
  ["Date.now", "wall-clock time"],
  ["Math.random", "unseeded randomness"],
  ["crypto.getRandomValues", "host randomness"],
  ["crypto.randomUUID", "host randomness"],
]);

const SENSITIVE_GLOBAL_OBJECTS = new Set(["Math", "globalThis"]);
const LOCALE_SENSITIVE_MEMBERS = new Set([
  "localeCompare",
  "toLocaleDateString",
  "toLocaleString",
  "toLocaleTimeString",
]);
const TYPESCRIPT_DEFAULT_LIBRARY_ROOT = path.dirname(
  ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2022 }),
);

function isTypeScriptDefaultLibraryDeclaration(declaration) {
  const source = declaration.getSourceFile();
  return (
    source.isDeclarationFile &&
    isWithin(TYPESCRIPT_DEFAULT_LIBRARY_ROOT, source.fileName) &&
    /^lib(?:\.[^.]+)*\.d\.ts$/u.test(path.basename(source.fileName))
  );
}

function pragmaEntries(sourceFile, name) {
  const pragma = sourceFile.pragmas?.get(name);
  if (pragma === undefined) {
    return [];
  }
  return Array.isArray(pragma) ? pragma : [pragma];
}

function standardLibraryMemberSymbol(node, memberName, checker) {
  const symbol = ts.isPropertyAccessExpression(node)
    ? checker.getSymbolAtLocation(node.name)
    : checker.getTypeAtLocation(node.expression).getProperty(memberName);
  return symbol?.declarations?.some(isTypeScriptDefaultLibraryDeclaration)
    ? symbol
    : undefined;
}

// These integer-oriented operations are the only Math capabilities admitted to
// canonical code. Transcendental functions may differ at the last bit across
// engines and are therefore excluded alongside Math.random.
const ALLOWED_MATH_MEMBERS = new Set([
  "abs",
  "ceil",
  "clz32",
  "floor",
  "imul",
  "max",
  "min",
  "round",
  "sign",
  "trunc",
]);

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function isWithin(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

function pureArea(filePath, sourceRoot) {
  if (!isWithin(sourceRoot, filePath)) {
    return undefined;
  }

  const relativePath = toPosix(path.relative(sourceRoot, filePath));
  if (relativePath === "build-status.ts") {
    return "domain";
  }
  for (const [area, prefix] of PURE_AREA_PREFIXES) {
    if (relativePath === prefix || relativePath.startsWith(`${prefix}/`)) {
      return area;
    }
  }
  return undefined;
}

async function collectSourceFiles(directoryPath, repositoryRoot) {
  try {
    const directoryStats = await lstat(directoryPath);
    if (directoryStats.isSymbolicLink()) {
      throw new Error(
        `[BOUNDARY_SOURCE_SYMLINK] ${toPosix(path.relative(repositoryRoot, directoryPath))} is a symlink; src must be a physical tree`,
      );
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `[BOUNDARY_SOURCE_SYMLINK] ${toPosix(path.relative(repositoryRoot, entryPath))} is a symlink; src must be a physical tree`,
      );
    }
    if (entry.name.startsWith(".")) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath, repositoryRoot)));
      continue;
    }

    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}

function diagnosticMessage(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

function defaultCompilerOptions(repositoryRoot) {
  return {
    allowJs: true,
    baseUrl: repositoryRoot,
    jsx: ts.JsxEmit.Preserve,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
  };
}

function loadCompilerContexts(repositoryRoot) {
  const configPath = ts.findConfigFile(
    repositoryRoot,
    ts.sys.fileExists,
    "tsconfig.json",
  );
  if (!configPath) {
    return [
      {
        fileNames: new Set(),
        options: defaultCompilerOptions(repositoryRoot),
      },
    ];
  }

  const contexts = [];
  const visited = new Set();

  function visitConfig(currentConfigPath) {
    const absoluteConfigPath = path.resolve(currentConfigPath);
    if (visited.has(absoluteConfigPath)) {
      return;
    }
    visited.add(absoluteConfigPath);

    const config = ts.readConfigFile(absoluteConfigPath, ts.sys.readFile);
    if (config.error) {
      throw new Error(
        `Unable to read ${toPosix(path.relative(repositoryRoot, absoluteConfigPath))}: ${diagnosticMessage(config.error)}`,
      );
    }

    const parsed = ts.parseJsonConfigFileContent(
      config.config,
      ts.sys,
      path.dirname(absoluteConfigPath),
      undefined,
      absoluteConfigPath,
    );
    if (parsed.errors.length > 0) {
      const messages = parsed.errors.map(diagnosticMessage).join("\n");
      throw new Error(
        `Unable to parse ${toPosix(path.relative(repositoryRoot, absoluteConfigPath))}:\n${messages}`,
      );
    }

    contexts.push({
      fileNames: new Set(
        parsed.fileNames.map((fileName) => path.resolve(fileName)),
      ),
      options: parsed.options,
    });
    for (const reference of parsed.projectReferences ?? []) {
      visitConfig(ts.resolveProjectReferencePath(reference));
    }
  }

  visitConfig(configPath);
  contexts.push({
    fileNames: new Set(),
    options: defaultCompilerOptions(repositoryRoot),
  });
  return contexts;
}

function matchingCompilerContexts(compilerContexts, importerPath) {
  const absoluteImporterPath = path.resolve(importerPath);
  const matching = compilerContexts.filter(({ fileNames }) =>
    fileNames.has(absoluteImporterPath),
  );
  return matching.length > 0 ? matching : compilerContexts;
}

function scriptKind(filePath) {
  switch (path.extname(filePath)) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".tsx":
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
}

function moduleReferences(sourceFile, checker) {
  const references = [];

  function record(node, expression, syntax) {
    if (expression && ts.isStringLiteralLike(expression)) {
      references.push({ node: expression, specifier: expression.text, syntax });
      return;
    }
    references.push({ node, specifier: undefined, syntax });
  }

  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      record(node, node.moduleSpecifier, "import");
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      record(node, node.moduleSpecifier, "export-from");
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(node, node.moduleReference.expression, "import-equals");
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        record(node, node.arguments[0], "dynamic-import");
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === "require" &&
        !isLocallyDeclared(node.expression, checker, sourceFile)
      ) {
        record(node, node.arguments[0], "require");
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
}

function localAliasTarget(specifier, repositoryRoot) {
  if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
    return path.resolve(repositoryRoot, "src", specifier.slice(2));
  }
  if (specifier === "src" || specifier.startsWith("src/")) {
    return path.resolve(repositoryRoot, specifier);
  }
  return undefined;
}

function aliasPatternMatches(specifier, pattern) {
  const starIndex = pattern.indexOf("*");
  if (starIndex === -1) {
    return specifier === pattern;
  }
  return (
    specifier.startsWith(pattern.slice(0, starIndex)) &&
    specifier.endsWith(pattern.slice(starIndex + 1))
  );
}

function isConfiguredAlias(specifier, compilerContexts, importerPath) {
  return matchingCompilerContexts(compilerContexts, importerPath).some(
    ({ options }) =>
      Object.keys(options.paths ?? {}).some((pattern) =>
        aliasPatternMatches(specifier, pattern),
      ),
  );
}

function resolveLocalTarget({
  compilerContexts,
  importerPath,
  repositoryRoot,
  specifier,
}) {
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(importerPath), specifier);
  }
  if (path.isAbsolute(specifier)) {
    return path.resolve(specifier);
  }

  const aliasTarget = localAliasTarget(specifier, repositoryRoot);
  if (aliasTarget) {
    return aliasTarget;
  }

  for (const { options } of matchingCompilerContexts(
    compilerContexts,
    importerPath,
  )) {
    const resolvedPath = ts.resolveModuleName(
      specifier,
      importerPath,
      options,
      ts.sys,
    ).resolvedModule?.resolvedFileName;
    if (
      resolvedPath &&
      !resolvedPath.includes(`${path.sep}node_modules${path.sep}`)
    ) {
      return path.resolve(resolvedPath);
    }
  }
  return undefined;
}

function externalPackageName(specifier) {
  const parts = specifier.split("/");
  if (specifier.startsWith("@") && parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return parts[0];
}

function prohibitedExternalReason(packageName) {
  if (!packageName) {
    return undefined;
  }
  for (const [pattern, reason] of PROHIBITED_EXTERNAL_PACKAGES) {
    if (
      (pattern.endsWith("/") || pattern.endsWith("-")) &&
      packageName.startsWith(pattern)
    ) {
      return reason;
    }
    if (packageName === pattern) {
      return reason;
    }
  }
  return undefined;
}

function locationFor(sourceFile, node) {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile, false),
  );
  return { column: character + 1, line: line + 1 };
}

function violation({
  code,
  detail,
  filePath,
  node,
  repositoryRoot,
  sourceFile,
}) {
  return {
    code,
    detail,
    file: toPosix(path.relative(repositoryRoot, filePath)),
    ...locationFor(sourceFile, node),
  };
}

function isLocallyDeclared(identifier, checker, sourceFile) {
  const symbol = checker.getSymbolAtLocation(identifier);
  return Boolean(
    symbol?.declarations?.some(
      (declaration) => declaration.getSourceFile() === sourceFile,
    ),
  );
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function staticExpressionPath(expression, checker, sourceFile) {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) {
    return isLocallyDeclared(current, checker, sourceFile)
      ? undefined
      : [current.text];
  }
  if (ts.isPropertyAccessExpression(current)) {
    const base = staticExpressionPath(current.expression, checker, sourceFile);
    return base ? [...base, current.name.text] : undefined;
  }
  if (ts.isElementAccessExpression(current)) {
    const base = staticExpressionPath(current.expression, checker, sourceFile);
    const argument = current.argumentExpression;
    return base && argument && ts.isStringLiteralLike(argument)
      ? [...base, argument.text]
      : undefined;
  }
  return undefined;
}

function normalizedGlobalPath(expression, checker, sourceFile) {
  const segments = staticExpressionPath(expression, checker, sourceFile);
  if (!segments) {
    return undefined;
  }
  return segments[0] === "globalThis" && segments.length > 1
    ? segments.slice(1)
    : segments;
}

function isTypePosition(node) {
  let current = node;
  while (current.parent) {
    if (ts.isTypeNode(current.parent)) {
      return true;
    }
    if (ts.isStatement(current.parent)) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

function isDeclarationOrPropertyName(identifier) {
  const parent = identifier.parent;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isMethodDeclaration(parent) && parent.name === identifier) ||
    (ts.isPropertyDeclaration(parent) && parent.name === identifier) ||
    (ts.isPropertySignature(parent) && parent.name === identifier) ||
    (ts.isMethodSignature(parent) && parent.name === identifier) ||
    (ts.isBindingElement(parent) && parent.name === identifier) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isParameter(parent) && parent.name === identifier) ||
    (ts.isFunctionDeclaration(parent) && parent.name === identifier) ||
    (ts.isFunctionExpression(parent) && parent.name === identifier) ||
    (ts.isClassDeclaration(parent) && parent.name === identifier) ||
    (ts.isClassExpression(parent) && parent.name === identifier) ||
    (ts.isInterfaceDeclaration(parent) && parent.name === identifier) ||
    (ts.isTypeAliasDeclaration(parent) && parent.name === identifier) ||
    (ts.isEnumDeclaration(parent) && parent.name === identifier) ||
    ts.isImportClause(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isExportSpecifier(parent)
  ) {
    return true;
  }
  return false;
}

function runtimeBoundaryFindings(sourceFile, checker) {
  const findings = [];
  const findingKeys = new Set();

  function record(node, detail) {
    const key = `${node.getStart(sourceFile, false)}:${detail}`;
    if (!findingKeys.has(key)) {
      findingKeys.add(key);
      findings.push({ node, detail });
    }
  }

  function classifyPath(node, segments) {
    if (!segments || segments.length === 0) {
      return;
    }
    const memberReason = NONDETERMINISTIC_MEMBER_PATHS.get(segments.join("."));
    if (memberReason) {
      record(node, `${segments.join(".")} reads ${memberReason}`);
      return;
    }
    const ambientReason = AMBIENT_RUNTIME_BOUNDARIES.get(segments[0]);
    if (ambientReason) {
      record(node, `${segments[0]} reads ${ambientReason}`);
      return;
    }
    if (segments[0] === "Math") {
      if (segments.length !== 2 || !ALLOWED_MATH_MEMBERS.has(segments[1])) {
        record(
          node,
          `${segments.join(".")} is not in the deterministic Math allowlist`,
        );
      }
      return;
    }
    if (segments.length === 1 && SENSITIVE_GLOBAL_OBJECTS.has(segments[0])) {
      record(
        node,
        `${segments[0]} is an aliased runtime capability; use explicit deterministic values instead`,
      );
    }
  }

  function visit(node) {
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const memberName = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined;
      if (
        memberName &&
        LOCALE_SENSITIVE_MEMBERS.has(memberName) &&
        standardLibraryMemberSymbol(node, memberName, checker)
      ) {
        record(node, `${memberName} reads host locale data`);
      }
      if (memberName === "stack") {
        const stackProperty = standardLibraryMemberSymbol(
          node,
          memberName,
          checker,
        );
        const isNativeErrorStack = stackProperty?.declarations?.some(
          (declaration) => {
            let current = declaration.parent;
            while (current) {
              if (
                ts.isInterfaceDeclaration(current) &&
                current.name.text === "Error"
              ) {
                return true;
              }
              current = current.parent;
            }
            return false;
          },
        );
        if (isNativeErrorStack) {
          record(node, "Error.stack reads host runtime diagnostics");
        }
      }
    }
    if (
      (ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
      !(
        (ts.isPropertyAccessExpression(node.parent) ||
          ts.isElementAccessExpression(node.parent)) &&
        node.parent.expression === node
      )
    ) {
      const segments = normalizedGlobalPath(node, checker, sourceFile);
      classifyPath(node, segments);

      if (ts.isElementAccessExpression(node) && !segments) {
        const rawBase = staticExpressionPath(
          node.expression,
          checker,
          sourceFile,
        );
        const base = normalizedGlobalPath(node.expression, checker, sourceFile);
        if (
          base &&
          (rawBase?.[0] === "globalThis" ||
            SENSITIVE_GLOBAL_OBJECTS.has(base[0]) ||
            AMBIENT_RUNTIME_BOUNDARIES.has(base[0]))
        ) {
          record(
            node,
            `${base.join(".")} uses a computed runtime property that cannot be proven deterministic`,
          );
        }
      }
    } else if (
      ts.isIdentifier(node) &&
      !isTypePosition(node) &&
      !isDeclarationOrPropertyName(node) &&
      !(
        (ts.isPropertyAccessExpression(node.parent) ||
          ts.isElementAccessExpression(node.parent)) &&
        node.parent.expression === node
      )
    ) {
      classifyPath(node, normalizedGlobalPath(node, checker, sourceFile));
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

function createAnalysisProgram(domainFiles, compilerContexts, repositoryRoot) {
  const options =
    domainFiles.length > 0
      ? matchingCompilerContexts(compilerContexts, domainFiles[0])[0]?.options
      : undefined;
  return ts.createProgram({
    rootNames: domainFiles,
    options: {
      ...defaultCompilerOptions(repositoryRoot),
      ...options,
      allowJs: true,
      checkJs: false,
      noEmit: true,
    },
  });
}

/**
 * Check pure-domain dependency direction and deterministic-runtime boundaries.
 *
 * @param {string} rootPath absolute or relative repository root
 * @returns {Promise<{domainFileCount: number, importEdgeCount: number, violations: Array<object>} >}
 */
export async function checkBoundaries(rootPath = process.cwd()) {
  const repositoryRoot = path.resolve(rootPath);
  const sourceRoot = path.join(repositoryRoot, "src");
  const compilerContexts = loadCompilerContexts(repositoryRoot);
  const files = await collectSourceFiles(sourceRoot, repositoryRoot);
  const domainFiles = files.filter((filePath) =>
    Boolean(pureArea(filePath, sourceRoot)),
  );
  const analysisProgram = createAnalysisProgram(
    domainFiles,
    compilerContexts,
    repositoryRoot,
  );
  const checker = analysisProgram.getTypeChecker();
  const violations = [];
  let importEdgeCount = 0;

  for (const filePath of domainFiles) {
    const importerArea = pureArea(filePath, sourceRoot);
    const sourceText = await readFile(filePath, "utf8");
    const sourceFile =
      analysisProgram.getSourceFile(filePath) ??
      ts.createSourceFile(
        filePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        scriptKind(filePath),
      );

    if (
      !PURE_SOURCE_EXTENSIONS.has(path.extname(filePath)) ||
      filePath.endsWith(".d.ts")
    ) {
      violations.push(
        violation({
          code: "BOUNDARY_PURE_SOURCE_EXTENSION",
          detail:
            "pure runtime modules must be .ts so the isolated compiler and typed lint gates cannot be bypassed",
          filePath,
          node: sourceFile,
          repositoryRoot,
          sourceFile,
        }),
      );
    }

    for (const reference of [
      ...(sourceFile.referencedFiles ?? []).map((entry) => ({
        entry,
        kind: "path",
      })),
      ...(sourceFile.typeReferenceDirectives ?? []).map((entry) => ({
        entry,
        kind: "types",
      })),
      ...(sourceFile.libReferenceDirectives ?? []).map((entry) => ({
        entry,
        kind: "lib",
      })),
      ...(sourceFile.amdDependencies ?? []).map(() => ({
        entry: { pos: 0 },
        kind: "amd-dependency",
      })),
      ...(sourceFile.moduleName === undefined
        ? []
        : [{ entry: { pos: 0 }, kind: "amd-module" }]),
      ...pragmaEntries(sourceFile, "reference")
        .filter((pragma) => pragma.arguments?.["no-default-lib"] !== undefined)
        .map((pragma) => ({
          entry: { pos: pragma.range?.pos ?? 0 },
          kind: "no-default-lib",
        })),
    ]) {
      violations.push(
        violation({
          code: "BOUNDARY_PURE_REFERENCE_DIRECTIVE",
          detail: `pure runtime modules may not use triple-slash ${reference.kind} references`,
          filePath,
          node: { getStart: () => reference.entry.pos },
          repositoryRoot,
          sourceFile,
        }),
      );
    }

    for (const diagnostic of sourceFile.parseDiagnostics ?? []) {
      violations.push(
        violation({
          code: "BOUNDARY_PARSE_ERROR",
          detail: diagnosticMessage(diagnostic),
          filePath,
          node: { getStart: () => diagnostic.start ?? 0 },
          repositoryRoot,
          sourceFile,
        }),
      );
    }

    for (const finding of runtimeBoundaryFindings(sourceFile, checker)) {
      violations.push(
        violation({
          code: "BOUNDARY_RUNTIME_NONDETERMINISM",
          detail: finding.detail,
          filePath,
          node: finding.node,
          repositoryRoot,
          sourceFile,
        }),
      );
    }

    for (const reference of moduleReferences(sourceFile, checker)) {
      importEdgeCount += 1;
      if (reference.specifier === undefined) {
        violations.push(
          violation({
            code: "BOUNDARY_NON_LITERAL_MODULE_SPECIFIER",
            detail: `${reference.syntax} in a pure module must use a literal module specifier so its boundary can be verified`,
            filePath,
            node: reference.node,
            repositoryRoot,
            sourceFile,
          }),
        );
        continue;
      }

      const specifier = reference.specifier;
      if (/^(?:node|bun|deno):/u.test(specifier)) {
        violations.push(
          violation({
            code: "BOUNDARY_PURE_PLATFORM_IMPORT",
            detail: `pure ${importerArea} module imports host runtime module ${JSON.stringify(specifier)}`,
            filePath,
            node: reference.node,
            repositoryRoot,
            sourceFile,
          }),
        );
        continue;
      }

      const localTarget = resolveLocalTarget({
        compilerContexts,
        importerPath: filePath,
        repositoryRoot,
        specifier,
      });
      const localIntent =
        specifier.startsWith(".") ||
        path.isAbsolute(specifier) ||
        Boolean(localAliasTarget(specifier, repositoryRoot)) ||
        specifier.startsWith("#") ||
        isConfiguredAlias(specifier, compilerContexts, filePath);

      if (localIntent && !localTarget) {
        violations.push(
          violation({
            code: "BOUNDARY_UNRESOLVED_LOCAL_ALIAS",
            detail: `pure ${importerArea} module uses local alias ${JSON.stringify(specifier)} whose target cannot be resolved`,
            filePath,
            node: reference.node,
            repositoryRoot,
            sourceFile,
          }),
        );
        continue;
      }

      if (localTarget) {
        if (!isWithin(sourceRoot, localTarget)) {
          violations.push(
            violation({
              code: "BOUNDARY_PURE_OUTSIDE_SOURCE",
              detail: `pure ${importerArea} module imports local path outside src via ${JSON.stringify(specifier)}`,
              filePath,
              node: reference.node,
              repositoryRoot,
              sourceFile,
            }),
          );
          continue;
        }

        const targetArea = pureArea(localTarget, sourceRoot);
        if (!targetArea) {
          violations.push(
            violation({
              code: "BOUNDARY_PURE_UNREVIEWED_LOCAL_AREA",
              detail: `pure ${importerArea} module imports unreviewed local src area via ${JSON.stringify(specifier)}`,
              filePath,
              node: reference.node,
              repositoryRoot,
              sourceFile,
            }),
          );
          continue;
        }

        if (!PURE_IMPORT_MATRIX.get(importerArea)?.has(targetArea)) {
          violations.push(
            violation({
              code: "BOUNDARY_PURE_IMPORT_MATRIX",
              detail: `pure ${importerArea} module may not import pure ${targetArea} via ${JSON.stringify(specifier)}`,
              filePath,
              node: reference.node,
              repositoryRoot,
              sourceFile,
            }),
          );
        }
        continue;
      }

      const packageName = externalPackageName(specifier);
      const externalReason = prohibitedExternalReason(packageName);
      if (externalReason) {
        violations.push(
          violation({
            code: "BOUNDARY_PURE_EXTERNAL_SDK",
            detail: `pure ${importerArea} module imports ${externalReason} ${JSON.stringify(packageName)} via ${JSON.stringify(specifier)}`,
            filePath,
            node: reference.node,
            repositoryRoot,
            sourceFile,
          }),
        );
      } else if (!ALLOWED_PURE_EXTERNAL_PACKAGES.has(packageName)) {
        violations.push(
          violation({
            code: "BOUNDARY_PURE_UNAPPROVED_EXTERNAL",
            detail: `pure ${importerArea} module imports unapproved external package ${JSON.stringify(packageName)} via ${JSON.stringify(specifier)}; review it as domain-neutral and update the boundary policy before use`,
            filePath,
            node: reference.node,
            repositoryRoot,
            sourceFile,
          }),
        );
      }
    }
  }

  violations.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.code.localeCompare(right.code),
  );
  return { domainFileCount: domainFiles.length, importEdgeCount, violations };
}

function usage() {
  return "Usage: node scripts/check-boundaries.mjs [--root <repository-root>]";
}

function parseArguments(arguments_) {
  if (arguments_.length === 0) {
    return process.cwd();
  }
  if (arguments_.length === 1 && arguments_[0] === "--help") {
    return undefined;
  }
  if (arguments_.length === 2 && arguments_[0] === "--root") {
    return arguments_[1];
  }
  throw new Error(usage());
}

async function main() {
  try {
    const rootPath = parseArguments(process.argv.slice(2));
    if (rootPath === undefined) {
      process.stdout.write(`${usage()}\n`);
      return;
    }

    const result = await checkBoundaries(rootPath);
    if (result.violations.length === 0) {
      process.stdout.write(
        `Source boundaries passed (${result.domainFileCount} pure files, ${result.importEdgeCount} import edges).\n`,
      );
      return;
    }

    process.stderr.write(
      `Source boundary check failed with ${result.violations.length} violation${result.violations.length === 1 ? "" : "s"}:\n`,
    );
    for (const item of result.violations) {
      process.stderr.write(
        `- ${item.file}:${item.line}:${item.column} [${item.code}] ${item.detail}\n`,
      );
    }
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[BOUNDARY_CHECK_FAILED] ${message}\n`);
    process.exitCode = 2;
  }
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (entryPoint === import.meta.url) {
  await main();
}
