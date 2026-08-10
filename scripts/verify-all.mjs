import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants as fileConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { format as formatWithPrettier } from "prettier";

import { OwnedProcessError, runOwnedProcess } from "./owned-process-runner.mjs";

const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 4 * 60 * 1000;
const TOTAL_VERIFICATION_TIMEOUT_MS = 48 * 60 * 1000;
const REQUIRED_NODE_VERSION = "v24.19.0";
const REQUIRED_NPM_VERSION = "11.17.0";
const LIFECYCLE_SCHEMA_VERSION = "btt.dev-lifecycle/v1";
const LIFECYCLE_RESULT_PREFIX = "DEV_LIFECYCLE_RESULT ";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXPECTED_PORTS = Object.freeze({
  DEV_HOST: "127.0.0.1",
  PORT_0: 4140,
  PORT_1: 4141,
  PORT_2: 4142,
  PORT_3: 4143,
});

const EXCLUDED_INPUT_ROOTS = new Set([
  ".dev",
  ".git",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const HEALTH_SERVICES = Object.freeze([
  { name: "game", serviceId: "game-dev", port: 4140 },
  { name: "preview", serviceId: "production-preview", port: 4141 },
  { name: "e2e", serviceId: "browser-history-e2e", port: 4142 },
  { name: "static", serviceId: "static-bundle", port: 4143 },
]);

const SECRET_KEY_PATTERN =
  /(?:AUTH|BEARER|COOKIE|CREDENTIAL|KEY|PASS|PASSWORD|PRIVATE|SECRET|SESSION|TOKEN)/i;

const MAIN_COMMANDS = Object.freeze([
  {
    id: "check",
    label: "npm run check",
    command: "npm",
    args: ["run", "check"],
    kind: "verification",
    timeoutMs: 4 * 60 * 1000,
  },
  {
    id: "test",
    label: "npm run test",
    command: "npm",
    args: ["run", "test"],
    kind: "verification",
    timeoutMs: 8 * 60 * 1000,
  },
  {
    id: "build",
    label: "npm run build",
    command: "npm",
    args: ["run", "build"],
    kind: "verification",
    timeoutMs: 4 * 60 * 1000,
  },
  {
    id: "audit",
    label: "npm run security:audit",
    command: "npm",
    args: ["run", "security:audit"],
    kind: "verification",
    timeoutMs: 2 * 60 * 1000,
  },
]);

const DEV_COMMANDS = Object.freeze({
  preflight: {
    id: "dev_preflight",
    label: "npm run dev:preflight",
    command: "npm",
    args: ["run", "dev:preflight"],
    kind: "lifecycle",
    timeoutMs: 60 * 1000,
  },
  up: {
    id: "dev_up",
    label: "npm run dev:up",
    command: "npm",
    args: ["run", "dev:up"],
    kind: "lifecycle",
    timeoutMs: 3 * 60 * 1000,
  },
  health: {
    id: "dev_health",
    label: "npm run dev:health",
    command: "npm",
    args: ["run", "dev:health"],
    kind: "lifecycle",
    timeoutMs: 60 * 1000,
  },
  e2e: {
    id: "e2e_4142_all_browsers",
    label: "npm run test:e2e (owned 4142; Chromium, Firefox, WebKit)",
    command: "npm",
    args: ["run", "test:e2e"],
    kind: "verification",
    environmentOverlay: { BTT_REUSE_OWNED_E2E_SERVER: "1" },
    timeoutMs: 8 * 60 * 1000,
  },
  preview: {
    id: "e2e_preview_4141_chromium",
    label:
      "node scripts/playwright-runner.mjs test --btt-target preview --project=chromium (owned preview 4141)",
    command: process.execPath,
    recordedCommand: "node",
    args: [
      "scripts/playwright-runner.mjs",
      "test",
      "--btt-target",
      "preview",
      "--project=chromium",
    ],
    kind: "verification",
    environmentOverlay: {
      BTT_E2E_TARGET: "preview",
      BTT_REUSE_OWNED_E2E_SERVER: "1",
    },
    timeoutMs: 4 * 60 * 1000,
  },
  static: {
    id: "e2e_static_4143_chromium",
    label:
      "node scripts/playwright-runner.mjs test --btt-target static --project=chromium (owned static 4143)",
    command: process.execPath,
    recordedCommand: "node",
    args: [
      "scripts/playwright-runner.mjs",
      "test",
      "--btt-target",
      "static",
      "--project=chromium",
    ],
    kind: "verification",
    environmentOverlay: {
      BTT_E2E_TARGET: "static",
      BTT_REUSE_OWNED_E2E_SERVER: "1",
    },
    timeoutMs: 4 * 60 * 1000,
  },
  down: {
    id: "dev_down",
    label: "npm run dev:down",
    command: "npm",
    args: ["run", "dev:down"],
    kind: "cleanup",
    runAfterAbort: true,
    timeoutMs: 90 * 1000,
  },
});

const PLAYWRIGHT_VERSION_PROBE = String.raw`
import { chromium, firefox, webkit } from "playwright";
import { createHash } from "node:crypto";
import { constants as fileConstants } from "node:fs";
import path from "node:path";
import { lstat, open, realpath } from "node:fs/promises";
const allowedRoot = await realpath(process.env.PLAYWRIGHT_BROWSERS_PATH);
function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep));
}
function unchanged(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
async function hashExecutable(executablePath) {
  const canonical = await realpath(executablePath);
  if (!isWithin(allowedRoot, canonical)) throw new Error("browser executable escaped owned cache");
  const metadata = await lstat(canonical);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("invalid browser executable");
  const handle = await open(canonical, fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat({ bigint: true });
    const digest = createHash("sha256");
    let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      digest.update(chunk);
      bytes += chunk.byteLength;
    }
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(canonical, { bigint: true });
    if (pathAfter.isSymbolicLink() || !unchanged(before, after) || !unchanged(after, pathAfter) || BigInt(bytes) !== after.size || await realpath(canonical) !== canonical) throw new Error("browser executable changed while hashing");
    return { bytes, sha256: digest.digest("hex") };
  } finally {
    await handle.close();
  }
}
const result = {};
let failed = false;
for (const [name, browserType] of Object.entries({ chromium, firefox, webkit })) {
  let browser;
  try {
    const executable = await hashExecutable(browserType.executablePath());
    browser = await browserType.launch({ headless: true });
    result[name] = { version: browser.version(), executable };
  } catch {
    failed = true;
    result[name] = { unavailable: true };
  } finally {
    await browser?.close();
  }
}
process.stdout.write(JSON.stringify(result) + "\\n");
if (failed) process.exitCode = 1;
`;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function structuredSha256(value) {
  return sha256(`${JSON.stringify(canonicalize(value))}\n`);
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function pathIsWithin(root, candidate) {
  const relativePath = path.relative(root, candidate);
  return (
    relativePath === "" ||
    (!path.isAbsolute(relativePath) &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`))
  );
}

function assertRealDirectory(directoryPath, code) {
  const metadata = lstatSync(directoryPath);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return realpathSync(directoryPath);
}

function ensureSafeDirectory(repositoryRoot, relativePath, mode = 0o700) {
  const canonicalRoot = assertRealDirectory(
    repositoryRoot,
    "VERIFY_REPOSITORY_ROOT_INVALID",
  );
  let cursor = repositoryRoot;
  for (const segment of relativePath.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("VERIFY_DIRECTORY_PATH_INVALID");
    }
    cursor = path.join(cursor, segment);
    try {
      const metadata = lstatSync(cursor);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error("VERIFY_DIRECTORY_PARENT_UNSAFE");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      mkdirSync(cursor, { mode });
      const created = lstatSync(cursor);
      if (created.isSymbolicLink() || !created.isDirectory()) {
        throw new Error("VERIFY_DIRECTORY_CREATE_UNSAFE", { cause: error });
      }
    }
    const canonicalCursor = realpathSync(cursor);
    if (!pathIsWithin(canonicalRoot, canonicalCursor)) {
      throw new Error("VERIFY_DIRECTORY_ESCAPE");
    }
  }
  return cursor;
}

function hashRegularFile(filePath, allowedRoot) {
  const canonicalPath = realpathSync(filePath);
  if (allowedRoot && !pathIsWithin(realpathSync(allowedRoot), canonicalPath)) {
    throw new Error("VERIFY_TOOL_PATH_ESCAPE");
  }
  const metadata = lstatSync(canonicalPath, { bigint: true });
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("VERIFY_TOOL_PATH_INVALID");
  }
  const descriptor = openSync(
    canonicalPath,
    fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0;
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      digest.update(buffer.subarray(0, count));
      bytes += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(canonicalPath, { bigint: true });
    if (
      pathAfter.isSymbolicLink() ||
      !unchangedFile(before, after) ||
      !unchangedFile(after, pathAfter) ||
      BigInt(bytes) !== after.size ||
      realpathSync(filePath) !== canonicalPath
    ) {
      throw new Error("VERIFY_TOOL_CHANGED_WHILE_HASHING");
    }
    return { bytes, sha256: digest.digest("hex") };
  } finally {
    closeSync(descriptor);
  }
}

function hashDirectoryTree(directoryPath, excludedGeneratedRoots = []) {
  const canonicalRoot = assertRealDirectory(
    directoryPath,
    "VERIFY_DEPENDENCY_TREE_INVALID",
  );
  const excludedRootNames = new Set(excludedGeneratedRoots);
  if (
    [...excludedRootNames].some(
      (name) =>
        typeof name !== "string" ||
        name.length === 0 ||
        name.includes("/") ||
        name.includes("\\") ||
        name === "." ||
        name === "..",
    )
  ) {
    throw new Error("VERIFY_DEPENDENCY_EXCLUSION_INVALID");
  }
  const digest = createHash("sha256");
  let fileCount = 0;
  let totalBytes = 0;
  const declaredExclusions = [...excludedRootNames].sort();
  for (const name of declaredExclusions) {
    digest.update(`excluded-generated-root\0${name}\0`);
  }

  const visit = (currentDirectory, atRoot = false) => {
    for (const name of readdirSync(currentDirectory).sort()) {
      if (atRoot && excludedRootNames.has(name)) {
        continue;
      }
      const absolutePath = path.join(currentDirectory, name);
      const relativePath = path
        .relative(canonicalRoot, absolutePath)
        .split(path.sep)
        .join("/");
      const metadata = lstatSync(absolutePath);
      if (metadata.isDirectory()) {
        const canonicalDirectory = realpathSync(absolutePath);
        if (!pathIsWithin(canonicalRoot, canonicalDirectory)) {
          throw new Error("VERIFY_DEPENDENCY_TREE_ESCAPE");
        }
        digest.update(`directory\0${relativePath}\0`);
        visit(absolutePath);
        continue;
      }

      let filePath = absolutePath;
      let entryType = "file";
      let linkTarget = "";
      if (metadata.isSymbolicLink()) {
        filePath = realpathSync(absolutePath);
        if (!pathIsWithin(canonicalRoot, filePath)) {
          throw new Error("VERIFY_DEPENDENCY_TREE_ESCAPE");
        }
        if (!lstatSync(filePath).isFile()) {
          throw new Error("VERIFY_DEPENDENCY_TREE_UNSUPPORTED_LINK");
        }
        entryType = "symbolic-link-file";
        linkTarget = path
          .relative(canonicalRoot, filePath)
          .split(path.sep)
          .join("/");
      } else if (!metadata.isFile()) {
        throw new Error("VERIFY_DEPENDENCY_TREE_UNSUPPORTED_ENTRY");
      }

      const evidence = hashRegularFile(filePath, canonicalRoot);
      digest.update(
        `${entryType}\0${relativePath}\0${linkTarget}\0${evidence.bytes}\0${evidence.sha256}\0`,
      );
      fileCount += 1;
      totalBytes += evidence.bytes;
    }
  };

  visit(canonicalRoot, true);
  if (fileCount === 0) throw new Error("VERIFY_DEPENDENCY_TREE_EMPTY");
  return {
    fileCount,
    totalBytes,
    aggregateSha256: digest.digest("hex"),
    excludedGeneratedRoots: declaredExclusions,
  };
}

function resolveTrustedNpmCli() {
  const executableDirectory = path.dirname(process.execPath);
  const candidates = [
    path.join(executableDirectory, "npm"),
    path.resolve(executableDirectory, "../lib/node_modules/npm/bin/npm-cli.js"),
  ];
  const cellarMarker = `${path.sep}Cellar${path.sep}`;
  const markerIndex = process.execPath.indexOf(cellarMarker);
  if (markerIndex > 0) {
    const prefix = process.execPath.slice(0, markerIndex);
    candidates.push(path.join(prefix, "bin", "npm"));
  }
  if (process.platform === "win32") {
    candidates.unshift(path.join(executableDirectory, "npm.cmd"));
  }
  for (const candidate of candidates) {
    try {
      const canonical = realpathSync(candidate);
      if (lstatSync(canonical).isFile()) return canonical;
    } catch {
      // Continue through paths derived only from the trusted Node executable.
    }
  }
  throw new Error("VERIFY_TRUSTED_NPM_NOT_FOUND");
}

function resolveTrustedTools(repositoryRoot) {
  const gitCandidates =
    process.platform === "win32"
      ? [
          "C:\\Program Files\\Git\\cmd\\git.exe",
          "C:\\Program Files\\Git\\bin\\git.exe",
        ]
      : ["/usr/bin/git"];
  let gitPath;
  for (const candidate of gitCandidates) {
    try {
      const canonical = realpathSync(candidate);
      if (lstatSync(canonical).isFile()) {
        gitPath = canonical;
        break;
      }
    } catch {
      // Try the next fixed system location; caller PATH is never consulted.
    }
  }
  if (!gitPath) throw new Error("VERIFY_TRUSTED_GIT_NOT_FOUND");
  const npmCliPath = resolveTrustedNpmCli();
  const localEntrypoints = {
    axePlaywright: "node_modules/@axe-core/playwright/dist/index.mjs",
    eslint: "node_modules/.bin/eslint",
    playwright: "node_modules/.bin/playwright",
    prettier: "node_modules/.bin/prettier",
    tsc: "node_modules/.bin/tsc",
    vite: "node_modules/.bin/vite",
    vitest: "node_modules/.bin/vitest",
  };
  const integrity = {
    node: hashRegularFile(process.execPath),
    npmCli: hashRegularFile(npmCliPath),
    npmInstallationTree: hashDirectoryTree(
      path.resolve(path.dirname(npmCliPath), ".."),
    ),
    git: hashRegularFile(gitPath),
    localEntrypoints: {},
    installedDependencyTree: hashDirectoryTree(
      path.join(repositoryRoot, "node_modules"),
      [".cache", ".vite", ".vite-temp"],
    ),
  };
  const nodeModulesRoot = path.join(repositoryRoot, "node_modules");
  for (const [name, relativePath] of Object.entries(localEntrypoints)) {
    integrity.localEntrypoints[name] = hashRegularFile(
      path.join(repositoryRoot, relativePath),
      nodeModulesRoot,
    );
  }
  return { gitPath, npmCliPath, integrity };
}

function materializeTrustedCommand(specification, trustedTools) {
  if (specification.command === "git") {
    return {
      ...specification,
      command: trustedTools.gitPath,
      recordedCommand: "git",
    };
  }
  if (specification.command === "npm") {
    return {
      ...specification,
      command: process.execPath,
      args: [trustedTools.npmCliPath, ...specification.args],
      recordedCommand: "npm",
      recordedArgs: specification.args,
    };
  }
  return specification;
}

function mask(value) {
  return value.replace(/[^\r\n]/g, "*");
}

function replaceAllPreservingLength(value, needle) {
  if (needle.length === 0 || !value.includes(needle)) return value;
  return value.split(needle).join(mask(needle));
}

/**
 * Returns a length-preserving redactor so output can be split back across the
 * original stdout/stderr chunks without losing their observed interleaving.
 */
export function createRedactor(environments = []) {
  const candidates = new Map();
  for (const environment of environments) {
    for (const [key, rawValue] of Object.entries(environment ?? {})) {
      if (typeof rawValue !== "string" || rawValue.length === 0) continue;
      const isSecret = SECRET_KEY_PATTERN.test(key);
      if (!isSecret && rawValue.length < 6) continue;
      const previous = candidates.get(rawValue) ?? false;
      candidates.set(rawValue, previous || isSecret);
    }
  }

  const exactValues = [...candidates.keys()].sort(
    (left, right) => right.length - left.length,
  );
  const patterns = [
    /\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/gi,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    /\b(?:authorization\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi,
    /\b(?:AUTH|COOKIE|CREDENTIAL|KEY|PASS|PASSWORD|PRIVATE|SECRET|SESSION|TOKEN)[A-Z0-9_-]*\s*[=:]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
    /\/\/[A-Za-z0-9._-]+\/:_authToken=[^\s]+/gi,
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/gi,
  ];

  return (input) => {
    let redacted = String(input);
    for (const value of exactValues) {
      redacted = replaceAllPreservingLength(redacted, value);
    }
    for (const pattern of patterns) {
      redacted = redacted.replace(pattern, (match) => mask(match));
    }
    return redacted;
  };
}

export function buildChildEnvironment(
  sourceEnvironment,
  repositoryRoot,
  runId,
) {
  const childEnvironment = {};
  const passthrough = [
    "HOME",
    "LANG",
    "LC_ALL",
    "NODE_EXTRA_CA_CERTS",
    "NO_PROXY",
    "SSL_CERT_DIR",
    "SSL_CERT_FILE",
    "TZ",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "HTTP_PROXY",
    "HTTPS_PROXY",
  ];
  for (const key of passthrough) {
    const value = sourceEnvironment[key];
    if (typeof value === "string" && value.length > 0) {
      childEnvironment[key] = value;
    }
  }

  if (sourceEnvironment.CI !== undefined) childEnvironment.CI = "true";
  if (sourceEnvironment.GITHUB_ACTIONS !== undefined) {
    childEnvironment.GITHUB_ACTIONS = "true";
  }
  if (process.platform === "win32") {
    for (const key of ["ComSpec", "PATHEXT", "SystemRoot"]) {
      const value = sourceEnvironment[key];
      if (typeof value === "string" && value.length > 0) {
        childEnvironment[key] = value;
      }
    }
  }

  const runTemporaryRoot = path.join(
    repositoryRoot,
    ".dev",
    "tmp",
    "verify-all",
    runId,
  );
  childEnvironment.FORCE_COLOR = "0";
  childEnvironment.NO_COLOR = "1";
  childEnvironment.TERM = "dumb";
  childEnvironment.PATH =
    process.platform === "win32"
      ? [path.dirname(process.execPath), "C:\\Windows\\System32"]
          .filter(Boolean)
          .join(path.delimiter)
      : [
          path.dirname(process.execPath),
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
        ].join(path.delimiter);
  childEnvironment.TEMP = runTemporaryRoot;
  childEnvironment.TMP = runTemporaryRoot;
  childEnvironment.TMPDIR = runTemporaryRoot;
  childEnvironment.XDG_CACHE_HOME = path.join(repositoryRoot, ".dev", "cache");
  childEnvironment.npm_config_cache = path.join(
    repositoryRoot,
    ".dev",
    "cache",
    "npm",
  );
  childEnvironment.npm_config_fund = "false";
  return childEnvironment;
}

export function ownedProcessTreeTarget(pid, platform = process.platform) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error("VERIFY_CHILD_PID_INVALID");
  }
  return platform === "win32"
    ? { scope: "windows-process-tree", target: pid }
    : { scope: "dedicated-posix-process-group", target: -pid };
}

function verifierTerminationCause(errorCode) {
  return (
    {
      OWNED_PROCESS_TIMEOUT: "timeout",
      OWNED_PROCESS_CANCELLED: "parent-signal",
      OWNED_PROCESS_OUTPUT_LIMIT: "output-limit",
      OWNED_PROCESS_DESCENDANTS_AFTER_EXIT: "leaked-descendant",
      OWNED_PROCESS_TRACKING_FAILED: "descendant-state-unavailable",
      OWNED_PROCESS_CLEANUP_UNPROVEN: "cleanup-unproven",
    }[errorCode] ?? "owned-process-failure"
  );
}

function verifierRunnerResult(result, overrides = {}) {
  return {
    exitCode: result?.exitCode ?? null,
    signal: result?.signal ?? null,
    timedOut: result?.timedOut === true,
    aborted: typeof result?.interruptionSignal === "string",
    outputLimitExceeded: result?.outputLimitExceeded === true,
    terminationCause: null,
    forcedTermination: result?.forcedTermination === true,
    processTreeScope: result?.processTreeScope ?? null,
    trackedDescendantCount: result?.trackedDescendantCount ?? 0,
    descendantTrackingErrorCode: result?.trackingError ?? null,
    errorCode: result?.errorCode ?? null,
    errorMessage: null,
    totalOutputBytes: result?.totalOutputBytes ?? 0,
    ...overrides,
  };
}

export function createProcessRunner() {
  return async (specification, onChunk) => {
    try {
      const result = await runOwnedProcess({
        command: specification.command,
        args: specification.args,
        cwd: specification.cwd,
        env: specification.env,
        outputMode: "capture",
        timeoutMs: specification.timeoutMs,
        maxOutputBytes: specification.maxOutputBytes,
        terminationGraceMs: specification.terminationGraceMs,
        killVerificationMs: specification.killVerificationMs,
        abortSignal: specification.abortSignal,
        onOutput(stream, text) {
          onChunk(stream, text);
        },
      });
      return verifierRunnerResult(result);
    } catch (error) {
      if (!(error instanceof OwnedProcessError)) throw error;
      const marker = `VERIFY_OWNED_PROCESS_RUNNER_${error.code}\n`;
      onChunk("stderr", marker);
      return verifierRunnerResult(error.result, {
        timedOut:
          error.code === "OWNED_PROCESS_TIMEOUT" ||
          error.result?.timedOut === true,
        aborted:
          error.code === "OWNED_PROCESS_CANCELLED" ||
          typeof error.result?.interruptionSignal === "string",
        outputLimitExceeded:
          error.code === "OWNED_PROCESS_OUTPUT_LIMIT" ||
          error.result?.outputLimitExceeded === true,
        terminationCause: verifierTerminationCause(error.code),
        errorCode: error.code,
        errorMessage: error.message,
        totalOutputBytes:
          (error.result?.totalOutputBytes ?? 0) + byteLength(marker),
      });
    }
  };
}

class EventWriter {
  constructor(filePath, now) {
    this.fileDescriptor = openSync(filePath, "wx", 0o600);
    this.sequence = 0;
    this.now = now;
  }

  emit(event) {
    this.sequence += 1;
    writeSync(
      this.fileDescriptor,
      `${JSON.stringify({
        sequence: this.sequence,
        observedAtUtc: this.now().toISOString(),
        ...event,
      })}\n`,
      undefined,
      "utf8",
    );
    return this.sequence;
  }

  close() {
    if (this.fileDescriptor === undefined) return;
    closeSync(this.fileDescriptor);
    this.fileDescriptor = undefined;
  }
}

function defaultRunIdFactory(startedAt) {
  const timestamp = startedAt
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "");
  return `${timestamp}-${randomBytes(6).toString("hex")}`;
}

function assertSafeRunId(runId) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId) ||
    runId.includes("..")
  ) {
    throw new Error("VERIFY_RUN_ID_INVALID");
  }
}

function allocateRunDirectory(repositoryRoot, startedAt, runIdFactory) {
  const runsRoot = ensureSafeDirectory(repositoryRoot, "evidence/runs");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const runId = runIdFactory(startedAt, attempt);
    assertSafeRunId(runId);
    const runDirectory = path.join(runsRoot, runId);
    try {
      mkdirSync(runDirectory, { recursive: false, mode: 0o700 });
      return { runId, runDirectory };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("VERIFY_RUN_ID_EXHAUSTED");
}

function printableCommand(specification) {
  return [
    specification.recordedCommand ?? specification.command,
    ...(specification.recordedArgs ?? specification.args),
  ].join(" ");
}

async function captureCommand({
  runner,
  specification,
  repositoryRoot,
  childEnvironment,
  now,
  abortSignal,
}) {
  const startedAt = now();
  const rawChunks = [];
  let observedOrder = 0;
  let runnerResult;
  const commandEnvironment = {
    ...childEnvironment,
    ...(specification.environmentOverlay ?? {}),
  };

  try {
    runnerResult = await runner(
      {
        ...specification,
        cwd: repositoryRoot,
        env: commandEnvironment,
        timeoutMs: specification.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
        maxOutputBytes:
          specification.maxOutputBytes ?? MAX_COMMAND_OUTPUT_BYTES,
        abortSignal,
      },
      (stream, text) => {
        observedOrder += 1;
        rawChunks.push({
          stream,
          text: String(text),
          observedOrder,
          observedAtUtc: now().toISOString(),
        });
      },
    );
  } catch (error) {
    observedOrder += 1;
    rawChunks.push({
      stream: "stderr",
      text: `VERIFY_COMMAND_RUNNER_FAILED: ${error?.message ?? String(error)}\n`,
      observedOrder,
      observedAtUtc: now().toISOString(),
    });
    runnerResult = {
      exitCode: null,
      signal: null,
      timedOut: false,
      aborted: abortSignal?.aborted === true,
      outputLimitExceeded: false,
      terminationCause: abortSignal?.aborted ? "parent-signal" : null,
      forcedTermination: false,
      processTreeScope: null,
      errorCode: "RUNNER_EXCEPTION",
      errorMessage: error?.message ?? String(error),
      totalOutputBytes: rawChunks.reduce(
        (total, chunk) => total + byteLength(chunk.text),
        0,
      ),
    };
  }

  const endedAt = now();
  return {
    specification,
    startedAt,
    endedAt,
    rawChunks,
    runnerResult,
  };
}

function redactCapturedChunks(rawChunks, redact) {
  const redactedTape = redact(rawChunks.map((chunk) => chunk.text).join(""));
  let offset = 0;
  return rawChunks.map((chunk) => {
    const start = offset;
    const end = start + chunk.text.length;
    offset = end;
    return {
      ...chunk,
      text: redactedTape.slice(start, end),
    };
  });
}

function rawCapturedStream(capture, stream) {
  return capture.rawChunks
    .filter((chunk) => chunk.stream === stream)
    .map((chunk) => chunk.text)
    .join("");
}

function persistCommandCapture({ capture, writer, redact, tee }) {
  const { specification, runnerResult } = capture;
  const firstSequence = writer.emit({
    type: "command_started",
    commandId: specification.id,
    commandKind: specification.kind,
    command: printableCommand(specification),
    environmentOverlayKeys: Object.keys(
      specification.environmentOverlay ?? {},
    ).sort(),
  });
  const redactedChunks = redactCapturedChunks(capture.rawChunks, redact);
  const completeOutput = { stdout: "", stderr: "" };
  let completeOrderedOutput = "";
  for (const chunk of redactedChunks) {
    completeOutput[chunk.stream] += chunk.text;
    completeOrderedOutput += chunk.text;
    writer.emit({
      type: "command_output",
      commandId: specification.id,
      stream: chunk.stream,
      observedOrder: chunk.observedOrder,
      observedAtUtc: chunk.observedAtUtc,
      text: chunk.text,
    });
    if (tee) process[chunk.stream].write(chunk.text);
  }
  const succeeded =
    runnerResult.exitCode === 0 &&
    runnerResult.terminationCause === null &&
    runnerResult.errorCode === null &&
    runnerResult.descendantTrackingErrorCode === null &&
    !runnerResult.timedOut &&
    !runnerResult.aborted &&
    !runnerResult.outputLimitExceeded;
  const lastSequence = writer.emit({
    type: "command_finished",
    commandId: specification.id,
    outcome: succeeded ? "PASS" : "FAIL",
    exitCode: runnerResult.exitCode,
    signal: runnerResult.signal,
    timedOut: runnerResult.timedOut,
    aborted: runnerResult.aborted,
    outputLimitExceeded: runnerResult.outputLimitExceeded,
    terminationCause: runnerResult.terminationCause,
    forcedTermination: runnerResult.forcedTermination,
    processTreeScope: runnerResult.processTreeScope,
    trackedDescendantCount: runnerResult.trackedDescendantCount,
    descendantTrackingErrorCode: runnerResult.descendantTrackingErrorCode,
    errorCode: runnerResult.errorCode,
  });

  const result = {
    id: specification.id,
    label: specification.label,
    kind: specification.kind,
    command: specification.recordedCommand ?? specification.command,
    args: specification.recordedArgs ?? specification.args,
    environmentOverlayKeys: Object.keys(
      specification.environmentOverlay ?? {},
    ).sort(),
    startedAtUtc: capture.startedAt.toISOString(),
    endedAtUtc: capture.endedAt.toISOString(),
    durationMs: Math.max(
      0,
      capture.endedAt.getTime() - capture.startedAt.getTime(),
    ),
    outcome: succeeded ? "PASS" : "FAIL",
    exitCode: runnerResult.exitCode,
    signal: runnerResult.signal,
    timedOut: runnerResult.timedOut,
    aborted: runnerResult.aborted,
    outputLimitExceeded: runnerResult.outputLimitExceeded,
    terminationCause: runnerResult.terminationCause,
    forcedTermination: runnerResult.forcedTermination,
    processTreeScope: runnerResult.processTreeScope,
    trackedDescendantCount: runnerResult.trackedDescendantCount,
    descendantTrackingErrorCode: runnerResult.descendantTrackingErrorCode,
    errorCode: runnerResult.errorCode,
    observedOutputBytes: runnerResult.totalOutputBytes,
    redactedStdoutSha256: sha256(completeOutput.stdout),
    redactedStderrSha256: sha256(completeOutput.stderr),
    redactedOrderedOutputSha256: sha256(completeOrderedOutput),
    eventSequence: { first: firstSequence, last: lastSequence },
  };
  return {
    result,
    rawStdout: rawCapturedStream(capture, "stdout"),
    rawStderr: rawCapturedStream(capture, "stderr"),
  };
}

function createSpecification({
  id,
  label,
  command,
  args,
  kind = "metadata",
  environmentOverlay,
  recordedCommand,
  recordedArgs,
  runAfterAbort,
  timeoutMs,
}) {
  return {
    id,
    label,
    command,
    args,
    kind,
    ...(environmentOverlay ? { environmentOverlay } : {}),
    ...(recordedCommand ? { recordedCommand } : {}),
    ...(recordedArgs ? { recordedArgs } : {}),
    ...(runAfterAbort ? { runAfterAbort } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  };
}

function readVersion(repositoryRoot, relativePath) {
  try {
    const packageDocument = JSON.parse(
      readFileSync(path.join(repositoryRoot, relativePath), "utf8"),
    );
    return typeof packageDocument.version === "string"
      ? packageDocument.version
      : null;
  } catch {
    return null;
  }
}

function isExcludedInputPath(relativePath) {
  const segments = relativePath.split("/");
  return (
    EXCLUDED_INPUT_ROOTS.has(segments[0]) ||
    (segments[0] === "evidence" && segments[1] === "runs")
  );
}

function validateDiscoveredInputPath(relativePath) {
  if (
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    path.posix.normalize(relativePath) !== relativePath
  ) {
    return false;
  }
  const segments = relativePath.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

function parseDiscoveredInputPaths(rawOutput) {
  const entries = rawOutput.split("\0").filter((entry) => entry.length > 0);
  const paths = [];
  const seen = new Set();
  const rejectedPathDigests = [];
  let excludedGeneratedCount = 0;
  for (const relativePath of entries) {
    if (!validateDiscoveredInputPath(relativePath)) {
      rejectedPathDigests.push(sha256(relativePath));
      continue;
    }
    if (isExcludedInputPath(relativePath)) {
      excludedGeneratedCount += 1;
      continue;
    }
    if (seen.has(relativePath)) {
      rejectedPathDigests.push(sha256(relativePath));
      continue;
    }
    seen.add(relativePath);
    paths.push(relativePath);
  }
  paths.sort();
  return { paths, rejectedPathDigests, excludedGeneratedCount };
}

function unchangedFile(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

function hashRepositoryInput(repositoryRoot, canonicalRoot, relativePath) {
  const segments = relativePath.split("/");
  let cursor = repositoryRoot;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    const segmentStatus = lstatSync(cursor, { bigint: true });
    if (segmentStatus.isSymbolicLink()) {
      return { path: relativePath, type: "symbolic-link-rejected" };
    }
  }
  const canonicalFile = realpathSync(cursor);
  const containment = path.relative(canonicalRoot, canonicalFile);
  if (
    containment === "" ||
    containment === ".." ||
    containment.startsWith(`..${path.sep}`) ||
    path.isAbsolute(containment)
  ) {
    return { path: relativePath, type: "escape-rejected" };
  }

  const flags = fileConstants.O_RDONLY | (fileConstants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(cursor, flags);
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) {
      return { path: relativePath, type: "not-regular-file" };
    }
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0;
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      digest.update(buffer.subarray(0, count));
      bytes += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    const pathAfter = lstatSync(cursor, { bigint: true });
    if (
      pathAfter.isSymbolicLink() ||
      !unchangedFile(before, after) ||
      !unchangedFile(after, pathAfter) ||
      BigInt(bytes) !== after.size ||
      realpathSync(cursor) !== canonicalFile
    ) {
      return { path: relativePath, type: "changed-while-hashing" };
    }
    return {
      path: relativePath,
      type: "file",
      bytes,
      sha256: digest.digest("hex"),
    };
  } finally {
    closeSync(descriptor);
  }
}

function buildInputManifest(repositoryRoot, discovery) {
  const canonicalRoot = realpathSync(repositoryRoot);
  const files = discovery.paths.map((relativePath) => {
    try {
      return hashRepositoryInput(repositoryRoot, canonicalRoot, relativePath);
    } catch (error) {
      return {
        path: relativePath,
        type: error?.code === "ENOENT" ? "missing" : "unreadable",
        errorCode: error?.code ?? null,
      };
    }
  });
  const complete =
    files.length > 0 &&
    discovery.rejectedPathDigests.length === 0 &&
    files.every((entry) => entry.type === "file");
  return {
    algorithm: "sha256",
    discovery: {
      commandId: "meta_git_inputs",
      trackedAndUntrackedNonIgnored: true,
      excludedGeneratedCount: discovery.excludedGeneratedCount,
      rejectedPathDigests: discovery.rejectedPathDigests,
    },
    files,
    aggregateSha256: sha256(`${JSON.stringify(files)}\n`),
    complete,
  };
}

function buildReproducibilityBindings(inputManifest) {
  const configurationPattern =
    /^(?:\.editorconfig$|\.github\/workflows\/|\.gitignore$|\.npmrc$|\.nvmrc$|\.prettierignore$|\.prettierrc(?:\.[A-Za-z0-9_-]+)?$|Makefile$|coverage-policy\.json$|eslint\.config\.[cm]?[jt]s$|package\.json$|playwright\.config\.[cm]?[jt]s$|ports\.env$|tsconfig(?:\.[A-Za-z0-9_-]+)?\.json$|vite\.config\.[cm]?[jt]s$|vitest\.config\.[cm]?[jt]s$)/u;
  const lockfile = inputManifest.files.find(
    (entry) => entry.path === "package-lock.json" && entry.type === "file",
  );
  const configurations = inputManifest.files
    .filter(
      (entry) => entry.type === "file" && configurationPattern.test(entry.path),
    )
    .map(({ path: relativePath, bytes, sha256: digest }) => ({
      path: relativePath,
      bytes,
      sha256: digest,
    }));
  return {
    lockfile:
      lockfile === undefined
        ? null
        : {
            path: lockfile.path,
            bytes: lockfile.bytes,
            sha256: lockfile.sha256,
          },
    configurations,
    aggregateSha256: structuredSha256({
      lockfile: lockfile?.sha256 ?? null,
      configurations,
    }),
    complete:
      inputManifest.complete &&
      lockfile !== undefined &&
      configurations.length > 0,
  };
}

function walkBuildFiles(rootDirectory, currentDirectory = rootDirectory) {
  const entries = [];
  for (const name of readdirSync(currentDirectory).sort()) {
    const absolutePath = path.join(currentDirectory, name);
    const relativePath = path
      .relative(rootDirectory, absolutePath)
      .split(path.sep)
      .join("/");
    const status = lstatSync(absolutePath);
    if (status.isDirectory()) {
      const canonicalDirectory = realpathSync(absolutePath);
      if (!pathIsWithin(realpathSync(rootDirectory), canonicalDirectory)) {
        throw new Error("BUILD_DIRECTORY_ESCAPE");
      }
      entries.push(...walkBuildFiles(rootDirectory, absolutePath));
    } else if (status.isFile()) {
      const contents = hashRegularFile(absolutePath, rootDirectory);
      entries.push({
        path: relativePath,
        bytes: contents.bytes,
        sha256: contents.sha256,
      });
    } else {
      entries.push({ path: relativePath, type: "unsupported" });
    }
  }
  return entries;
}

function buildOutputManifest(repositoryRoot) {
  const outputRoot = path.join(repositoryRoot, "dist");
  try {
    const rootMetadata = lstatSync(outputRoot);
    if (
      rootMetadata.isSymbolicLink() ||
      !rootMetadata.isDirectory() ||
      realpathSync(outputRoot) !== outputRoot
    ) {
      throw new Error("BUILD_ROOT_UNSAFE");
    }
    const files = walkBuildFiles(outputRoot);
    return {
      root: "dist/",
      algorithm: "sha256",
      files,
      aggregateSha256: sha256(`${JSON.stringify(files)}\n`),
      complete:
        files.length > 0 && files.every((entry) => entry.sha256 !== undefined),
    };
  } catch (error) {
    return {
      root: "dist/",
      algorithm: "sha256",
      files: [],
      aggregateSha256: null,
      complete: false,
      errorCode: error?.code ?? "BUILD_MANIFEST_FAILED",
    };
  }
}

function parsePorts(repositoryRoot) {
  const contents = readFileSync(path.join(repositoryRoot, "ports.env"), "utf8");
  const parsed = {};
  const duplicateKeys = [];
  const invalidLineDigests = [];
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.+)$/.exec(line);
    if (!match) {
      invalidLineDigests.push(sha256(line));
      continue;
    }
    if (Object.hasOwn(parsed, match[1])) duplicateKeys.push(match[1]);
    parsed[match[1]] = match[2].trim();
  }
  const actual = {
    DEV_HOST: parsed.DEV_HOST,
    PORT_0: Number(parsed.PORT_0),
    PORT_1: Number(parsed.PORT_1),
    PORT_2: Number(parsed.PORT_2),
    PORT_3: Number(parsed.PORT_3),
  };
  const unexpectedKeys = Object.keys(parsed).filter(
    (key) => !(key in EXPECTED_PORTS),
  );
  const valid =
    Object.entries(EXPECTED_PORTS).every(
      ([key, value]) => actual[key] === value,
    ) &&
    unexpectedKeys.length === 0 &&
    duplicateKeys.length === 0 &&
    invalidLineDigests.length === 0;
  return {
    source: "ports.env",
    host: actual.DEV_HOST ?? null,
    assigned: [
      { service: "game-dev", port: actual.PORT_0 },
      { service: "production-preview", port: actual.PORT_1 },
      { service: "browser-history-e2e", port: actual.PORT_2 },
      { service: "static-bundle", port: actual.PORT_3 },
    ],
    reservedBlock: Array.from({ length: 10 }, (_, index) => 4140 + index),
    duplicateKeys: [...new Set(duplicateKeys)].sort(),
    unexpectedKeys: unexpectedKeys.sort(),
    invalidLineDigests,
    valid,
  };
}

function parseLifecycleResults(rawStdout) {
  const results = [];
  let malformed = false;
  for (const line of rawStdout.split(/\r?\n/)) {
    if (!line.startsWith(LIFECYCLE_RESULT_PREFIX)) continue;
    try {
      const parsed = JSON.parse(line.slice(LIFECYCLE_RESULT_PREFIX.length));
      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        parsed.schemaVersion !== LIFECYCLE_SCHEMA_VERSION
      ) {
        malformed = true;
      } else {
        results.push(parsed);
      }
    } catch {
      malformed = true;
    }
  }
  return { malformed, results };
}

function validateLifecycleServices(
  services,
  { ownership, invocationId, referenceServices, allowSubset = false } = {},
) {
  if (!Array.isArray(services)) return null;
  if (
    (!allowSubset && services.length !== HEALTH_SERVICES.length) ||
    (allowSubset && services.length > HEALTH_SERVICES.length)
  ) {
    return null;
  }
  const expectedByName = new Map(
    HEALTH_SERVICES.map((service) => [service.name, service]),
  );
  const referenceByName = referenceServices
    ? new Map(referenceServices.map((service) => [service.name, service]))
    : null;
  const seen = new Set();
  const normalized = [];
  for (const service of services) {
    const expected = expectedByName.get(service?.name);
    const reference = referenceByName?.get(service?.name);
    if (
      !expected ||
      seen.has(service.name) ||
      service.serviceId !== expected.serviceId ||
      service.port !== expected.port ||
      !UUID_PATTERN.test(service.runId ?? "") ||
      !UUID_PATTERN.test(service.startInvocationId ?? "") ||
      !Number.isSafeInteger(service.pid) ||
      service.pid <= 0
    ) {
      return null;
    }
    if (
      ownership === "started" &&
      (service.startedByInvocation !== true ||
        service.startInvocationId !== invocationId)
    ) {
      return null;
    }
    if (ownership === "reused" && service.startedByInvocation !== false) {
      return null;
    }
    if (
      reference &&
      (service.serviceId !== reference.serviceId ||
        service.port !== reference.port ||
        service.runId !== reference.runId ||
        service.startInvocationId !== reference.startInvocationId ||
        service.pid !== reference.pid)
    ) {
      return null;
    }
    seen.add(service.name);
    normalized.push({
      name: service.name,
      serviceId: service.serviceId,
      port: service.port,
      runId: service.runId,
      startInvocationId: service.startInvocationId,
      pid: service.pid,
      ...(typeof service.startedByInvocation === "boolean"
        ? { startedByInvocation: service.startedByInvocation }
        : {}),
    });
  }
  return normalized.sort((left, right) => left.name.localeCompare(right.name));
}

function validateUpLifecycle(rawStdout) {
  const parsed = parseLifecycleResults(rawStdout);
  const starting = parsed.results.filter(
    (result) => result.command === "up" && result.outcome === "STARTING",
  );
  const terminals = parsed.results.filter(
    (result) => result.command === "up" && result.outcome !== "STARTING",
  );
  const validStarting =
    starting.length === 1 &&
    parsed.results[0] === starting[0] &&
    UUID_PATTERN.test(starting[0].invocationId ?? "") &&
    starting[0].ownership === "pending" &&
    starting[0].exactOwned === true &&
    Array.isArray(starting[0].services) &&
    starting[0].services.length === 0;
  const cleanupInvocationId = validStarting ? starting[0].invocationId : null;
  if (
    parsed.malformed ||
    parsed.results.length !== 2 ||
    !validStarting ||
    terminals.length !== 1
  ) {
    return {
      valid: false,
      cleanupInvocationId,
      invocationId: null,
      ownership: null,
      services: null,
    };
  }
  const terminal = terminals[0];
  const ownership = terminal.ownership;
  const services = validateLifecycleServices(terminal.services, {
    ownership,
    invocationId: terminal.invocationId,
  });
  const valid =
    terminal.outcome === "PASS" &&
    parsed.results[1] === terminal &&
    terminal.invocationId === cleanupInvocationId &&
    terminal.exactOwned === true &&
    ["started", "reused"].includes(ownership) &&
    services !== null &&
    (ownership !== "reused" ||
      services.every(
        (service) => service.startInvocationId !== terminal.invocationId,
      ));
  return {
    valid,
    cleanupInvocationId,
    invocationId: valid ? terminal.invocationId : null,
    ownership: valid ? ownership : null,
    services: valid ? services : null,
  };
}

function validateHealthLifecycle(rawStdout, upProof) {
  const parsed = parseLifecycleResults(rawStdout);
  if (parsed.malformed || parsed.results.length !== 1) return null;
  const result = parsed.results[0];
  const services = validateLifecycleServices(result.services, {
    referenceServices: upProof.services,
  });
  if (
    result.command !== "health" ||
    result.outcome !== "PASS" ||
    result.exactOwned !== true ||
    !UUID_PATTERN.test(result.invocationId ?? "") ||
    services === null ||
    services.some((service) => service.startedByInvocation !== false) ||
    !rawStdout.includes("dev health passed: 4/4 exact-owned HTTP services")
  ) {
    return null;
  }
  return { invocationId: result.invocationId, services };
}

function validateDownLifecycle(rawStdout, invocationId, upProof) {
  const parsed = parseLifecycleResults(rawStdout);
  if (parsed.malformed || parsed.results.length !== 1) return null;
  const result = parsed.results[0];
  const services = validateLifecycleServices(result.services, {
    referenceServices: upProof?.services,
    allowSubset: upProof === null,
  });
  if (
    result.command !== "down" ||
    result.outcome !== "PASS" ||
    result.exactOwned !== true ||
    result.expectedInvocationId !== invocationId ||
    services === null ||
    services.some((service) => service.startInvocationId !== invocationId)
  ) {
    return null;
  }
  return { expectedInvocationId: invocationId, services };
}

function parseBrowserEvidence(rawStdout, commandOutcome) {
  if (commandOutcome !== "PASS") return null;
  try {
    const parsedBrowsers = JSON.parse(rawStdout.trim());
    const exactEvidence = {};
    for (const browserName of ["chromium", "firefox", "webkit"]) {
      const browserEvidence = parsedBrowsers?.[browserName];
      if (
        typeof browserEvidence?.version !== "string" ||
        browserEvidence.version.length === 0 ||
        !/^[0-9a-f]{64}$/iu.test(browserEvidence?.executable?.sha256 ?? "") ||
        !Number.isSafeInteger(browserEvidence?.executable?.bytes) ||
        browserEvidence.executable.bytes <= 0
      ) {
        return null;
      }
      exactEvidence[browserName] = {
        version: browserEvidence.version,
        executable: {
          bytes: browserEvidence.executable.bytes,
          sha256: browserEvidence.executable.sha256.toLowerCase(),
        },
      };
    }
    return exactEvidence;
  } catch {
    return null;
  }
}

function makeSummary(manifest) {
  const commandRows = manifest.commands
    .map(
      (command) =>
        `| \`${command.id}\` | ${command.outcome} | ${command.exitCode ?? "none"} | ${command.durationMs} |`,
    )
    .join("\n");
  return `# verify-all evidence: ${manifest.runId}

- **Outcome:** ${manifest.terminalOutcome}
- **Producer:** \`${manifest.producer.command}\`
- **Source commit:** \`${manifest.source.commit ?? "unavailable"}\`
- **Clean at start:** ${manifest.source.cleanStart.clean ? "yes" : "no"}
- **Started (UTC):** ${manifest.startedAtUtc}
- **Finished (UTC):** ${manifest.endedAtUtc}
- **Duration:** ${manifest.durationMs} ms
- **Redaction class:** ${manifest.redaction.classification}
- **Human redaction reviewer:** ${manifest.redaction.reviewer}
- **Allocated ports:** 127.0.0.1:4140-4143 (reserved block 4140-4149)

## Command outcomes

| Command ID | Outcome | Exit | Duration (ms) |
| ---------- | ------- | ---: | ------------: |
${commandRows}

Skipped steps are recorded in \`manifest.json\`. Ordered, redacted stream events
are in \`events.jsonl\`. Verify the adjacent artifact digests with
\`SHA256SUMS\` before relying on this run.
`;
}

async function writeFinalArtifacts({ runDirectory, eventsPath, manifest }) {
  const summaryPath = path.join(runDirectory, "summary.md");
  const manifestPath = path.join(runDirectory, "manifest.json");
  const checksumsPath = path.join(runDirectory, "SHA256SUMS");
  const summary = await formatWithPrettier(makeSummary(manifest), {
    parser: "markdown",
  });
  writeFileSync(summaryPath, summary, { encoding: "utf8", flag: "wx" });

  const eventDigest = sha256(readFileSync(eventsPath));
  const summaryDigest = sha256(readFileSync(summaryPath));
  manifest.artifacts = {
    events: {
      path: "events.jsonl",
      sha256: eventDigest,
    },
    summary: {
      path: "summary.md",
      sha256: summaryDigest,
    },
  };
  const manifestDocument = await formatWithPrettier(JSON.stringify(manifest), {
    parser: "json",
  });
  writeFileSync(manifestPath, manifestDocument, {
    encoding: "utf8",
    flag: "wx",
  });
  const manifestDigest = sha256(readFileSync(manifestPath));
  writeFileSync(
    checksumsPath,
    `${eventDigest}  events.jsonl\n${manifestDigest}  manifest.json\n${summaryDigest}  summary.md\n`,
    { encoding: "utf8", flag: "wx" },
  );
}

function normalizeRunnerResult(result) {
  return {
    exitCode:
      Number.isInteger(result?.exitCode) || result?.exitCode === null
        ? result.exitCode
        : 1,
    signal: typeof result?.signal === "string" ? result.signal : null,
    timedOut: result?.timedOut === true,
    aborted: result?.aborted === true,
    outputLimitExceeded: result?.outputLimitExceeded === true,
    terminationCause:
      typeof result?.terminationCause === "string"
        ? result.terminationCause
        : null,
    forcedTermination: result?.forcedTermination === true,
    processTreeScope:
      typeof result?.processTreeScope === "string"
        ? result.processTreeScope
        : null,
    trackedDescendantCount: Number.isSafeInteger(result?.trackedDescendantCount)
      ? result.trackedDescendantCount
      : 0,
    descendantTrackingErrorCode:
      typeof result?.descendantTrackingErrorCode === "string"
        ? result.descendantTrackingErrorCode
        : null,
    errorCode: typeof result?.errorCode === "string" ? result.errorCode : null,
    errorMessage:
      typeof result?.errorMessage === "string" ? result.errorMessage : null,
    totalOutputBytes: Number.isSafeInteger(result?.totalOutputBytes)
      ? result.totalOutputBytes
      : 0,
  };
}

/**
 * Runs the complete verification contract. Tests may inject a command runner;
 * the command-line entrypoint always uses the real process runner above.
 */
async function runVerificationCore(options = {}) {
  const monotonicStartedAt = process.hrtime.bigint();
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const executionMode = options.executionMode ?? "canonical-real-processes";
  const trustedTools =
    options.trustedToolsForTest ?? resolveTrustedTools(repositoryRoot);
  const startingToolIntegrity = trustedTools.integrity;
  const startingToolIntegritySha256 = structuredSha256(startingToolIntegrity);
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const runIdFactory =
    options.runIdFactory ?? ((date) => defaultRunIdFactory(date));
  const sourceEnvironment = options.sourceEnvironment ?? process.env;
  const runner = options.runner ?? createProcessRunner();
  const tee = options.tee ?? true;
  const callerAbortSignal = options.abortSignal;
  const totalTimeoutMs =
    options.totalTimeoutMsForTest ?? TOTAL_VERIFICATION_TIMEOUT_MS;
  const totalDeadlineController = new AbortController();
  let totalDeadlineExceeded = false;
  const totalDeadlineTimer = setTimeout(() => {
    totalDeadlineExceeded = true;
    totalDeadlineController.abort("total-verification-deadline");
  }, totalTimeoutMs);
  totalDeadlineTimer.unref?.();
  const abortSignal = callerAbortSignal
    ? AbortSignal.any([callerAbortSignal, totalDeadlineController.signal])
    : totalDeadlineController.signal;
  if (options.observedNodeVersionForTest !== undefined && !options.runner) {
    throw new Error("VERIFY_TEST_RUNTIME_OVERRIDE_REQUIRES_INJECTED_RUNNER");
  }
  const observedNodeVersion =
    options.observedNodeVersionForTest ?? process.version;
  const interruption = options.interruption ?? {
    signal: null,
    requestedAtUtc: null,
  };

  // Git identity, clean state, and the complete tracked/untracked input list
  // are captured before any evidence path exists, so the proof and manifest
  // cannot include or be dirtied by their own generated artifact.
  const provisionalRunId = runIdFactory(startedAt, 0);
  assertSafeRunId(provisionalRunId);
  const provisionalChildEnvironment = buildChildEnvironment(
    sourceEnvironment,
    repositoryRoot,
    provisionalRunId,
  );
  ensureSafeDirectory(
    repositoryRoot,
    `.dev/tmp/verify-all/${provisionalRunId}`,
  );
  ensureSafeDirectory(repositoryRoot, ".dev/cache/npm");
  ensureSafeDirectory(repositoryRoot, ".dev/cache/playwright");
  const gitCommitSpecification = materializeTrustedCommand(
    createSpecification({
      id: "meta_git_commit",
      label: "git rev-parse --verify HEAD",
      command: "git",
      args: ["rev-parse", "--verify", "HEAD"],
      timeoutMs: 60_000,
    }),
    trustedTools,
  );
  const gitStatusSpecification = materializeTrustedCommand(
    createSpecification({
      id: "meta_git_status",
      label: "git status --porcelain=v1 --untracked-files=all -z",
      command: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=all", "-z"],
      timeoutMs: 60_000,
    }),
    trustedTools,
  );
  const gitHeadTreeSpecification = materializeTrustedCommand(
    createSpecification({
      id: "meta_git_head_tree",
      label: "git rev-parse --verify HEAD^{tree}",
      command: "git",
      args: ["rev-parse", "--verify", "HEAD^{tree}"],
      timeoutMs: 60_000,
    }),
    trustedTools,
  );
  const gitIndexProofSpecification = materializeTrustedCommand(
    createSpecification({
      id: "meta_git_index_matches_head",
      label: "git diff-index --cached --quiet HEAD --",
      command: "git",
      args: ["diff-index", "--cached", "--quiet", "HEAD", "--"],
      timeoutMs: 60_000,
    }),
    trustedTools,
  );
  const gitInputsSpecification = materializeTrustedCommand(
    createSpecification({
      id: "meta_git_inputs",
      label: "git ls-files --cached --others --exclude-standard -z -- .",
      command: "git",
      args: [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ".",
      ],
      timeoutMs: 60_000,
    }),
    trustedTools,
  );
  const preludeCaptures = [];
  preludeCaptures.push(
    await captureCommand({
      runner,
      specification: gitCommitSpecification,
      repositoryRoot,
      childEnvironment: provisionalChildEnvironment,
      now,
      abortSignal,
    }),
  );
  preludeCaptures.push(
    await captureCommand({
      runner,
      specification: gitHeadTreeSpecification,
      repositoryRoot,
      childEnvironment: provisionalChildEnvironment,
      now,
      abortSignal,
    }),
  );
  preludeCaptures.push(
    await captureCommand({
      runner,
      specification: gitIndexProofSpecification,
      repositoryRoot,
      childEnvironment: provisionalChildEnvironment,
      now,
      abortSignal,
    }),
  );
  preludeCaptures.push(
    await captureCommand({
      runner,
      specification: gitStatusSpecification,
      repositoryRoot,
      childEnvironment: provisionalChildEnvironment,
      now,
      abortSignal,
    }),
  );
  preludeCaptures.push(
    await captureCommand({
      runner,
      specification: gitInputsSpecification,
      repositoryRoot,
      childEnvironment: provisionalChildEnvironment,
      now,
      abortSignal,
    }),
  );

  const preAllocationFailures = [];
  if (observedNodeVersion !== REQUIRED_NODE_VERSION) {
    preAllocationFailures.push("NODE_VERSION_MISMATCH");
  }
  const inputDiscoveryResult = normalizeRunnerResult(
    preludeCaptures[4].runnerResult,
  );
  preludeCaptures[4].runnerResult = inputDiscoveryResult;
  let inputManifest;
  if (
    inputDiscoveryResult.exitCode === 0 &&
    inputDiscoveryResult.errorCode === null &&
    !inputDiscoveryResult.aborted
  ) {
    const discovery = parseDiscoveredInputPaths(
      rawCapturedStream(preludeCaptures[4], "stdout"),
    );
    inputManifest = buildInputManifest(repositoryRoot, discovery);
    if (!inputManifest.complete) {
      preAllocationFailures.push("INPUT_MANIFEST_INCOMPLETE");
    }
  } else {
    inputManifest = {
      algorithm: "sha256",
      discovery: {
        commandId: "meta_git_inputs",
        trackedAndUntrackedNonIgnored: true,
        excludedGeneratedCount: 0,
        rejectedPathDigests: [],
      },
      files: [],
      aggregateSha256: sha256("[]\n"),
      complete: false,
    };
    preAllocationFailures.push("INPUT_DISCOVERY_FAILED");
  }
  const reproducibilityBindings = buildReproducibilityBindings(inputManifest);
  if (!reproducibilityBindings.complete) {
    preAllocationFailures.push("REPRODUCIBILITY_BINDINGS_INCOMPLETE");
  }

  let allocationAttempt = 0;
  const { runId, runDirectory } = allocateRunDirectory(
    repositoryRoot,
    startedAt,
    (date, attempt) => {
      allocationAttempt = attempt;
      if (attempt === 0) return provisionalRunId;
      return runIdFactory(date, attempt);
    },
  );
  const childEnvironment = buildChildEnvironment(
    sourceEnvironment,
    repositoryRoot,
    runId,
  );
  ensureSafeDirectory(repositoryRoot, `.dev/tmp/verify-all/${runId}`);
  const redact = createRedactor([
    sourceEnvironment,
    provisionalChildEnvironment,
    childEnvironment,
    {
      PLAYWRIGHT_BROWSERS_PATH: path.join(
        repositoryRoot,
        ".dev",
        "cache",
        "playwright",
      ),
      BTT_REUSE_OWNED_E2E_SERVER: "1",
      TRUSTED_GIT_PATH: trustedTools.gitPath,
      TRUSTED_NPM_CLI_PATH: trustedTools.npmCliPath,
      TRUSTED_NODE_PATH: process.execPath,
    },
  ]);
  const eventsPath = path.join(runDirectory, "events.jsonl");
  const writer = new EventWriter(eventsPath, now);
  const commands = [];
  const failures = [...preAllocationFailures];
  const skippedSteps = [];
  let buildManifest = null;
  let preliminaryBuildManifest = null;
  let playwright = {
    testPackageVersion: readVersion(
      repositoryRoot,
      "node_modules/@playwright/test/package.json",
    ),
    runtimePackageVersion: readVersion(
      repositoryRoot,
      "node_modules/playwright/package.json",
    ),
    browsers: null,
  };
  let npmVersion = null;
  let sourceCommit = null;
  let sourceHeadTree = null;
  let cleanStart = {
    clean: false,
    statusEntryCount: null,
    statusOutputSha256: null,
    headTree: null,
    indexMatchesHead: false,
    proofCommandIds: [
      "meta_git_commit",
      "meta_git_head_tree",
      "meta_git_index_matches_head",
      "meta_git_status",
    ],
  };
  let releaseTag = null;
  let releaseTags = [];
  let endStateProof;
  let endToolIntegritySha256 = null;
  let toolIntegrityStable;
  let ports;
  try {
    ports = parsePorts(repositoryRoot);
    if (!ports.valid) failures.push("PORT_CONTRACT_INVALID");
  } catch {
    ports = {
      source: "ports.env",
      host: null,
      assigned: [],
      reservedBlock: Array.from({ length: 10 }, (_, index) => 4140 + index),
      duplicateKeys: [],
      unexpectedKeys: [],
      invalidLineDigests: [],
      valid: false,
    };
    failures.push("PORT_CONTRACT_UNREADABLE");
  }

  writer.emit({
    type: "run_started",
    runId,
    producer:
      executionMode === "canonical-real-processes"
        ? "npm run verify-all"
        : "test-only injected verifier entrypoint",
    allocationAttempt,
  });

  const persistCapture = (capture) => {
    capture.runnerResult = normalizeRunnerResult(capture.runnerResult);
    const persisted = persistCommandCapture({
      capture,
      writer,
      redact,
      tee,
    });
    commands.push(persisted.result);
    return persisted;
  };

  const execute = async (specification) => {
    const trustedSpecification = materializeTrustedCommand(
      specification,
      trustedTools,
    );
    if (tee) process.stdout.write(`\n=== ${trustedSpecification.label} ===\n`);
    const capture = await captureCommand({
      runner,
      specification: trustedSpecification,
      repositoryRoot,
      childEnvironment,
      now,
      abortSignal: specification.runAfterAbort ? undefined : abortSignal,
    });
    return persistCapture(capture);
  };

  let ownedServicesValidated = false;
  let devServiceOwnership = "not-started";
  let cleanupInvocationId = null;
  let upLifecycleProof = null;
  let healthLifecycleProof = null;
  let downLifecycleProof = null;
  let cleanupState;
  const throwIfInterrupted = () => {
    if (!abortSignal?.aborted) return;
    const error = new Error("verification interrupted by parent signal");
    error.code = totalDeadlineExceeded
      ? "VERIFY_TOTAL_DEADLINE_EXCEEDED"
      : "VERIFY_INTERRUPTED";
    throw error;
  };
  try {
    const persistedCommit = persistCapture(preludeCaptures[0]);
    const commitCandidate = persistedCommit.rawStdout.trim();
    if (
      persistedCommit.result.outcome === "PASS" &&
      /^[0-9a-f]{40,64}$/i.test(commitCandidate)
    ) {
      sourceCommit = commitCandidate;
    } else {
      failures.push("SOURCE_COMMIT_UNAVAILABLE");
    }

    const persistedHeadTree = persistCapture(preludeCaptures[1]);
    const headTreeCandidate = persistedHeadTree.rawStdout.trim();
    if (
      persistedHeadTree.result.outcome === "PASS" &&
      /^[0-9a-f]{40,64}$/i.test(headTreeCandidate)
    ) {
      sourceHeadTree = headTreeCandidate;
    } else {
      failures.push("SOURCE_HEAD_TREE_UNAVAILABLE");
    }

    const persistedIndexProof = persistCapture(preludeCaptures[2]);
    const indexMatchesHead = persistedIndexProof.result.outcome === "PASS";
    if (!indexMatchesHead) failures.push("INDEX_DOES_NOT_MATCH_HEAD");

    const persistedStatus = persistCapture(preludeCaptures[3]);
    const statusOutput = persistedStatus.rawStdout;
    const statusEntries = statusOutput
      .split("\0")
      .filter((entry) => entry.length > 0);
    cleanStart = {
      clean:
        persistedStatus.result.outcome === "PASS" && statusEntries.length === 0,
      statusEntryCount:
        persistedStatus.result.outcome === "PASS" ? statusEntries.length : null,
      statusOutputSha256: sha256(statusOutput),
      headTree: sourceHeadTree,
      indexMatchesHead,
      proofCommandIds: [
        "meta_git_commit",
        "meta_git_head_tree",
        "meta_git_index_matches_head",
        "meta_git_status",
      ],
    };
    if (persistedStatus.result.outcome !== "PASS") {
      failures.push("CLEAN_START_PROOF_FAILED");
    } else if (statusEntries.length > 0) {
      failures.push("DIRTY_START");
    }

    const persistedInputs = persistCapture(preludeCaptures[4]);
    if (persistedInputs.result.outcome !== "PASS") {
      failures.push("INPUT_DISCOVERY_FAILED");
    }
    throwIfInterrupted();

    const tagResult = await execute(
      createSpecification({
        id: "meta_git_tag",
        label: "git tag --points-at HEAD",
        command: "git",
        args: ["tag", "--points-at", "HEAD"],
      }),
    );
    throwIfInterrupted();
    if (tagResult.result.outcome === "PASS") {
      releaseTags = tagResult.rawStdout
        .split(/\r?\n/)
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0)
        .sort();
      releaseTag = releaseTags[0] ?? null;
    } else {
      failures.push("TAG_PROBE_FAILED");
    }

    const npmResult = await execute(
      createSpecification({
        id: "meta_npm_version",
        label: "npm --version",
        command: "npm",
        args: ["--version"],
      }),
    );
    throwIfInterrupted();
    const npmCandidate = npmResult.rawStdout.trim();
    if (
      npmResult.result.outcome === "PASS" &&
      /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(npmCandidate)
    ) {
      npmVersion = npmCandidate;
      if (npmCandidate !== REQUIRED_NPM_VERSION) {
        failures.push("NPM_VERSION_MISMATCH");
      }
    } else {
      failures.push("NPM_VERSION_UNAVAILABLE");
    }

    const probeDigest = sha256(PLAYWRIGHT_VERSION_PROBE);
    const browserResult = await execute(
      createSpecification({
        id: "meta_playwright_versions",
        label: "Playwright installed-browser version probe",
        command: process.execPath,
        recordedCommand: "node",
        args: ["--input-type=module", "--eval", PLAYWRIGHT_VERSION_PROBE],
        recordedArgs: [
          "--input-type=module",
          "--eval",
          `<embedded-probe:sha256:${probeDigest}>`,
        ],
        environmentOverlay: {
          PLAYWRIGHT_BROWSERS_PATH: path.join(
            repositoryRoot,
            ".dev",
            "cache",
            "playwright",
          ),
        },
      }),
    );
    throwIfInterrupted();
    const startingBrowserEvidence = parseBrowserEvidence(
      browserResult.rawStdout,
      browserResult.result.outcome,
    );
    if (startingBrowserEvidence === null) {
      failures.push("PLAYWRIGHT_BROWSER_VERSIONS_UNAVAILABLE");
    } else {
      playwright = { ...playwright, browsers: startingBrowserEvidence };
    }
    if (
      playwright.testPackageVersion === null ||
      playwright.runtimePackageVersion === null
    ) {
      failures.push("PLAYWRIGHT_PACKAGE_VERSION_UNAVAILABLE");
    }

    for (const specification of MAIN_COMMANDS) {
      const commandResult = await execute(specification);
      throwIfInterrupted();
      if (commandResult.result.outcome !== "PASS") {
        failures.push(`COMMAND_FAILED:${specification.id}`);
      }
      if (
        specification.id === "build" &&
        commandResult.result.outcome === "PASS"
      ) {
        preliminaryBuildManifest = buildOutputManifest(repositoryRoot);
        if (!preliminaryBuildManifest.complete) {
          failures.push("PRELIMINARY_BUILD_MANIFEST_INCOMPLETE");
        }
      } else if (specification.id === "build") {
        preliminaryBuildManifest = {
          root: "dist/",
          algorithm: "sha256",
          files: [],
          aggregateSha256: null,
          complete: false,
          errorCode: "BUILD_COMMAND_FAILED",
        };
      }
    }

    if (failures.length === 0) {
      const preflight = await execute(DEV_COMMANDS.preflight);
      throwIfInterrupted();
      if (preflight.result.outcome !== "PASS") {
        failures.push("COMMAND_FAILED:dev_preflight");
      }
      if (failures.length === 0) {
        const up = await execute(DEV_COMMANDS.up);
        const parsedUpProof = validateUpLifecycle(up.rawStdout);
        cleanupInvocationId = parsedUpProof.cleanupInvocationId;
        if (parsedUpProof.valid) {
          upLifecycleProof = {
            invocationId: parsedUpProof.invocationId,
            ownership: parsedUpProof.ownership,
            services: parsedUpProof.services,
          };
          devServiceOwnership = parsedUpProof.ownership;
        } else if (cleanupInvocationId !== null) {
          devServiceOwnership = "starting-unconfirmed";
        } else {
          devServiceOwnership = "unproven";
        }
        if (up.result.outcome !== "PASS") {
          failures.push("COMMAND_FAILED:dev_up");
        }
        if (!parsedUpProof.valid) {
          failures.push("DEV_UP_OWNERSHIP_PROOF_INVALID");
        }
        if (up.result.outcome === "PASS" && parsedUpProof.valid) {
          buildManifest = buildOutputManifest(repositoryRoot);
          if (!buildManifest.complete) {
            failures.push("SERVED_BUILD_MANIFEST_INCOMPLETE");
          }
        }
        throwIfInterrupted();
      } else {
        skippedSteps.push({ id: "dev_up", reason: "dev_preflight_failed" });
      }
      if (failures.length === 0) {
        const health = await execute(DEV_COMMANDS.health);
        healthLifecycleProof = validateHealthLifecycle(
          health.rawStdout,
          upLifecycleProof,
        );
        ownedServicesValidated =
          health.result.outcome === "PASS" && healthLifecycleProof !== null;
        if (!ownedServicesValidated) {
          failures.push(
            health.result.outcome === "PASS"
              ? "OWNED_SERVICE_HEALTH_PROOF_INVALID"
              : "COMMAND_FAILED:dev_health",
          );
        }
        throwIfInterrupted();
      } else {
        skippedSteps.push({ id: "dev_health", reason: "dev_up_failed" });
      }
      if (failures.length === 0 && ownedServicesValidated) {
        for (const specification of [
          DEV_COMMANDS.e2e,
          DEV_COMMANDS.preview,
          DEV_COMMANDS.static,
        ]) {
          const e2e = await execute(specification);
          throwIfInterrupted();
          if (e2e.result.outcome !== "PASS") {
            failures.push(`COMMAND_FAILED:${specification.id}`);
          }
        }
      } else {
        for (const id of [
          "e2e_4142_all_browsers",
          "e2e_preview_4141_chromium",
          "e2e_static_4143_chromium",
        ]) {
          skippedSteps.push({
            id,
            reason: "validated_owned_services_unavailable",
          });
        }
      }
    } else {
      for (const id of [
        "dev_preflight",
        "dev_up",
        "dev_health",
        "e2e_4142_all_browsers",
        "e2e_preview_4141_chromium",
        "e2e_static_4143_chromium",
      ]) {
        skippedSteps.push({ id, reason: "earlier_verification_failure" });
      }
    }
  } catch (error) {
    failures.push(
      error?.code === "VERIFY_INTERRUPTED"
        ? "INTERRUPTED"
        : error?.code === "VERIFY_TOTAL_DEADLINE_EXCEEDED"
          ? "TOTAL_DEADLINE_EXCEEDED"
          : "VERIFY_ORCHESTRATION_EXCEPTION",
    );
    writer.emit({
      type: "orchestration_error",
      errorCode: error?.code ?? error?.name ?? "UNKNOWN",
      message: redact(error?.message ?? String(error)),
    });
  } finally {
    if (cleanupInvocationId !== null && devServiceOwnership !== "reused") {
      const downSpecification = {
        ...DEV_COMMANDS.down,
        label: `npm run dev:down -- --expected-invocation ${cleanupInvocationId}`,
        args: [
          "run",
          "dev:down",
          "--",
          "--expected-invocation",
          cleanupInvocationId,
        ],
      };
      const down = await execute(downSpecification);
      downLifecycleProof = validateDownLifecycle(
        down.rawStdout,
        cleanupInvocationId,
        upLifecycleProof?.ownership === "started" ? upLifecycleProof : null,
      );
      cleanupState = {
        attempted: true,
        commandId: "dev_down",
        expectedInvocationId: cleanupInvocationId,
        outcome:
          down.result.outcome === "PASS" && downLifecycleProof !== null
            ? "PASS"
            : "FAIL",
        reason: "verifier_up_invocation_lease_observed",
      };
      if (down.result.outcome !== "PASS") {
        failures.push("COMMAND_FAILED:dev_down");
      }
      if (downLifecycleProof === null) {
        failures.push("DEV_DOWN_PROOF_INVALID");
      }
    } else {
      cleanupState = {
        attempted: false,
        commandId: null,
        expectedInvocationId: null,
        outcome: "NOT_NEEDED",
        reason:
          devServiceOwnership === "reused"
            ? "preexisting_repository_services_preserved"
            : "verifier_did_not_start_services",
      };
      writer.emit({
        type: "cleanup_skipped",
        reason: cleanupState.reason,
        devServiceOwnership,
      });
    }
  }

  const endProofSpecifications = [
    createSpecification({
      id: "meta_git_commit_end",
      label: "git rev-parse --verify HEAD (end)",
      command: "git",
      args: ["rev-parse", "--verify", "HEAD"],
      runAfterAbort: true,
      timeoutMs: 60_000,
    }),
    createSpecification({
      id: "meta_git_head_tree_end",
      label: "git rev-parse --verify HEAD^{tree} (end)",
      command: "git",
      args: ["rev-parse", "--verify", "HEAD^{tree}"],
      runAfterAbort: true,
      timeoutMs: 60_000,
    }),
    createSpecification({
      id: "meta_git_index_matches_head_end",
      label: "git diff-index --cached --quiet HEAD -- (end)",
      command: "git",
      args: ["diff-index", "--cached", "--quiet", "HEAD", "--"],
      runAfterAbort: true,
      timeoutMs: 60_000,
    }),
    createSpecification({
      id: "meta_git_inputs_end",
      label: "git ls-files --cached --others --exclude-standard -z -- . (end)",
      command: "git",
      args: [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ".",
      ],
      runAfterAbort: true,
      timeoutMs: 60_000,
    }),
    createSpecification({
      id: "meta_git_tag_end",
      label: "git tag --points-at HEAD (end)",
      command: "git",
      args: ["tag", "--points-at", "HEAD"],
      runAfterAbort: true,
      timeoutMs: 60_000,
    }),
    createSpecification({
      id: "meta_playwright_versions_end",
      label: "Playwright installed-browser version probe (end)",
      command: process.execPath,
      recordedCommand: "node",
      args: ["--input-type=module", "--eval", PLAYWRIGHT_VERSION_PROBE],
      recordedArgs: [
        "--input-type=module",
        "--eval",
        `<embedded-probe:sha256:${sha256(PLAYWRIGHT_VERSION_PROBE)}>`,
      ],
      environmentOverlay: {
        PLAYWRIGHT_BROWSERS_PATH: path.join(
          repositoryRoot,
          ".dev",
          "cache",
          "playwright",
        ),
      },
      runAfterAbort: true,
      timeoutMs: 2 * 60_000,
    }),
  ];
  const endProofResults = [];
  for (const specification of endProofSpecifications) {
    endProofResults.push(await execute(specification));
  }
  const [endCommit, endHeadTree, endIndex, endInputs, endTag, endBrowserProbe] =
    endProofResults;
  let endingInputManifest = null;
  if (endInputs.result.outcome === "PASS") {
    endingInputManifest = buildInputManifest(
      repositoryRoot,
      parseDiscoveredInputPaths(endInputs.rawStdout),
    );
  }
  endStateProof = {
    commit: endCommit.rawStdout.trim() || null,
    headTree: endHeadTree.rawStdout.trim() || null,
    indexMatchesHead: endIndex.result.outcome === "PASS",
    inputAggregateSha256: endingInputManifest?.aggregateSha256 ?? null,
    releaseTagsStable:
      endTag.result.outcome === "PASS" &&
      structuredSha256(
        endTag.rawStdout
          .split(/\r?\n/)
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
          .sort(),
      ) === structuredSha256(releaseTags),
    stable:
      endCommit.result.outcome === "PASS" &&
      endCommit.rawStdout.trim() === sourceCommit &&
      endHeadTree.result.outcome === "PASS" &&
      endHeadTree.rawStdout.trim() === sourceHeadTree &&
      endIndex.result.outcome === "PASS" &&
      endTag.result.outcome === "PASS" &&
      structuredSha256(
        endTag.rawStdout
          .split(/\r?\n/)
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
          .sort(),
      ) === structuredSha256(releaseTags) &&
      endingInputManifest?.complete === true &&
      endingInputManifest.aggregateSha256 === inputManifest.aggregateSha256,
  };
  if (!endStateProof.stable)
    failures.push("SOURCE_OR_INPUTS_CHANGED_DURING_RUN");
  if (endTag.result.outcome !== "PASS") failures.push("TAG_END_PROBE_FAILED");

  const endingBrowserEvidence = parseBrowserEvidence(
    endBrowserProbe.rawStdout,
    endBrowserProbe.result.outcome,
  );
  const browserIntegrityStable =
    playwright.browsers !== null &&
    endingBrowserEvidence !== null &&
    structuredSha256(endingBrowserEvidence) ===
      structuredSha256(playwright.browsers);
  playwright = {
    ...playwright,
    endProbeBrowsers: endingBrowserEvidence,
    browserIntegrityStable,
  };
  if (!browserIntegrityStable) {
    failures.push("BROWSER_INTEGRITY_CHANGED_DURING_RUN");
  }

  if (buildManifest?.complete === true) {
    const endingBuildManifest = buildOutputManifest(repositoryRoot);
    const buildIntegrityStable =
      endingBuildManifest.complete === true &&
      endingBuildManifest.aggregateSha256 === buildManifest.aggregateSha256;
    buildManifest = {
      ...buildManifest,
      endProof: {
        complete: endingBuildManifest.complete,
        aggregateSha256: endingBuildManifest.aggregateSha256,
        stable: buildIntegrityStable,
      },
    };
    if (!buildIntegrityStable) {
      failures.push("SERVED_BUILD_CHANGED_DURING_RUN");
    }
  }

  try {
    const endingToolIntegrity = options.trustedToolsEndForTest
      ? options.trustedToolsEndForTest.integrity
      : options.trustedToolsForTest
        ? startingToolIntegrity
        : resolveTrustedTools(repositoryRoot).integrity;
    endToolIntegritySha256 = structuredSha256(endingToolIntegrity);
    toolIntegrityStable =
      endToolIntegritySha256 === startingToolIntegritySha256;
  } catch {
    toolIntegrityStable = false;
  }
  if (!toolIntegrityStable) {
    failures.push("TOOL_INTEGRITY_CHANGED_DURING_RUN");
  }

  const monotonicDurationMs = Number(
    (process.hrtime.bigint() - monotonicStartedAt) / 1_000_000n,
  );
  if (monotonicDurationMs > totalTimeoutMs) {
    totalDeadlineExceeded = true;
    totalDeadlineController.abort("total-verification-deadline");
  }
  clearTimeout(totalDeadlineTimer);
  const endedAt = now();
  if (abortSignal?.aborted) {
    failures.push(
      totalDeadlineExceeded ? "TOTAL_DEADLINE_EXCEEDED" : "INTERRUPTED",
    );
  }
  const uniqueFailures = [...new Set(failures)];
  const terminalOutcome = uniqueFailures.length === 0 ? "PASS" : "FAIL";
  if (Object.hasOwn(interruption, "terminalSealed")) {
    interruption.terminalSealed = true;
  }
  writer.emit({
    type: "run_finished",
    runId,
    outcome: terminalOutcome,
    failureCodes: uniqueFailures,
  });
  writer.close();

  const manifest = {
    schemaVersion: "btt.verify-all.evidence/v1",
    claimId:
      executionMode === "canonical-real-processes"
        ? "tier-0.verify-all"
        : "test-only.verify-all",
    runId,
    producer: {
      command:
        executionMode === "canonical-real-processes"
          ? "npm run verify-all"
          : "test-only injected verifier entrypoint",
      script: "scripts/verify-all.mjs",
      executionMode,
      canonicalClaimEligible: executionMode === "canonical-real-processes",
    },
    source: {
      commit: sourceCommit,
      releaseTag,
      releaseTags,
      cleanStart,
      endStateProof,
    },
    inputs: inputManifest,
    reproducibilityBindings,
    buildOutput: buildManifest,
    preliminaryBuildOutput: preliminaryBuildManifest,
    randomness: {
      status: "applicable",
      runIdentifier: {
        source:
          executionMode === "canonical-real-processes"
            ? "node:crypto.randomBytes"
            : "injected-test-run-id-factory",
        entropyBytes:
          executionMode === "canonical-real-processes" ? 6 : "test-defined",
        encodedInRunId: true,
      },
      reason:
        "Run identifiers use randomness; randomized child suites separately own and emit their seeds and case counts in ordered command evidence.",
    },
    startedAtUtc: startedAt.toISOString(),
    endedAtUtc: endedAt.toISOString(),
    durationMs: Math.max(0, endedAt.getTime() - startedAt.getTime()),
    monotonicDurationMs,
    system: {
      platform: process.platform,
      osType: os.type(),
      osRelease: os.release(),
      osVersion: os.version(),
      architecture: process.arch,
      node: observedNodeVersion,
      npm: npmVersion,
      playwright,
    },
    requiredRuntime: {
      node: REQUIRED_NODE_VERSION,
      npm: REQUIRED_NPM_VERSION,
      exactMatchRequired: true,
    },
    toolIntegrity: {
      algorithm: "sha256",
      start: startingToolIntegrity,
      startAggregateSha256: startingToolIntegritySha256,
      endAggregateSha256: endToolIntegritySha256,
      stable: toolIntegrityStable,
    },
    ports,
    serviceReuse: {
      allFourValidatedOwnedBeforeReuse: ownedServicesValidated,
      validationCommandId: "dev_health",
      lifecycleSchemaVersion: LIFECYCLE_SCHEMA_VERSION,
      up: upLifecycleProof,
      health: healthLifecycleProof,
      down: downLifecycleProof,
      reuseEnvironmentKey: "BTT_REUSE_OWNED_E2E_SERVER",
      targets: [
        {
          target: "e2e",
          serviceId: "browser-history-e2e",
          port: 4142,
          browsers: ["chromium", "firefox", "webkit"],
          commandId: "e2e_4142_all_browsers",
        },
        {
          target: "preview",
          serviceId: "production-preview",
          port: 4141,
          browsers: ["chromium"],
          commandId: "e2e_preview_4141_chromium",
        },
        {
          target: "static",
          serviceId: "static-bundle",
          port: 4143,
          browsers: ["chromium"],
          commandId: "e2e_static_4143_chromium",
        },
      ],
    },
    commandPolicy: {
      timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
      totalTimeoutMs,
      outputLimitBytes: MAX_COMMAND_OUTPUT_BYTES,
      childEnvironment: "allowlisted",
      timeoutTerminationScope:
        process.platform === "win32"
          ? "exact-windows-process-tree"
          : "dedicated-posix-process-group",
      recordedEnvironmentValues: false,
      passthroughNames: [
        "HOME",
        "LANG",
        "LC_ALL",
        "NODE_EXTRA_CA_CERTS",
        "NO_PROXY",
        "SSL_CERT_DIR",
        "SSL_CERT_FILE",
        "TZ",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        "HTTP_PROXY",
        "HTTPS_PROXY",
      ],
      pathSource: "trusted-node-directory-plus-fixed-system-directories",
    },
    commands,
    skippedSteps,
    cleanup: {
      ...cleanupState,
      evaluatedInFinally: true,
      devServiceOwnership,
    },
    interruption: {
      signal: interruption.signal,
      requestedAtUtc: interruption.requestedAtUtc,
      partialArtifactsFinalized: abortSignal?.aborted === true,
      totalDeadlineExceeded,
    },
    redaction: {
      classification: "INTERNAL_REDACTED",
      environmentValuesRecorded: false,
      policy: "length-preserving exact-value and credential-pattern masking",
      reviewer: "unassigned",
      publicationStatus: "human-review-required",
    },
    terminalOutcome,
    failureCodes: uniqueFailures,
    artifacts: {},
  };
  await writeFinalArtifacts({ runDirectory, eventsPath, manifest });
  if (tee) {
    process.stdout.write(
      `\nverify-all ${terminalOutcome}: evidence/runs/${runId}/summary.md\n`,
    );
  }
  return {
    exitCode: terminalOutcome === "PASS" ? 0 : 1,
    outcome: terminalOutcome,
    runId,
    runDirectory,
    manifest,
  };
}

export async function runVerification(options = {}) {
  const allowedOptionNames = new Set(["abortSignal", "interruption", "tee"]);
  if (Object.keys(options).some((key) => !allowedOptionNames.has(key))) {
    throw new Error("VERIFY_CANONICAL_INJECTION_FORBIDDEN");
  }
  const canonicalRepositoryRoot = realpathSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  return await runVerificationCore({
    abortSignal: options.abortSignal,
    interruption: options.interruption,
    tee: options.tee,
    repositoryRoot: canonicalRepositoryRoot,
    executionMode: "canonical-real-processes",
    runner: createProcessRunner(),
  });
}

export async function runVerificationForTest(options) {
  if (typeof options?.runner !== "function") {
    throw new Error("VERIFY_TEST_RUNNER_REQUIRED");
  }
  const hostRepositoryRoot = realpathSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
  const allowedTestRoot = ensureSafeDirectory(
    hostRepositoryRoot,
    ".dev/test-tmp",
  );
  const candidateRoot = realpathSync(path.resolve(options.repositoryRoot));
  if (
    candidateRoot === allowedTestRoot ||
    !pathIsWithin(allowedTestRoot, candidateRoot)
  ) {
    throw new Error("VERIFY_TEST_ROOT_OUTSIDE_ISOLATED_AREA");
  }
  return await runVerificationCore({
    ...options,
    repositoryRoot: candidateRoot,
    executionMode: "injected-test-noncanonical",
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const abortController = new AbortController();
  const interruption = {
    signal: null,
    requestedAtUtc: null,
    terminalSealed: false,
  };
  const signalHandlers = new Map();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (interruption.signal !== null || interruption.terminalSealed) return;
      interruption.signal = signal;
      interruption.requestedAtUtc = new Date().toISOString();
      abortController.abort(signal);
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  try {
    const result = await runVerification({
      abortSignal: abortController.signal,
      interruption,
    });
    process.exitCode =
      interruption.signal === "SIGINT"
        ? 130
        : interruption.signal === "SIGTERM"
          ? 143
          : result.exitCode;
  } catch (error) {
    process.stderr.write(
      `VERIFY_ALL_FATAL: ${error?.code ?? error?.name ?? "UNKNOWN"}\n`,
    );
    process.exitCode =
      interruption.signal === "SIGINT"
        ? 130
        : interruption.signal === "SIGTERM"
          ? 143
          : 1;
  } finally {
    for (const [signal, handler] of signalHandlers) {
      process.removeListener(signal, handler);
    }
  }
}
