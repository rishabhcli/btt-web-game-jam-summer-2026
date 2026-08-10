import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  checkLocalState,
  validateContainedTree,
} from "./check-local-state.mjs";
import { withDevServiceLease } from "./dev-services.mjs";
import { OwnedProcessError, runOwnedProcess } from "./owned-process-runner.mjs";
import { createSafeChildEnvironment } from "./safe-environment.mjs";
import { resolveTrustedNpmCli } from "./trusted-tooling.mjs";

export const EXPECTED_NODE_VERSION = "v24.19.0";
export const EXPECTED_NPM_VERSION = "11.17.0";
const INSTALL_TIMEOUT_MS = 300_000;
const OS_DEPENDENCY_PROBE_TIMEOUT_MS = 300_000;
const BROWSER_INSTALL_TIMEOUT_MS = 900_000;
export const LOCKED_NPM_SCRIPT_POLICY_ARGUMENTS = Object.freeze([
  "--no-dangerously-allow-all-scripts",
  "--no-ignore-scripts",
  "--strict-allow-scripts",
]);
export const LOCKED_NPM_CI_ARGUMENTS = Object.freeze([
  "ci",
  "--include=dev",
  "--include=optional",
  ...LOCKED_NPM_SCRIPT_POLICY_ARGUMENTS,
  "--no-fund",
]);

export class BootstrapError extends Error {
  constructor(code, message, exitCode) {
    super(message);
    this.name = "BootstrapError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function fail(code, message, exitCode) {
  throw new BootstrapError(code, message, exitCode);
}

function sanitizedEnvironment(environment) {
  return createSafeChildEnvironment(environment, {
    additions: {
      npm_config_cache: resolve(".dev/cache/npm"),
      npm_config_dangerously_allow_all_scripts: "false",
      npm_config_ignore_scripts: "false",
      npm_config_strict_allow_scripts: "true",
      npm_config_userconfig: resolve(".npmrc"),
    },
    network: true,
  });
}

export function validateBootstrapEnvironment(environment) {
  const unsafe = [
    "dangerously_allow_all_scripts",
    "force",
    "ignore_scripts",
    "include",
    "legacy_peer_deps",
    "omit",
    "only",
    "package_lock",
    "production",
    "script_shell",
    "userconfig",
  ];
  for (const [rawKey, rawValue] of Object.entries(environment)) {
    const key = rawKey.toLowerCase();
    const option = unsafe.find(
      (name) =>
        key === `npm_config_${name}` ||
        key === `npm_config_${name.replaceAll("_", "-")}`,
    );
    if (option && String(rawValue).length > 0) {
      fail(
        "BOOTSTRAP_NPM_POLICY_OVERRIDE",
        `${rawKey} may not alter the locked install policy`,
        2,
      );
    }
  }
}

export function validateNpmInstallPolicyConfiguration(output) {
  let configuration;
  try {
    configuration = JSON.parse(output);
  } catch (error) {
    fail(
      "BOOTSTRAP_NPM_POLICY_UNSUPPORTED",
      `npm did not return auditable policy JSON: ${error?.message ?? String(error)}`,
      3,
    );
  }
  if (
    configuration?.["dangerously-allow-all-scripts"] !== false ||
    configuration?.["ignore-scripts"] !== false ||
    configuration?.["strict-allow-scripts"] !== true
  ) {
    fail(
      "BOOTSTRAP_NPM_POLICY_UNSUPPORTED",
      "npm did not honor the locked install-script policy flags",
      3,
    );
  }
}

export function validateLockedToolchainManifest({
  lockManifest,
  nvmrc,
  packageManifest,
}) {
  const expectedNode = EXPECTED_NODE_VERSION.replace(/^v/u, "");
  const expectedNpm = EXPECTED_NPM_VERSION;
  const packageEngines = packageManifest?.engines;
  const lockEngines = lockManifest?.packages?.[""]?.engines;
  if (
    packageEngines?.node !== expectedNode ||
    packageEngines?.npm !== expectedNpm ||
    lockEngines?.node !== expectedNode ||
    lockEngines?.npm !== expectedNpm ||
    packageManifest?.packageManager !== `npm@${expectedNpm}` ||
    nvmrc.trim() !== expectedNode
  ) {
    fail(
      "BOOTSTRAP_TOOLCHAIN_MANIFEST_MISMATCH",
      "package.json, package-lock.json root engines, packageManager, and .nvmrc must all pin the exact release toolchain",
      2,
    );
  }
}

function readAndValidateLockedToolchainManifest() {
  let packageManifest;
  let lockManifest;
  let nvmrc;
  try {
    packageManifest = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
    lockManifest = JSON.parse(
      readFileSync(resolve("package-lock.json"), "utf8"),
    );
    nvmrc = readFileSync(resolve(".nvmrc"), "utf8");
  } catch (error) {
    fail(
      "BOOTSTRAP_TOOLCHAIN_MANIFEST_UNREADABLE",
      `locked toolchain manifests are unreadable: ${error?.message ?? String(error)}`,
      2,
    );
  }
  validateLockedToolchainManifest({ lockManifest, nvmrc, packageManifest });
}

async function runBounded(command, arguments_, options) {
  let result;
  try {
    result = await runOwnedProcess({
      args: arguments_,
      command,
      cwd: resolve("."),
      env: options.environment,
      maxOutputBytes: options.capture ? 4 * 1024 * 1024 : 256 * 1024 * 1024,
      outputMode: options.capture ? "capture" : "inherit",
      timeoutMs: options.timeoutMs,
    });
  } catch (error) {
    if (
      error instanceof OwnedProcessError &&
      error.code === "OWNED_PROCESS_CANCELLED"
    ) {
      throw error;
    }
    const suffix =
      error?.code === "OWNED_PROCESS_TIMEOUT" ? " timed out" : " failed";
    fail(
      `${options.code}_SPAWN_FAILED`,
      `${options.label}${suffix}: ${error?.message ?? String(error)}`,
      options.exitCode,
    );
  }
  if (result.exitCode !== 0) {
    const diagnostic = options.capture
      ? `: ${result.orderedOutput
          .map((event) => event.text)
          .join("")
          .trim()}`
      : "";
    fail(
      options.code,
      `${options.label} exited ${String(result.exitCode)}${diagnostic}`,
      result.exitCode ?? options.exitCode,
    );
  }
  return result;
}

function assertNoStandingServices() {
  let entries = [];
  try {
    entries = readdirSync(resolve(".dev/pids"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      fail(
        "BOOTSTRAP_PID_STATE_UNREADABLE",
        `cannot inspect .dev/pids: ${error?.message ?? String(error)}`,
        2,
      );
    }
  }
  if (entries.some((entry) => entry.endsWith(".json"))) {
    fail(
      "BOOTSTRAP_SERVICES_ACTIVE",
      "run npm run dev:down before bootstrap; replacing node_modules while recorded services exist is unsafe",
      2,
    );
  }
}

export function validateBootstrapRuntime(
  nodeVersion,
  npmVersion,
  npmExecutablePath,
  nodeExecutablePath = process.execPath,
) {
  if (nodeVersion !== EXPECTED_NODE_VERSION) {
    fail(
      "BOOTSTRAP_NODE_UNSUPPORTED",
      `expected exact release runtime ${EXPECTED_NODE_VERSION}, received ${nodeVersion}`,
      2,
    );
  }
  let trustedNpmPath;
  try {
    trustedNpmPath = resolveTrustedNpmCli(
      npmExecutablePath,
      nodeExecutablePath,
    );
  } catch (error) {
    fail(
      "BOOTSTRAP_NPM_IDENTITY_INVALID",
      `invoke through the npm CLI shipped beside the exact Node runtime: ${error?.message ?? String(error)}`,
      3,
    );
  }
  if (npmVersion !== EXPECTED_NPM_VERSION) {
    fail(
      "BOOTSTRAP_NPM_UNSUPPORTED",
      `expected exact release package manager ${EXPECTED_NPM_VERSION}, received ${npmVersion}`,
      4,
    );
  }
  return trustedNpmPath;
}

export async function runBootstrap({
  environment = process.env,
  nodeVersion = process.version,
  platform = process.platform,
} = {}) {
  checkLocalState();
  validateContainedTree(".dev/cache/npm");
  validateContainedTree(".dev/cache/playwright");
  validateBootstrapEnvironment(environment);
  readAndValidateLockedToolchainManifest();
  assertNoStandingServices();
  const npmExecutablePath = environment["npm_execpath"];
  const trustedNpmExecutablePath = validateBootstrapRuntime(
    nodeVersion,
    EXPECTED_NPM_VERSION,
    npmExecutablePath,
  );
  const cleanEnvironment = sanitizedEnvironment(environment);
  const npmVersionResult = await runBounded(
    process.execPath,
    [trustedNpmExecutablePath, "--version"],
    {
      capture: true,
      code: "BOOTSTRAP_NPM_UNAVAILABLE",
      environment: cleanEnvironment,
      exitCode: 3,
      label: "npm version probe",
      timeoutMs: 10_000,
    },
  );
  const npmVersion = npmVersionResult.stdout.trim();
  validateBootstrapRuntime(nodeVersion, npmVersion, trustedNpmExecutablePath);
  const policyProbe = await runBounded(
    process.execPath,
    [
      trustedNpmExecutablePath,
      "config",
      "list",
      "--json",
      ...LOCKED_NPM_SCRIPT_POLICY_ARGUMENTS,
    ],
    {
      capture: true,
      code: "BOOTSTRAP_NPM_POLICY_UNSUPPORTED",
      environment: cleanEnvironment,
      exitCode: 3,
      label: "npm install-script policy probe",
      timeoutMs: 10_000,
    },
  );
  validateNpmInstallPolicyConfiguration(policyProbe.stdout);

  return await withDevServiceLease(
    "bootstrap",
    async ({ validatePreflight }) => {
      await validatePreflight();
      process.stdout.write(
        `bootstrap environment ok: node=${nodeVersion} npm=${npmVersion}\n`,
      );
      process.stdout.write(
        "installing the exact dependency graph from package-lock.json\n",
      );
      await runBounded(
        process.execPath,
        [trustedNpmExecutablePath, ...LOCKED_NPM_CI_ARGUMENTS],
        {
          capture: false,
          code: "BOOTSTRAP_INSTALL_FAILED",
          environment: cleanEnvironment,
          exitCode: 5,
          label: "npm ci",
          timeoutMs: INSTALL_TIMEOUT_MS,
        },
      );

      const playwrightRunner = resolve("scripts/playwright-runner.mjs");
      if (platform === "linux") {
        process.stdout.write(
          "installing the required Linux browser libraries\n",
        );
        await runBounded(
          process.execPath,
          [playwrightRunner, "install-deps", "chromium", "firefox", "webkit"],
          {
            capture: false,
            code: "BOOTSTRAP_BROWSER_OS_DEPS_MISSING",
            environment: cleanEnvironment,
            exitCode: 6,
            label: "Playwright OS dependency installation",
            timeoutMs: OS_DEPENDENCY_PROBE_TIMEOUT_MS,
          },
        );
      }

      process.stdout.write(
        "installing supported browsers into .dev/cache/playwright\n",
      );
      await runBounded(
        process.execPath,
        [playwrightRunner, "install", "chromium", "firefox", "webkit"],
        {
          capture: false,
          code: "BOOTSTRAP_BROWSER_INSTALL_FAILED",
          environment: cleanEnvironment,
          exitCode: 7,
          label: "Playwright browser installation",
          timeoutMs: BROWSER_INSTALL_TIMEOUT_MS,
        },
      );
    },
  );
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  try {
    await runBootstrap();
  } catch (error) {
    process.stderr.write(
      `${error?.code ?? "BOOTSTRAP_FAILED"}: ${error?.message ?? String(error)}\n`,
    );
    process.exitCode = error?.suggestedExitCode ?? error?.exitCode ?? 1;
  }
}
