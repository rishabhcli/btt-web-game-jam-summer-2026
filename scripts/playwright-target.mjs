import { resolve } from "node:path";

import { checkLocalState } from "./check-local-state.mjs";
import { OwnedProcessError, runOwnedProcess } from "./owned-process-runner.mjs";
import { createSafeChildEnvironment } from "./safe-environment.mjs";
import { resolveTrustedNpmCli } from "./trusted-tooling.mjs";

checkLocalState();

const [target, ...extraArguments] = process.argv.slice(2);
if (!new Set(["preview", "static"]).has(target) || extraArguments.length > 0) {
  process.stderr.write(
    "PLAYWRIGHT_TARGET_INVALID: usage: node scripts/playwright-target.mjs preview|static\n",
  );
  process.exit(1);
}

const environment = createSafeChildEnvironment(process.env, {
  additions: { npm_config_cache: resolve(".dev/cache/npm") },
});

function trustedNpmCli(sourceEnvironment) {
  return resolveTrustedNpmCli(sourceEnvironment["npm_execpath"]);
}

let build;
let test;
try {
  const npmCli = trustedNpmCli(process.env);
  build = await runOwnedProcess({
    args: [npmCli, "run", "build"],
    command: process.execPath,
    cwd: resolve("."),
    env: environment,
    maxOutputBytes: 256 * 1024 * 1024,
    outputMode: "inherit",
    timeoutMs: 120_000,
  });
  if (build.exitCode === 0) {
    test = await runOwnedProcess({
      args: [
        resolve("scripts/playwright-runner.mjs"),
        "test",
        "--btt-target",
        target,
      ],
      command: process.execPath,
      cwd: resolve("."),
      env: environment,
      maxOutputBytes: 256 * 1024 * 1024,
      outputMode: "inherit",
      timeoutMs: 11 * 60 * 1_000,
    });
  }
} catch (error) {
  const code =
    error instanceof OwnedProcessError
      ? error.code
      : (error?.code ?? "PLAYWRIGHT_TARGET_SPAWN_FAILED");
  process.stderr.write(`${code}: ${error?.message ?? String(error)}\n`);
  process.exitCode = error?.suggestedExitCode ?? 1;
}

if (build && build.exitCode !== 0) {
  process.stderr.write(
    `PLAYWRIGHT_TARGET_BUILD_FAILED: exit ${String(build.exitCode)}\n`,
  );
  process.exitCode = build.exitCode ?? 1;
}
if (test) process.exitCode = test.exitCode ?? 1;
