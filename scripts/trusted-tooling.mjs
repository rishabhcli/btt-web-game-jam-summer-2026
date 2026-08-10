import { lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";

export class TrustedToolingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TrustedToolingError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new TrustedToolingError(code, message);
}

function validateImmutableExecutable(path, label) {
  let linkMetadata;
  let canonical;
  let metadata;
  try {
    linkMetadata = lstatSync(path);
    canonical = realpathSync(path);
    metadata = statSync(canonical);
  } catch (error) {
    fail(
      "TRUSTED_TOOL_UNREADABLE",
      `${label} is unreadable: ${error?.message ?? String(error)}`,
    );
  }
  if (
    linkMetadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !== 1
  ) {
    fail(
      "TRUSTED_TOOL_FILE_INVALID",
      `${label} must be a direct single-link regular file`,
    );
  }
  if ((metadata.mode & 0o022) !== 0) {
    fail(
      "TRUSTED_TOOL_MODE_INVALID",
      `${label} must not be writable by group or other users`,
    );
  }
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    currentUid !== undefined &&
    metadata.uid !== currentUid &&
    metadata.uid !== 0
  ) {
    fail(
      "TRUSTED_TOOL_OWNER_INVALID",
      `${label} must be owned by the current user or root`,
    );
  }
  return canonical;
}

export function resolveTrustedNpmCli(
  npmExecutablePath,
  nodeExecutablePath = process.execPath,
) {
  if (
    typeof npmExecutablePath !== "string" ||
    !isAbsolute(npmExecutablePath) ||
    typeof nodeExecutablePath !== "string" ||
    !isAbsolute(nodeExecutablePath)
  ) {
    fail(
      "TRUSTED_NPM_PATH_INVALID",
      "Node and npm executable paths must be absolute",
    );
  }
  if (!new Set(["node", "node.exe"]).has(basename(nodeExecutablePath))) {
    fail(
      "TRUSTED_NODE_PATH_INVALID",
      "Node executable must use the canonical node filename",
    );
  }
  const canonicalNode = validateImmutableExecutable(
    nodeExecutablePath,
    "Node executable",
  );
  const toolchainPrefix = dirname(dirname(canonicalNode));
  const expectedNpmPath = resolve(
    toolchainPrefix,
    "lib/node_modules/npm/bin/npm-cli.js",
  );
  if (resolve(npmExecutablePath) !== expectedNpmPath) {
    fail("TRUSTED_NPM_PREFIX_MISMATCH", `npm CLI must be ${expectedNpmPath}`);
  }
  const canonicalNpm = validateImmutableExecutable(
    npmExecutablePath,
    "npm CLI",
  );
  if (canonicalNpm !== expectedNpmPath) {
    fail(
      "TRUSTED_NPM_CANONICAL_PATH_MISMATCH",
      "npm CLI must not traverse a symlinked or substituted path",
    );
  }
  return canonicalNpm;
}
