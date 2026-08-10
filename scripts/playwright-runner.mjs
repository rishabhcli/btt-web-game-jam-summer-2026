import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  checkLocalState,
  validateContainedTree,
} from "./check-local-state.mjs";
import { withDevServiceLease } from "./dev-services.mjs";
import { OwnedProcessError, runOwnedProcess } from "./owned-process-runner.mjs";
import { createSafeChildEnvironment } from "./safe-environment.mjs";

checkLocalState();
validateContainedTree(".dev/cache/playwright");
const cliPath = resolve("node_modules/@playwright/test/cli.js");
const sourceEnvironment = process.env;
const environment = createSafeChildEnvironment(sourceEnvironment, {
  additions: {
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    npm_config_cache: resolve(".dev/cache/npm"),
  },
});
const profileRoot = resolve(".dev/pw-profile");
mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
const profileDirectory = mkdtempSync(join(profileRoot, "run-"));

const forwardedArguments = process.argv.slice(2);
const isTestCommand = forwardedArguments[0] === "test";
const targetFlagIndexes = forwardedArguments.flatMap((argument, index) =>
  argument === "--btt-target" ? [index] : [],
);
let target;
if (isTestCommand) {
  const targetIndex = targetFlagIndexes[0];
  target =
    targetIndex === undefined ? undefined : forwardedArguments[targetIndex + 1];
  if (
    targetFlagIndexes.length !== 1 ||
    targetIndex === 0 ||
    targetIndex === forwardedArguments.length - 1 ||
    !new Set(["e2e", "preview", "static"]).has(target)
  ) {
    process.stderr.write(
      "PLAYWRIGHT_TARGET_INVALID: test requires exactly one --btt-target e2e|preview|static option\n",
    );
    rmSync(profileDirectory, { force: true, recursive: true });
    process.exit(1);
  }
  forwardedArguments.splice(targetIndex, 2);
} else if (targetFlagIndexes.length > 0) {
  process.stderr.write(
    "PLAYWRIGHT_TARGET_INVALID: --btt-target is valid only for test commands\n",
  );
  rmSync(profileDirectory, { force: true, recursive: true });
  process.exit(1);
}
delete environment["BTT_E2E_TARGET"];
if (target !== undefined) environment["BTT_E2E_TARGET"] = target;
const reuseOwnedServer = sourceEnvironment["BTT_REUSE_OWNED_E2E_SERVER"];
if (reuseOwnedServer === "1") {
  environment["BTT_REUSE_OWNED_E2E_SERVER"] = "1";
}
let prerequisiteFailed = false;
if (reuseOwnedServer !== undefined && reuseOwnedServer !== "1") {
  process.stderr.write(
    "PLAYWRIGHT_REUSE_POLICY_INVALID: BTT_REUSE_OWNED_E2E_SERVER may only be unset or exactly 1\n",
  );
  process.exitCode = 1;
  prerequisiteFailed = true;
}

function playwrightTimeoutMs(arguments_) {
  if (arguments_[0] === "test") return 10 * 60 * 1_000;
  if (arguments_[0] === "install") return 14 * 60 * 1_000;
  if (arguments_[0] === "install-deps") return 4 * 60 * 1_000;
  return 2 * 60 * 1_000;
}

async function runPlaywright() {
  return await runOwnedProcess({
    args: [cliPath, ...forwardedArguments],
    command: process.execPath,
    cwd: resolve("."),
    env: {
      ...environment,
      BTT_PLAYWRIGHT_PROFILE_DIR: profileDirectory,
      HOME: profileDirectory,
      PLAYWRIGHT_BROWSERS_PATH: resolve(".dev/cache/playwright"),
      TEMP: profileDirectory,
      TMP: profileDirectory,
      TMPDIR: profileDirectory,
      XDG_CACHE_HOME: join(profileDirectory, "cache"),
      XDG_CONFIG_HOME: join(profileDirectory, "config"),
      XDG_DATA_HOME: join(profileDirectory, "data"),
    },
    homeDirectory: profileDirectory,
    maxOutputBytes: 256 * 1024 * 1024,
    outputMode: "inherit",
    timeoutMs: playwrightTimeoutMs(forwardedArguments),
  });
}

let result;
try {
  if (!prerequisiteFailed && isTestCommand) {
    result = await withDevServiceLease(
      `playwright-${target}`,
      async ({ validateHealth, validatePreflight }) => {
        const ownedLifecycleStateExists = [
          "game",
          "preview",
          "e2e",
          "static",
        ].some((service) => existsSync(resolve(`.dev/pids/${service}.json`)));
        if (reuseOwnedServer === "1" || ownedLifecycleStateExists) {
          await validateHealth();
          environment["BTT_REUSE_OWNED_E2E_SERVER"] = "1";
        } else {
          await validatePreflight();
        }
        return await runPlaywright();
      },
    );
  } else if (!prerequisiteFailed) {
    result = await runPlaywright();
  }
} catch (error) {
  const code =
    error instanceof OwnedProcessError
      ? error.code
      : reuseOwnedServer === "1"
        ? "PLAYWRIGHT_OWNED_SERVER_INVALID"
        : "PLAYWRIGHT_LIFECYCLE_LEASE_FAILED";
  process.stderr.write(`${code}: ${error?.message ?? String(error)}\n`);
  process.exitCode = error?.suggestedExitCode ?? 1;
} finally {
  rmSync(profileDirectory, { force: true, recursive: true });
}

if (result) process.exitCode = result.exitCode ?? 1;
