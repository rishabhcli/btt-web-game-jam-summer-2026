import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPOSITORY_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PRIVATE_DIRECTORIES = Object.freeze([
  ".dev",
  ".dev/cache",
  ".dev/cache/npm",
  ".dev/cache/playwright",
  ".dev/cache/typescript",
  ".dev/cache/typescript/app-types",
  ".dev/cache/typescript/domain-types",
  ".dev/logs",
  ".dev/pids",
  ".dev/pw-profile",
  ".dev/tmp",
]);

const PRIVATE_FILES = Object.freeze([
  ".dev/cache/typescript/app.tsbuildinfo",
  ".dev/cache/typescript/domain.tsbuildinfo",
  ".dev/cache/typescript/e2e.tsbuildinfo",
  ".dev/cache/typescript/node.tsbuildinfo",
  ".dev/cache/typescript/test.tsbuildinfo",
]);

const GENERATED_DIRECTORIES = Object.freeze([
  "coverage",
  "dist",
  "evidence",
  "evidence/runs",
  "playwright-report",
  "test-results",
]);

export class LocalStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LocalStateError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new LocalStateError(code, message);
}

function isInsideRepository(absolutePath) {
  const pathFromRoot = relative(REPOSITORY_ROOT, absolutePath);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) &&
      pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(sep))
  );
}

function isInside(parentPath, candidatePath) {
  const pathFromParent = relative(parentPath, candidatePath);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !pathFromParent.startsWith(sep))
  );
}

export function validateLocalDirectory(relativePath, { create, privateMode }) {
  const absolutePath = resolve(REPOSITORY_ROOT, relativePath);
  let status;
  try {
    status = lstatSync(absolutePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      fail(
        "LOCAL_STATE_UNREADABLE",
        `${relativePath} could not be inspected: ${error?.message ?? String(error)}`,
      );
    }
    if (!create) return;
    mkdirSync(absolutePath, { mode: 0o700, recursive: false });
    status = lstatSync(absolutePath);
  }
  if (status.isSymbolicLink() || !status.isDirectory()) {
    fail(
      "LOCAL_STATE_PATH_INVALID",
      `${relativePath} must be a real repository-owned directory, never a symlink`,
    );
  }
  const realPath = realpathSync(absolutePath);
  if (!isInsideRepository(realPath)) {
    fail(
      "LOCAL_STATE_ESCAPE_REJECTED",
      `${relativePath} resolves outside the repository`,
    );
  }
  let actual = statSync(absolutePath);
  if (typeof process.getuid === "function" && actual.uid !== process.getuid()) {
    fail(
      "LOCAL_STATE_OWNER_INVALID",
      `${relativePath} is not owned by the current user`,
    );
  }
  if (privateMode && (actual.mode & 0o077) !== 0) {
    try {
      chmodSync(absolutePath, 0o700);
      actual = statSync(absolutePath);
    } catch (error) {
      fail(
        "LOCAL_STATE_MODE_REPAIR_FAILED",
        `${relativePath} could not be restricted to owner-only access: ${error?.message ?? String(error)}`,
      );
    }
    if ((actual.mode & 0o077) !== 0) {
      fail(
        "LOCAL_STATE_MODE_INVALID",
        `${relativePath} must not grant group or other permissions`,
      );
    }
  }
}

export function validateContainedTree(relativePath, maximumEntries = 250_000) {
  validateLocalDirectory(relativePath, { create: true, privateMode: true });
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
    fail("LOCAL_STATE_TREE_LIMIT_INVALID", "tree limit must be positive");
  }
  const absoluteRoot = resolve(REPOSITORY_ROOT, relativePath);
  const canonicalRoot = realpathSync(absoluteRoot);
  let observedEntries = 0;

  const walk = (directoryPath) => {
    for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
      observedEntries += 1;
      if (observedEntries > maximumEntries) {
        fail(
          "LOCAL_STATE_TREE_TOO_LARGE",
          `${relativePath} exceeds ${String(maximumEntries)} entries`,
        );
      }
      const entryPath = resolve(directoryPath, entry.name);
      const status = lstatSync(entryPath);
      if (status.isSymbolicLink()) {
        let target;
        try {
          target = realpathSync(entryPath);
        } catch (error) {
          fail(
            "LOCAL_STATE_TREE_LINK_INVALID",
            `${relative(REPOSITORY_ROOT, entryPath)} is a broken or unreadable symlink: ${error?.message ?? String(error)}`,
          );
        }
        if (!isInside(canonicalRoot, target)) {
          fail(
            "LOCAL_STATE_TREE_ESCAPE_REJECTED",
            `${relative(REPOSITORY_ROOT, entryPath)} resolves outside ${relativePath}`,
          );
        }
        continue;
      }
      if (status.isDirectory()) {
        walk(entryPath);
      } else if (status.isFile()) {
        if (status.nlink !== 1) {
          fail(
            "LOCAL_STATE_TREE_HARDLINK_REJECTED",
            `${relative(REPOSITORY_ROOT, entryPath)} has ${String(status.nlink)} hardlinks; writable cache files must have exactly one name`,
          );
        }
      } else {
        fail(
          "LOCAL_STATE_TREE_ENTRY_INVALID",
          `${relative(REPOSITORY_ROOT, entryPath)} is not a file, directory, or contained symlink`,
        );
      }
    }
  };

  walk(absoluteRoot);
  return Object.freeze({ observedEntries, relativePath });
}

function validatePrivateFile(relativePath) {
  const absolutePath = resolve(REPOSITORY_ROOT, relativePath);
  let status;
  try {
    status = lstatSync(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    fail(
      "LOCAL_STATE_UNREADABLE",
      `${relativePath} could not be inspected: ${error?.message ?? String(error)}`,
    );
  }
  if (status.isSymbolicLink() || !status.isFile()) {
    fail(
      "LOCAL_STATE_PATH_INVALID",
      `${relativePath} must be a regular repository-owned file, never a symlink`,
    );
  }
  const realPath = realpathSync(absolutePath);
  if (!isInsideRepository(realPath)) {
    fail(
      "LOCAL_STATE_ESCAPE_REJECTED",
      `${relativePath} resolves outside the repository`,
    );
  }
  const actual = statSync(absolutePath);
  if (typeof process.getuid === "function" && actual.uid !== process.getuid()) {
    fail(
      "LOCAL_STATE_OWNER_INVALID",
      `${relativePath} is not owned by the current user`,
    );
  }
}

export function checkLocalState() {
  for (const relativePath of PRIVATE_DIRECTORIES) {
    validateLocalDirectory(relativePath, { create: true, privateMode: true });
  }
  for (const relativePath of GENERATED_DIRECTORIES) {
    validateLocalDirectory(relativePath, {
      create: false,
      privateMode: false,
    });
  }
  for (const relativePath of PRIVATE_FILES) {
    validatePrivateFile(relativePath);
  }
  return Object.freeze({
    generatedChecked: GENERATED_DIRECTORIES.length,
    privateChecked: PRIVATE_DIRECTORIES.length,
    privateFilesChecked: PRIVATE_FILES.length,
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  try {
    const result = checkLocalState();
    process.stdout.write(
      `local state passed: ${String(result.privateChecked)} private directories, ${String(result.privateFilesChecked)} private files, and ${String(result.generatedChecked)} generated paths are contained\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error?.code ?? "LOCAL_STATE_FAILED"}: ${error?.message ?? String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
