import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export class CoveragePolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CoveragePolicyError";
    this.code = code;
  }
}

const RUNTIME_SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

function fail(code, message) {
  throw new CoveragePolicyError(code, message);
}

function normalizeRelative(repositoryRoot, absolutePath) {
  return relative(repositoryRoot, absolutePath).split(sep).join("/");
}

function runtimeTypeScriptSources(repositoryRoot, directory) {
  const sources = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    const status = lstatSync(absolutePath);
    if (status.isSymbolicLink()) {
      fail(
        "COVERAGE_SOURCE_SYMLINK_REJECTED",
        `${normalizeRelative(repositoryRoot, absolutePath)} may not be a symlink`,
      );
    }
    if (status.isDirectory()) {
      sources.push(...runtimeTypeScriptSources(repositoryRoot, absolutePath));
    } else if (
      status.isFile() &&
      RUNTIME_SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase()) &&
      !/\.d\.[cm]?ts$/iu.test(entry.name)
    ) {
      sources.push(normalizeRelative(repositoryRoot, absolutePath));
    }
  }
  return sources.sort();
}

function integerMetric(summary, name) {
  const value = summary?.total?.[name]?.total;
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(
      "COVERAGE_SUMMARY_INVALID",
      `coverage total ${name} must be a non-negative safe integer`,
    );
  }
  return value;
}

export function validateCoveragePolicy({
  policy,
  summary,
  repositoryRoot,
  sources,
  sourceByteLengths,
}) {
  if (policy?.schemaVersion !== "btt.coverage-policy/v1") {
    fail("COVERAGE_POLICY_INVALID", "unsupported coverage policy schema");
  }
  const excluded = policy.excludedRuntimeSources;
  if (!excluded || typeof excluded !== "object" || Array.isArray(excluded)) {
    fail(
      "COVERAGE_POLICY_INVALID",
      "excludedRuntimeSources must be an explicit path-to-reason object",
    );
  }
  const exclusionCaps = {
    files: policy.maximumExcludedRuntimeFiles,
    bytes: policy.maximumExcludedRuntimeBytes,
  };
  if (
    Object.values(exclusionCaps).some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  ) {
    fail(
      "COVERAGE_POLICY_INVALID",
      "coverage exclusion caps must be non-negative safe integers",
    );
  }
  let excludedRuntimeBytes = 0;
  for (const [sourcePath, exclusion] of Object.entries(excluded)) {
    if (
      !sources.includes(sourcePath) ||
      !exclusion ||
      typeof exclusion !== "object" ||
      Array.isArray(exclusion) ||
      typeof exclusion.reason !== "string" ||
      exclusion.reason.trim().length < 24 ||
      !Number.isSafeInteger(exclusion.maxBytes) ||
      exclusion.maxBytes <= 0
    ) {
      fail(
        "COVERAGE_EXCLUSION_INVALID",
        `${sourcePath} must exist and have a substantive exclusion reason`,
      );
    }
    const actualBytes = sourceByteLengths?.[sourcePath];
    if (!Number.isSafeInteger(actualBytes) || actualBytes < 0) {
      fail(
        "COVERAGE_SOURCE_METADATA_MISSING",
        `${sourcePath} needs an observed source byte length`,
      );
    }
    if (actualBytes > exclusion.maxBytes) {
      fail(
        "COVERAGE_EXCLUSION_BUDGET_EXCEEDED",
        `${sourcePath} is ${String(actualBytes)} bytes, above its ${String(exclusion.maxBytes)} byte composition-only budget`,
      );
    }
    excludedRuntimeBytes += actualBytes;
    if (!Number.isSafeInteger(excludedRuntimeBytes)) {
      fail(
        "COVERAGE_EXCLUSION_CAP_EXCEEDED",
        "excluded runtime byte total is not a safe integer",
      );
    }
  }
  if (
    Object.keys(excluded).length > exclusionCaps.files ||
    excludedRuntimeBytes > exclusionCaps.bytes
  ) {
    fail(
      "COVERAGE_EXCLUSION_CAP_EXCEEDED",
      `excluded runtime scope is ${String(Object.keys(excluded).length)} files and ${String(excludedRuntimeBytes)} bytes; caps are ${String(exclusionCaps.files)} files and ${String(exclusionCaps.bytes)} bytes`,
    );
  }

  const coveredPaths = new Set(
    Object.keys(summary)
      .filter((key) => key !== "total")
      .map((absolutePath) =>
        normalizeRelative(repositoryRoot, resolve(absolutePath)),
      ),
  );
  const instrumentedPaths = new Set(
    sources.filter(
      (sourcePath) =>
        !Object.hasOwn(excluded, sourcePath) && coveredPaths.has(sourcePath),
    ),
  );
  const missing = sources.filter(
    (sourcePath) =>
      !Object.hasOwn(excluded, sourcePath) &&
      !instrumentedPaths.has(sourcePath),
  );
  if (missing.length > 0) {
    fail(
      "COVERAGE_SOURCE_MISSING",
      `runtime sources are neither instrumented nor explicitly excluded: ${missing.join(", ")}`,
    );
  }

  const minimums = {
    files: policy.minimumInstrumentedFiles,
    statements: policy.minimumInstrumentedStatements,
    functions: policy.minimumInstrumentedFunctions,
    branches: policy.minimumInstrumentedBranches,
  };
  if (
    Object.values(minimums).some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    )
  ) {
    fail(
      "COVERAGE_POLICY_INVALID",
      "coverage minimums must be non-negative safe integers",
    );
  }
  const actual = {
    files: instrumentedPaths.size,
    statements: integerMetric(summary, "statements"),
    functions: integerMetric(summary, "functions"),
    branches: integerMetric(summary, "branches"),
  };
  const below = Object.keys(minimums).filter(
    (metric) => actual[metric] < minimums[metric],
  );
  if (below.length > 0) {
    fail(
      "COVERAGE_SCOPE_TOO_SMALL",
      below
        .map(
          (metric) =>
            `${metric}=${String(actual[metric])} minimum=${String(minimums[metric])}`,
        )
        .join(", "),
    );
  }
  return Object.freeze({ actual, excluded: Object.keys(excluded).sort() });
}

export function checkCoverage(repositoryRoot = process.cwd()) {
  const resolvedRoot = resolve(repositoryRoot);
  const policy = JSON.parse(
    readFileSync(resolve(resolvedRoot, "coverage-policy.json"), "utf8"),
  );
  const summary = JSON.parse(
    readFileSync(
      resolve(resolvedRoot, "coverage/coverage-summary.json"),
      "utf8",
    ),
  );
  const sources = runtimeTypeScriptSources(
    resolvedRoot,
    resolve(resolvedRoot, "src"),
  );
  const sourceByteLengths = Object.fromEntries(
    sources.map((sourcePath) => [
      sourcePath,
      Buffer.byteLength(
        readFileSync(resolve(resolvedRoot, sourcePath), "utf8"),
        "utf8",
      ),
    ]),
  );
  return validateCoveragePolicy({
    policy,
    summary,
    repositoryRoot: resolvedRoot,
    sources,
    sourceByteLengths,
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  try {
    const result = checkCoverage();
    process.stdout.write(
      `coverage scope passed: ${String(result.actual.files)} files, ${String(result.actual.statements)} statements, ${String(result.actual.functions)} functions, ${String(result.actual.branches)} branches; explicit exclusions=${result.excluded.join(", ") || "none"}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error?.code ?? "COVERAGE_POLICY_FAILED"}: ${error?.message ?? String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
