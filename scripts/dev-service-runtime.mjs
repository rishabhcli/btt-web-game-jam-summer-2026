import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  closeSync,
  chmodSync,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
  rmSync,
} from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REPOSITORY_NAME = "btt-web-game-jam-summer-2026";
export const DEV_HOST = "127.0.0.1";
export const RECORD_VERSION = 2;
export const RECORD_STATES = Object.freeze([
  "claiming",
  "starting",
  "ready",
  "stopping",
  "failed",
]);
export const RESERVED_PORTS = Object.freeze([
  4144, 4145, 4146, 4147, 4148, 4149,
]);
export const SERVICE_HEADER = "x-btt-service-id";
export const RUN_HEADER = "x-btt-service-run-id";
export const MAX_RECORD_BYTES = 64 * 1024;
export const MAX_DIGEST_FILE_BYTES = 64 * 1024 * 1024;

const THIS_FILE = fileURLToPath(import.meta.url);
export const REPOSITORY_ROOT = realpathSync(resolve(dirname(THIS_FILE), ".."));
export const DEV_ROOT = resolve(REPOSITORY_ROOT, ".dev");
export const PID_ROOT = resolve(DEV_ROOT, "pids");
export const LOG_ROOT = resolve(DEV_ROOT, "logs");
export const TMP_ROOT = resolve(DEV_ROOT, "tmp");
export const CACHE_ROOT = resolve(DEV_ROOT, "cache");
export const PLAYWRIGHT_PROFILE_ROOT = resolve(DEV_ROOT, "pw-profile");
export const DIST_ROOT = resolve(REPOSITORY_ROOT, "dist");
export const SUPERVISOR_PATH = resolve(
  REPOSITORY_ROOT,
  "scripts/dev-service-supervisor.mjs",
);
export const NODE_EXECUTABLE = realpathSync(process.execPath);

const EXPECTED_PORTS = Object.freeze({
  PORT_0: 4140,
  PORT_1: 4141,
  PORT_2: 4142,
  PORT_3: 4143,
});

export const SERVICES = Object.freeze([
  Object.freeze({
    name: "game",
    packageScript: "serve:game",
    portKey: "PORT_0",
    port: 4140,
    serviceId: "game-dev",
    kind: "vite-dev",
    mode: "development",
    healthChecks: Object.freeze([
      Object.freeze({ path: "/@vite/client", kind: "vite-client" }),
      Object.freeze({ path: "/", kind: "game-html" }),
      Object.freeze({ path: "/src/main.ts", kind: "vite-module" }),
    ]),
  }),
  Object.freeze({
    name: "preview",
    packageScript: "serve:preview",
    portKey: "PORT_1",
    port: 4141,
    serviceId: "production-preview",
    kind: "vite-preview",
    mode: "production",
    healthChecks: Object.freeze([
      Object.freeze({ path: "/", kind: "game-html" }),
    ]),
  }),
  Object.freeze({
    name: "e2e",
    packageScript: "serve:e2e",
    portKey: "PORT_2",
    port: 4142,
    serviceId: "browser-history-e2e",
    kind: "vite-dev",
    mode: "test",
    healthChecks: Object.freeze([
      Object.freeze({ path: "/@vite/client", kind: "vite-client" }),
      Object.freeze({ path: "/", kind: "game-html" }),
      Object.freeze({ path: "/src/main.ts", kind: "vite-module" }),
    ]),
  }),
  Object.freeze({
    name: "static",
    packageScript: "serve:static",
    portKey: "PORT_3",
    port: 4143,
    serviceId: "static-bundle",
    kind: "static",
    mode: "production",
    healthChecks: Object.freeze([
      Object.freeze({ path: "/__health", kind: "static-health" }),
      Object.freeze({ path: "/", kind: "game-html" }),
    ]),
  }),
]);

export const SERVICE_BY_NAME = new Map(
  SERVICES.map((service) => [service.name, service]),
);

export const SERVICE_INTEGRITY_INPUTS = Object.freeze([
  "src",
  "index.html",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.base.json",
  "tsconfig.domain.json",
  "tsconfig.app.json",
  "tsconfig.test.json",
  "tsconfig.e2e.json",
  "tsconfig.node.json",
  "scripts/static-server.mjs",
  "scripts/vite-service.mjs",
  "scripts/safe-environment.mjs",
  "scripts/dev-services.mjs",
  "scripts/dev-service-runtime.mjs",
  "scripts/dev-service-supervisor.mjs",
  "scripts/owned-process-runner.mjs",
  "scripts/owned-process-snapshot.c",
  "scripts/check-local-state.mjs",
  "scripts/dev-process-cwd.c",
  "scripts/dev-socket-listeners.c",
]);

export class DevRuntimeError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "DevRuntimeError";
    this.code = code;
    this.details = details;
  }
}

export function runtimeFail(code, message, details) {
  throw new DevRuntimeError(code, message, details);
}

export function isWithinRoot(root, candidate) {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) &&
      fromRoot !== ".." &&
      !isAbsolute(fromRoot))
  );
}

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

export function assertSafeExistingNode(
  path,
  { kind, ownerUid = currentUid(), rejectWritable = true } = {},
) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) {
    runtimeFail("DEV_PATH_SYMLINK_FORBIDDEN", `${path} must not be a symlink`);
  }
  if (kind === "directory" && !metadata.isDirectory()) {
    runtimeFail("DEV_PATH_TYPE_INVALID", `${path} must be a directory`);
  }
  if (kind === "file" && !metadata.isFile()) {
    runtimeFail("DEV_PATH_TYPE_INVALID", `${path} must be a regular file`);
  }
  if (ownerUid !== undefined && metadata.uid !== ownerUid) {
    runtimeFail(
      "DEV_PATH_OWNER_INVALID",
      `${path} is not owned by the current user`,
    );
  }
  if (rejectWritable && (metadata.mode & 0o022) !== 0) {
    runtimeFail(
      "DEV_PATH_MODE_UNSAFE",
      `${path} must not be group- or world-writable`,
    );
  }
  return metadata;
}

/**
 * Revalidate every existing component below .dev immediately before a
 * security-sensitive file operation.  Node does not expose portable dirfd
 * operations, so callers still use O_EXCL/O_NOFOLLOW or atomic rename for the
 * leaf; this component walk prevents a pre-created .dev symlink tree from
 * redirecting logs, records, or lifecycle locks outside the repository.
 */
export function assertSafePathComponents(
  root,
  path,
  { leafKind, allowMissingLeaf = false } = {},
) {
  const absolutePath = resolve(path);
  const absoluteRoot = resolve(root);
  if (!isWithinRoot(absoluteRoot, absolutePath)) {
    runtimeFail(
      "DEV_PATH_ESCAPE",
      `${absolutePath} is outside ${absoluteRoot}`,
    );
  }
  const relativePath = relative(absoluteRoot, absolutePath);
  const components = relativePath === "" ? [] : relativePath.split(sep);
  let current = absoluteRoot;
  assertSafeExistingNode(current, { kind: "directory" });
  for (const [index, component] of components.entries()) {
    current = resolve(current, component);
    const isLeaf = index === components.length - 1;
    try {
      assertSafeExistingNode(current, {
        kind: isLeaf ? leafKind : "directory",
      });
    } catch (error) {
      if (isLeaf && allowMissingLeaf && error?.code === "ENOENT") return;
      throw error;
    }
  }
}

export function assertSafeDevPath(path, options = {}) {
  return assertSafePathComponents(DEV_ROOT, path, options);
}

export async function ensureSafeDevLayout() {
  assertSafeExistingNode(REPOSITORY_ROOT, {
    kind: "directory",
    rejectWritable: false,
  });
  for (const directory of [
    DEV_ROOT,
    PID_ROOT,
    LOG_ROOT,
    TMP_ROOT,
    CACHE_ROOT,
    PLAYWRIGHT_PROFILE_ROOT,
  ]) {
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    assertSafeExistingNode(directory, { kind: "directory" });
    const resolvedDirectory = await realpath(directory);
    if (!isWithinRoot(REPOSITORY_ROOT, resolvedDirectory)) {
      runtimeFail(
        "DEV_PATH_ESCAPE",
        `${directory} resolves outside ${REPOSITORY_ROOT}`,
      );
    }
    await chmod(directory, 0o700);
  }
}

export function openSafeAppend(path) {
  if (!isWithinRoot(DEV_ROOT, resolve(path))) {
    runtimeFail("DEV_LOG_PATH_ESCAPE", `${path} is outside .dev`);
  }
  assertSafeDevPath(path, { leafKind: "file", allowMissingLeaf: true });
  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_APPEND |
    fsConstants.O_CREAT |
    (fsConstants.O_NOFOLLOW ?? 0);
  const descriptor = openSync(path, flags, 0o600);
  const opened = fstatSync(descriptor);
  if (
    !opened.isFile() ||
    opened.nlink !== 1 ||
    (currentUid() !== undefined && opened.uid !== currentUid())
  ) {
    closeSync(descriptor);
    runtimeFail("DEV_LOG_FILE_INVALID", `${path} is not a safe regular file`);
  }
  return descriptor;
}

export function parsePortsEnv(source) {
  const values = new Map();
  for (const [lineIndex, rawLine] of source.split(/\r?\n/u).entries()) {
    const line = rawLine.replace(/\s+#.*$/u, "").trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(\S+)$/u.exec(line);
    if (!match) {
      runtimeFail(
        "DEV_PORTS_SYNTAX_INVALID",
        `ports.env line ${lineIndex + 1} is invalid`,
      );
    }
    if (values.has(match[1])) {
      runtimeFail("DEV_PORTS_DUPLICATE_KEY", `ports.env repeats ${match[1]}`);
    }
    values.set(match[1], match[2]);
  }
  if (values.get("DEV_HOST") !== DEV_HOST) {
    runtimeFail("DEV_HOST_INVALID", `DEV_HOST must be ${DEV_HOST}`);
  }
  for (const [key, expected] of Object.entries(EXPECTED_PORTS)) {
    if (Number(values.get(key)) !== expected) {
      runtimeFail("DEV_PORT_INVALID", `${key} must be ${expected}`);
    }
  }
  const extra = [...values.keys()].filter(
    (key) => key.startsWith("PORT_") && !(key in EXPECTED_PORTS),
  );
  if (extra.length > 0) {
    runtimeFail(
      "DEV_PORT_ALLOCATION_FORBIDDEN",
      `unassigned ports cannot be allocated: ${extra.join(", ")}`,
    );
  }
  return Object.freeze({
    host: DEV_HOST,
    ports: Object.freeze({ ...EXPECTED_PORTS }),
  });
}

function absoluteTool(candidates, name) {
  for (const candidate of candidates) {
    try {
      const resolved = realpathSync(candidate);
      const metadata = lstatSync(resolved);
      if (metadata.isFile()) return resolved;
    } catch {
      // Try the next fixed, trusted system location.
    }
  }
  runtimeFail("DEV_IDENTITY_TOOL_MISSING", `${name} is unavailable`);
}

const PS_PATH = absoluteTool(
  process.platform === "darwin" ? ["/bin/ps"] : ["/usr/bin/ps", "/bin/ps"],
  "ps",
);
const GIT_PATH = absoluteTool(["/usr/bin/git", "/bin/git"], "git");
const MAC_CWD_SOURCE = resolve(REPOSITORY_ROOT, "scripts/dev-process-cwd.c");
const MAC_SOCKET_SOURCE = resolve(
  REPOSITORY_ROOT,
  "scripts/dev-socket-listeners.c",
);
let lsofPath;
let clangPath;

function trustedLsofPath() {
  lsofPath ??= absoluteTool(["/usr/bin/lsof", "/usr/sbin/lsof"], "lsof");
  return lsofPath;
}

function trustedClangPath() {
  clangPath ??= absoluteTool(["/usr/bin/clang"], "clang");
  return clangPath;
}

export function sanitizedEnvironment(additions = {}) {
  const environment = {};
  for (const key of ["CI", "HOME", "LANG", "LC_ALL", "TZ"]) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) environment[key] = value;
  }
  environment.PATH =
    process.platform === "darwin"
      ? "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      : "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  environment.TEMP = TMP_ROOT;
  environment.TMP = TMP_ROOT;
  environment.TMPDIR = TMP_ROOT;
  environment.XDG_CACHE_HOME = CACHE_ROOT;
  for (const [key, value] of Object.entries(additions)) {
    if (
      key === "COMPOSE_PROJECT_NAME" ||
      key === "npm_config_cache" ||
      key.startsWith("BTT_")
    ) {
      environment[key] = value;
    }
  }
  return environment;
}

function runIdentityTool(executable, arguments_, timeout = 15_000) {
  const result = spawnSync(executable, arguments_, {
    encoding: "utf8",
    env: sanitizedEnvironment(),
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return undefined;
  return result.stdout;
}

let macCwdHelperPath;
let macSocketHelperPath;

function ensureMacCwdHelper() {
  if (macCwdHelperPath) return macCwdHelperPath;
  assertSafeExistingNode(MAC_CWD_SOURCE, {
    kind: "file",
    rejectWritable: true,
  });
  assertSafeDevPath(TMP_ROOT, { leafKind: "directory" });
  const candidate = resolve(
    TMP_ROOT,
    `dev-process-cwd.${process.pid}.${randomUUID()}`,
  );
  const compilation = spawnSync(
    trustedClangPath(),
    ["-O2", "-Wall", "-Wextra", "-Werror", MAC_CWD_SOURCE, "-o", candidate],
    {
      encoding: "utf8",
      env: {
        HOME: process.env.HOME ?? REPOSITORY_ROOT,
        LC_ALL: "C",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        TMPDIR: TMP_ROOT,
      },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (compilation.error || compilation.status !== 0) {
    rmSync(candidate, { force: true });
    runtimeFail(
      "DEV_CWD_HELPER_BUILD_FAILED",
      `native cwd helper failed to build: ${compilation.stderr?.trim() || compilation.error?.message || "unknown"}`,
    );
  }
  chmodSync(candidate, 0o700);
  assertSafeDevPath(candidate, { leafKind: "file" });
  macCwdHelperPath = realpathSync(candidate);
  process.once("exit", () => rmSync(candidate, { force: true }));
  return macCwdHelperPath;
}

function ensureMacSocketHelper() {
  if (macSocketHelperPath) return macSocketHelperPath;
  assertSafeExistingNode(MAC_SOCKET_SOURCE, {
    kind: "file",
    rejectWritable: true,
  });
  assertSafeDevPath(TMP_ROOT, { leafKind: "directory" });
  const candidate = resolve(
    TMP_ROOT,
    `dev-socket-listeners.${process.pid}.${randomUUID()}`,
  );
  const compilation = spawnSync(
    trustedClangPath(),
    ["-O2", "-Wall", "-Wextra", "-Werror", MAC_SOCKET_SOURCE, "-o", candidate],
    {
      encoding: "utf8",
      env: {
        HOME: process.env.HOME ?? REPOSITORY_ROOT,
        LC_ALL: "C",
        PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
        TMPDIR: TMP_ROOT,
      },
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (compilation.error || compilation.status !== 0) {
    rmSync(candidate, { force: true });
    runtimeFail(
      "DEV_SOCKET_HELPER_BUILD_FAILED",
      `native socket helper failed to build: ${compilation.stderr?.trim() || compilation.error?.message || "unknown"}`,
    );
  }
  chmodSync(candidate, 0o700);
  assertSafeDevPath(candidate, { leafKind: "file" });
  macSocketHelperPath = realpathSync(candidate);
  process.once("exit", () => rmSync(candidate, { force: true }));
  return macSocketHelperPath;
}

function processCwd(pid) {
  if (pid === process.pid) return realpathSync(process.cwd());
  if (process.platform === "linux") {
    try {
      return realpathSync(`/proc/${pid}/cwd`);
    } catch {
      return undefined;
    }
  }
  const output = runIdentityTool(ensureMacCwdHelper(), [String(pid)], 5_000);
  const cwdLine = output?.trim();
  if (!cwdLine) return undefined;
  try {
    return realpathSync(cwdLine);
  } catch {
    return undefined;
  }
}

export function parsePsIdentity(output, cwd) {
  const match =
    /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.+?)\s*$/u.exec(
      output,
    );
  if (!match || !cwd) return undefined;
  return Object.freeze({
    pid: Number(match[1]),
    parentPid: Number(match[2]),
    processGroupId: Number(match[3]),
    sessionId: match[4],
    startToken: match[5].replace(/\s+/gu, " "),
    command: match[6].replace(/\s+/gu, " "),
    cwd,
  });
}

export function readProcessIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return undefined;
  const sessionField = process.platform === "darwin" ? "sess" : "sid";
  const arguments_ = [
    "-p",
    String(pid),
    "-o",
    `pid=,ppid=,pgid=,${sessionField}=,lstart=,command=`,
  ];
  const beforeOutput = runIdentityTool(PS_PATH, arguments_);
  if (!beforeOutput) return undefined;
  const cwd = processCwd(pid);
  if (!cwd) return undefined;
  const afterOutput = runIdentityTool(PS_PATH, arguments_);
  if (!afterOutput) return undefined;
  const before = parsePsIdentity(beforeOutput, cwd);
  const after = parsePsIdentity(afterOutput, cwd);
  return processIdentityEqual(before, after) ? after : undefined;
}

export function processIdentityEqual(expected, actual) {
  return Boolean(
    expected &&
    actual &&
    expected.pid === actual.pid &&
    expected.processGroupId === actual.processGroupId &&
    expected.sessionId === actual.sessionId &&
    expected.startToken === actual.startToken &&
    expected.command === actual.command &&
    expected.cwd === actual.cwd,
  );
}

export function supervisorCommand(service, runId) {
  return `${NODE_EXECUTABLE} ${SUPERVISOR_PATH} --service ${service.name} --run-id ${runId}`;
}

export function validateSupervisorIdentity(service, runId, identity) {
  return Boolean(
    identity &&
    identity.cwd === REPOSITORY_ROOT &&
    identity.command === supervisorCommand(service, runId) &&
    identity.processGroupId === identity.pid,
  );
}

export function parseMacNetstatListeners(output, port) {
  const listeners = [];
  for (const line of output.split(/\r?\n/u)) {
    const columns = line.trim().split(/\s+/u);
    const localAddress = columns[3];
    const listenIndex = columns.indexOf("LISTEN");
    if (
      !["tcp4", "tcp6"].includes(columns[0]) ||
      listenIndex < 0 ||
      typeof localAddress !== "string" ||
      (!localAddress.endsWith(`.${port}`) && !localAddress.endsWith(`:${port}`))
    ) {
      continue;
    }
    const processColumn = columns
      .slice(listenIndex + 1)
      .find((column) => /^[^:]+:[0-9]+$/u.test(column));
    const pidMatch = /^[^:]+:([0-9]+)$/u.exec(processColumn ?? "");
    if (!pidMatch) {
      runtimeFail(
        "DEV_SOCKET_PID_MISSING",
        `netstat omitted the PID for ${localAddress}`,
      );
    }
    listeners.push({
      pid: Number(pidMatch[1]),
      protocol: columns[0],
      localAddress,
    });
  }
  return listeners;
}

export function parseMacNativeSocketListeners(output, port) {
  const listeners = [];
  for (const line of output.split(/\r?\n/u)) {
    if (line === "") continue;
    const match = /^(\d+)\t(tcp4|tcp6)\t([^\t]+)\t(\d+)$/u.exec(line);
    if (!match) {
      runtimeFail(
        "DEV_SOCKET_HELPER_OUTPUT_INVALID",
        "native socket helper returned malformed output",
      );
    }
    const pid = Number(match[1]);
    const observedPort = Number(match[4]);
    if (
      !Number.isSafeInteger(pid) ||
      pid <= 1 ||
      !Number.isSafeInteger(observedPort) ||
      observedPort < 1 ||
      observedPort > 65_535
    ) {
      runtimeFail(
        "DEV_SOCKET_HELPER_OUTPUT_INVALID",
        "native socket helper returned an invalid PID or port",
      );
    }
    if (observedPort !== port) continue;
    const address = match[3];
    listeners.push({
      pid,
      protocol: match[2],
      localAddress:
        match[2] === "tcp6"
          ? `[${address}]:${observedPort}`
          : `${address}:${observedPort}`,
    });
  }
  return listeners;
}

export function parseLsofSocketListeners(output, port) {
  const listeners = [];
  let pid;
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    if (line.startsWith("n") && Number.isSafeInteger(pid)) {
      const endpoint = line.slice(1).split("->", 1)[0];
      if (endpoint.endsWith(`:${port}`)) {
        listeners.push({ pid, protocol: "tcp", localAddress: endpoint });
      }
    }
  }
  return listeners;
}

export function readSocketListeners(port) {
  if (process.platform === "darwin") {
    const output = runIdentityTool(ensureMacSocketHelper(), [], 30_000);
    if (output === undefined) {
      runtimeFail(
        "DEV_SOCKET_INSPECTION_FAILED",
        "native socket inspection failed",
      );
    }
    return parseMacNativeSocketListeners(output, port);
  }
  const output = runIdentityTool(trustedLsofPath(), [
    "-nP",
    "-Fpn",
    `-iTCP:${port}`,
    "-sTCP:LISTEN",
  ]);
  if (output === undefined) return [];
  return parseLsofSocketListeners(output, port);
}

export function assertExactSocketOwnership(service, listeners, expectedPids) {
  const normalizedExpected = [...new Set(expectedPids)].sort((a, b) => a - b);
  const normalizedActual = [...new Set(listeners.map(({ pid }) => pid))].sort(
    (a, b) => a - b,
  );
  if (
    normalizedActual.length !== normalizedExpected.length ||
    normalizedActual.some((pid, index) => pid !== normalizedExpected[index])
  ) {
    runtimeFail(
      "DEV_SOCKET_OWNER_MISMATCH",
      `${service.name} socket holders ${normalizedActual.join(",") || "none"} do not equal recorded holders ${normalizedExpected.join(",") || "none"}`,
    );
  }
  const expectedMacAddress = `${DEV_HOST}.${service.port}`;
  const expectedOtherAddress = `${DEV_HOST}:${service.port}`;
  for (const listener of listeners) {
    if (
      listener.localAddress !== expectedMacAddress &&
      listener.localAddress !== expectedOtherAddress
    ) {
      runtimeFail(
        "DEV_SOCKET_INTERFACE_MISMATCH",
        `${service.name} has a non-loopback listener ${listener.localAddress}`,
      );
    }
    if (listener.protocol === "tcp6") {
      runtimeFail(
        "DEV_SOCKET_INTERFACE_MISMATCH",
        `${service.name} must not expose an IPv6 listener`,
      );
    }
  }
  return true;
}

function validateRelativeAssetPath(path) {
  const normalized = path.replace(/^\//u, "").split(/[?#]/u, 1)[0];
  if (
    normalized === "" ||
    isAbsolute(normalized) ||
    normalized.split("/").some((part) => part === ".." || part === ".")
  ) {
    runtimeFail("DEV_BUILD_ASSET_PATH_INVALID", `invalid build asset ${path}`);
  }
  return normalized;
}

async function safeRegularFile(
  path,
  root,
  maximumBytes = MAX_DIGEST_FILE_BYTES,
) {
  const relativePath = relative(root, path);
  if (!isWithinRoot(root, resolve(path))) {
    runtimeFail("DEV_DIGEST_INPUT_ESCAPE", `${path} is outside ${root}`);
  }
  let componentPath = root;
  for (const component of relativePath.split(sep).filter(Boolean)) {
    componentPath = resolve(componentPath, component);
    const componentMetadata = await lstat(componentPath);
    if (componentMetadata.isSymbolicLink()) {
      runtimeFail(
        "DEV_DIGEST_SYMLINK_FORBIDDEN",
        `${componentPath} must not be a symlink`,
      );
    }
  }
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1) {
    runtimeFail("DEV_DIGEST_INPUT_INVALID", `${path} must be a regular file`);
  }
  if (metadata.size > maximumBytes) {
    runtimeFail(
      "DEV_DIGEST_INPUT_TOO_LARGE",
      `${path} exceeds the digest limit`,
    );
  }
  const resolvedPath = await realpath(path);
  if (!isWithinRoot(root, resolvedPath)) {
    runtimeFail("DEV_DIGEST_INPUT_ESCAPE", `${path} resolves outside ${root}`);
  }
  return { metadata, resolvedPath };
}

async function collectInputFiles(path, root, output) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    runtimeFail(
      "DEV_DIGEST_SYMLINK_FORBIDDEN",
      `${path} must not be a symlink`,
    );
  }
  if (metadata.isDirectory()) {
    const entries = await readdir(path);
    entries.sort();
    for (const entry of entries) {
      await collectInputFiles(resolve(path, entry), root, output);
    }
    return;
  }
  if (!metadata.isFile()) {
    runtimeFail("DEV_DIGEST_INPUT_INVALID", `${path} is not a regular input`);
  }
  await safeRegularFile(path, root);
  output.push(path);
}

async function hashFiles(paths, root) {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    const relativePath = relative(root, path);
    const contents = await readFile(path);
    hash.update(relativePath, "utf8");
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function computeSourceDigest() {
  const inputs = [];
  for (const relativePath of SERVICE_INTEGRITY_INPUTS) {
    const path = resolve(REPOSITORY_ROOT, relativePath);
    await collectInputFiles(path, REPOSITORY_ROOT, inputs);
  }
  return Object.freeze({
    algorithm: "sha256",
    digest: await hashFiles(inputs, REPOSITORY_ROOT),
    fileCount: inputs.length,
  });
}

export async function inspectBuildIntegrity(
  buildRoot = DIST_ROOT,
  { expectedRoot = DIST_ROOT } = {},
) {
  const rootMetadata = await lstat(buildRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    runtimeFail("DEV_BUILD_ROOT_INVALID", "dist must be a real directory");
  }
  if (currentUid() !== undefined && rootMetadata.uid !== currentUid()) {
    runtimeFail("DEV_BUILD_ROOT_OWNER_INVALID", "dist owner is invalid");
  }
  if ((rootMetadata.mode & 0o022) !== 0) {
    runtimeFail("DEV_BUILD_ROOT_MODE_INVALID", "dist mode is unsafe");
  }
  const resolvedRoot = await realpath(buildRoot);
  if (resolvedRoot !== expectedRoot) {
    runtimeFail(
      "DEV_BUILD_ROOT_ESCAPE",
      "dist resolves outside the repository",
    );
  }

  const indexPath = resolve(resolvedRoot, "index.html");
  const manifestPath = resolve(resolvedRoot, ".vite/manifest.json");
  await safeRegularFile(indexPath, resolvedRoot, 2 * 1024 * 1024);
  await safeRegularFile(manifestPath, resolvedRoot, 2 * 1024 * 1024);
  const [indexSource, manifestSource] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(manifestPath, "utf8"),
  ]);
  let manifest;
  try {
    manifest = JSON.parse(manifestSource);
  } catch {
    runtimeFail("DEV_BUILD_MANIFEST_INVALID", "Vite manifest is invalid JSON");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    runtimeFail(
      "DEV_BUILD_MANIFEST_INVALID",
      "Vite manifest must be an object",
    );
  }

  const relativeAssets = new Set();
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== "object") {
      runtimeFail("DEV_BUILD_MANIFEST_INVALID", "manifest entry is invalid");
    }
    if (
      typeof entry.file !== "string" ||
      (entry.css !== undefined && !Array.isArray(entry.css)) ||
      (entry.assets !== undefined && !Array.isArray(entry.assets))
    ) {
      runtimeFail(
        "DEV_BUILD_MANIFEST_INVALID",
        "manifest entry assets are invalid",
      );
    }
    for (const value of [
      entry.file,
      ...(entry.css ?? []),
      ...(entry.assets ?? []),
    ]) {
      if (typeof value !== "string") {
        runtimeFail("DEV_BUILD_MANIFEST_INVALID", "manifest asset is invalid");
      }
      relativeAssets.add(validateRelativeAssetPath(value));
    }
  }
  for (const match of indexSource.matchAll(
    /(?:src|href)=["']([^"']+)["']/giu,
  )) {
    const value = match[1];
    if (/^(?:[a-z]+:|\/\/|#)/iu.test(value)) continue;
    relativeAssets.add(validateRelativeAssetPath(value));
  }
  if (relativeAssets.size === 0) {
    runtimeFail("DEV_BUILD_ASSETS_MISSING", "build references no assets");
  }

  const assetPaths = [];
  for (const relativeAsset of [...relativeAssets].sort()) {
    const assetPath = resolve(resolvedRoot, relativeAsset);
    await safeRegularFile(assetPath, resolvedRoot);
    assetPaths.push(assetPath);
  }
  const manifestDigest = createHash("sha256")
    .update(manifestSource)
    .digest("hex");
  return Object.freeze({
    algorithm: "sha256",
    digest: await hashFiles(
      [indexPath, manifestPath, ...assetPaths],
      resolvedRoot,
    ),
    manifestDigest,
    assetCount: assetPaths.length,
    assets: Object.freeze(
      assetPaths.map((path) => relative(resolvedRoot, path)).sort(),
    ),
  });
}

export async function computeIntegrity() {
  const [source, build] = await Promise.all([
    computeSourceDigest(),
    inspectBuildIntegrity(),
  ]);
  return Object.freeze({ source, build });
}

export function integrityEqual(expected, actual) {
  return Boolean(
    expected &&
    actual &&
    expected.source?.digest === actual.source?.digest &&
    expected.source?.fileCount === actual.source?.fileCount &&
    expected.build?.digest === actual.build?.digest &&
    expected.build?.manifestDigest === actual.build?.manifestDigest &&
    expected.build?.assetCount === actual.build?.assetCount &&
    JSON.stringify(expected.build?.assets) ===
      JSON.stringify(actual.build?.assets),
  );
}

export function validateIntegrityShape(integrity) {
  const digestPattern = /^[0-9a-f]{64}$/u;
  const assets = integrity?.build?.assets;
  return Boolean(
    integrity &&
    integrity.source?.algorithm === "sha256" &&
    digestPattern.test(integrity.source.digest) &&
    Number.isSafeInteger(integrity.source.fileCount) &&
    integrity.source.fileCount > 0 &&
    integrity.build?.algorithm === "sha256" &&
    digestPattern.test(integrity.build.digest) &&
    digestPattern.test(integrity.build.manifestDigest) &&
    Number.isSafeInteger(integrity.build.assetCount) &&
    integrity.build.assetCount > 0 &&
    Array.isArray(assets) &&
    assets.length === integrity.build.assetCount &&
    new Set(assets).size === assets.length &&
    assets.every(
      (asset) =>
        typeof asset === "string" &&
        asset.length > 0 &&
        !isAbsolute(asset) &&
        !asset.startsWith("/") &&
        !asset.includes("?") &&
        !asset.includes("#") &&
        asset
          .split("/")
          .every((part) => part !== "" && part !== "." && part !== ".."),
    ) &&
    JSON.stringify(assets) === JSON.stringify([...assets].sort()),
  );
}

export function recordPath(service) {
  return resolve(PID_ROOT, `${service.name}.json`);
}

export function validateIdentityShape(identity) {
  return Boolean(
    identity &&
    Number.isSafeInteger(identity.pid) &&
    identity.pid > 1 &&
    Number.isSafeInteger(identity.parentPid) &&
    identity.parentPid >= 0 &&
    Number.isSafeInteger(identity.processGroupId) &&
    identity.processGroupId > 1 &&
    typeof identity.sessionId === "string" &&
    identity.sessionId.length > 0 &&
    typeof identity.startToken === "string" &&
    identity.startToken.length > 0 &&
    typeof identity.command === "string" &&
    identity.command.length > 0 &&
    identity.cwd === REPOSITORY_ROOT,
  );
}

export function validateRecord(record, service) {
  if (
    !record ||
    record.version !== RECORD_VERSION ||
    record.repositoryName !== REPOSITORY_NAME ||
    record.repositoryRoot !== REPOSITORY_ROOT ||
    record.service !== service.name ||
    record.serviceId !== service.serviceId ||
    record.host !== DEV_HOST ||
    record.port !== service.port ||
    !RECORD_STATES.includes(record.state) ||
    typeof record.runId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      record.runId,
    ) ||
    typeof record.startInvocationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      record.startInvocationId,
    ) ||
    typeof record.createdAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(record.createdAt) ||
    record.logPath !== resolve(LOG_ROOT, `${service.name}.log`) ||
    !validateIntegrityShape(record.integrity) ||
    !Array.isArray(record.socketHolderPids) ||
    record.socketHolderPids.some(
      (pid) => !Number.isSafeInteger(pid) || pid <= 1,
    ) ||
    new Set(record.socketHolderPids).size !== record.socketHolderPids.length
  ) {
    return false;
  }
  if (record.state === "claiming") {
    return (
      validateIdentityShape(record.claimOwner) &&
      !record.process &&
      record.socketHolderPids.length === 0
    );
  }
  const processIsValid =
    validateIdentityShape(record.process) &&
    validateSupervisorIdentity(service, record.runId, record.process) &&
    !record.claimOwner;
  if (!processIsValid) return false;
  if (record.state === "ready") {
    return (
      record.socketHolderPids.length === 1 &&
      record.socketHolderPids[0] === record.process.pid
    );
  }
  return record.socketHolderPids.every((pid) => pid === record.process.pid);
}

async function readRecordFile(path) {
  assertSafeDevPath(path, { leafKind: "file", allowMissingLeaf: true });
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    runtimeFail(
      "DEV_RECORD_PATH_INVALID",
      `${path} is not a safe regular file`,
    );
  }
  if (
    (currentUid() !== undefined && metadata.uid !== currentUid()) ||
    (metadata.mode & 0o077) !== 0 ||
    metadata.nlink !== 1
  ) {
    runtimeFail(
      "DEV_RECORD_PERMISSIONS_INVALID",
      `${path} has unsafe ownership or mode`,
    );
  }
  if (metadata.size > MAX_RECORD_BYTES) {
    runtimeFail("DEV_RECORD_TOO_LARGE", `${path} exceeds the record limit`);
  }
  const source = await readFile(path, "utf8");
  try {
    return JSON.parse(source);
  } catch {
    runtimeFail("DEV_RECORD_JSON_INVALID", `${path} is invalid JSON`);
  }
}

export async function readRecord(service, { allowLegacy = false } = {}) {
  const record = await readRecordFile(recordPath(service));
  if (!record) return undefined;
  if (record.version === 1 && allowLegacy) return record;
  if (!validateRecord(record, service)) {
    runtimeFail("DEV_RECORD_INVALID", `${service.name} record is invalid`);
  }
  return record;
}

async function writeAndSync(path, value) {
  assertSafeDevPath(path, { leafKind: "file", allowMissingLeaf: true });
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function createClaimRecord(service, record) {
  if (!validateRecord(record, service) || record.state !== "claiming") {
    runtimeFail("DEV_CLAIM_INVALID", `${service.name} claim is invalid`);
  }
  const temporary = resolve(TMP_ROOT, `${service.name}.${randomUUID()}.claim`);
  await writeAndSync(temporary, record);
  try {
    assertSafeDevPath(recordPath(service), {
      leafKind: "file",
      allowMissingLeaf: true,
    });
    await link(temporary, recordPath(service));
  } catch (error) {
    if (error?.code === "EEXIST") {
      runtimeFail(
        "DEV_RECORD_ALREADY_EXISTS",
        `${service.name} is already claimed`,
      );
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function replaceRecord(service, record, expectedRunId) {
  if (!validateRecord(record, service) || record.runId !== expectedRunId) {
    runtimeFail(
      "DEV_RECORD_REPLACEMENT_INVALID",
      `${service.name} update is invalid`,
    );
  }
  const existing = await readRecord(service);
  if (!existing || existing.runId !== expectedRunId) {
    runtimeFail("DEV_RECORD_OWNERSHIP_LOST", `${service.name} claim changed`);
  }
  const temporary = resolve(TMP_ROOT, `${service.name}.${randomUUID()}.json`);
  await writeAndSync(temporary, record);
  assertSafeDevPath(recordPath(service), { leafKind: "file" });
  await rename(temporary, recordPath(service));
}

export async function removeRecord(service, expectedRunId) {
  const existing = await readRecord(service, { allowLegacy: true });
  if (!existing) return;
  if (existing.runId !== expectedRunId) {
    runtimeFail("DEV_RECORD_OWNERSHIP_LOST", `${service.name} run changed`);
  }
  assertSafeDevPath(recordPath(service), { leafKind: "file" });
  await unlink(recordPath(service));
}

export function gitIgnoreCoversDev() {
  const result = spawnSync(
    GIT_PATH,
    ["check-ignore", "--quiet", ".dev/preflight-probe"],
    {
      cwd: REPOSITORY_ROOT,
      env: sanitizedEnvironment(),
      timeout: 5_000,
      stdio: "ignore",
    },
  );
  return !result.error && result.status === 0;
}
