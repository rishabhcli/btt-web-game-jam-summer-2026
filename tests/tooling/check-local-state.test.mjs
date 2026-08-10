import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  checkLocalState,
  LocalStateError,
  REPOSITORY_ROOT,
  validateContainedTree,
  validateLocalDirectory,
} from "../../scripts/check-local-state.mjs";

test("local state accepts contained private and generated directories", () => {
  const result = checkLocalState();
  assert.ok(result.privateChecked >= 9);
  assert.ok(result.privateFilesChecked >= 5);
  assert.ok(result.generatedChecked >= 6);
});

test("local state safely restricts package-manager-created cache directories", () => {
  const directoryPath = resolve(
    REPOSITORY_ROOT,
    ".dev/tmp/local-state-public-cache",
  );
  rmSync(directoryPath, { force: true, recursive: true });
  mkdirSync(directoryPath, { mode: 0o755 });
  chmodSync(directoryPath, 0o755);
  try {
    validateLocalDirectory(".dev/tmp/local-state-public-cache", {
      create: false,
      privateMode: true,
    });
    assert.equal(statSync(directoryPath).mode & 0o777, 0o700);
  } finally {
    rmSync(directoryPath, { force: true, recursive: true });
  }
});

test("local state rejects a symlink before a tool can write through it", () => {
  const linkPath = resolve(REPOSITORY_ROOT, ".dev/tmp/local-state-link");
  const targetPath = resolve(REPOSITORY_ROOT, ".dev/tmp/local-state-target");
  rmSync(linkPath, { force: true });
  rmSync(targetPath, { force: true, recursive: true });
  mkdirSync(targetPath, { mode: 0o700, recursive: true });
  symlinkSync(targetPath, linkPath, "dir");
  try {
    assert.throws(
      () =>
        validateLocalDirectory(".dev/tmp/local-state-link", {
          create: false,
          privateMode: true,
        }),
      (error) =>
        error instanceof LocalStateError &&
        error.code === "LOCAL_STATE_PATH_INVALID",
    );
  } finally {
    rmSync(linkPath, { force: true });
    rmSync(targetPath, { force: true, recursive: true });
  }
});

test("cache tree validation allows contained links and rejects descendant escapes", () => {
  const treePath = resolve(REPOSITORY_ROOT, ".dev/cache/local-state-tree");
  const innerPath = resolve(treePath, "inner");
  const innerLinkPath = resolve(treePath, "inner-link");
  const outsidePath = resolve(REPOSITORY_ROOT, ".dev/tmp/local-state-outside");
  const escapePath = resolve(treePath, "escape");
  for (const path of [treePath, outsidePath]) {
    rmSync(path, { force: true, recursive: true });
  }
  mkdirSync(innerPath, { mode: 0o700, recursive: true });
  mkdirSync(outsidePath, { mode: 0o700 });
  symlinkSync("inner", innerLinkPath, "dir");
  try {
    assert.equal(
      validateContainedTree(".dev/cache/local-state-tree").observedEntries,
      2,
    );
    symlinkSync(outsidePath, escapePath, "dir");
    assert.throws(
      () => validateContainedTree(".dev/cache/local-state-tree"),
      (error) =>
        error instanceof LocalStateError &&
        error.code === "LOCAL_STATE_TREE_ESCAPE_REJECTED",
    );
  } finally {
    rmSync(treePath, { force: true, recursive: true });
    rmSync(outsidePath, { force: true, recursive: true });
  }
});

test("cache tree validation rejects hardlinks to external writable inodes", () => {
  const treePath = resolve(REPOSITORY_ROOT, ".dev/cache/local-state-hardlinks");
  const targetPath = resolve(REPOSITORY_ROOT, ".dev/tmp/hardlink-target");
  const linkedPath = resolve(treePath, "linked-payload");
  rmSync(treePath, { force: true, recursive: true });
  rmSync(targetPath, { force: true });
  mkdirSync(treePath, { mode: 0o700, recursive: true });
  writeFileSync(targetPath, "must not be cache-writable\n", { mode: 0o600 });
  linkSync(targetPath, linkedPath);
  try {
    assert.throws(
      () => validateContainedTree(".dev/cache/local-state-hardlinks"),
      (error) =>
        error instanceof LocalStateError &&
        error.code === "LOCAL_STATE_TREE_HARDLINK_REJECTED",
    );
  } finally {
    rmSync(treePath, { force: true, recursive: true });
    rmSync(targetPath, { force: true });
  }
});
