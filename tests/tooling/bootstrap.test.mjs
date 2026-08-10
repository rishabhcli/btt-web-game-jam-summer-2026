import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  BootstrapError,
  EXPECTED_NODE_VERSION,
  EXPECTED_NPM_VERSION,
  LOCKED_NPM_CI_ARGUMENTS,
  LOCKED_NPM_SCRIPT_POLICY_ARGUMENTS,
  validateBootstrapEnvironment,
  validateBootstrapRuntime,
  validateLockedToolchainManifest,
  validateNpmInstallPolicyConfiguration,
} from "../../scripts/bootstrap.mjs";

const TEST_NODE_EXECUTABLE = realpathSync(process.execPath);
const TEST_NPM_EXECUTABLE = resolve(
  dirname(dirname(TEST_NODE_EXECUTABLE)),
  "lib/node_modules/npm/bin/npm-cli.js",
);

test("bootstrap release runtime is exact rather than a misleading major range", () => {
  assert.doesNotThrow(() =>
    validateBootstrapRuntime(
      EXPECTED_NODE_VERSION,
      EXPECTED_NPM_VERSION,
      TEST_NPM_EXECUTABLE,
      TEST_NODE_EXECUTABLE,
    ),
  );
  for (const nodeVersion of ["v24.18.0", "v25.8.1", "v26.5.1"]) {
    assert.throws(
      () =>
        validateBootstrapRuntime(
          nodeVersion,
          EXPECTED_NPM_VERSION,
          TEST_NPM_EXECUTABLE,
          TEST_NODE_EXECUTABLE,
        ),
      (error) =>
        error instanceof BootstrapError &&
        error.code === "BOOTSTRAP_NODE_UNSUPPORTED",
    );
  }
});

test("bootstrap rejects ambient npm graph and install-script policy overrides", () => {
  for (const key of [
    "npm_config_dangerously_allow_all_scripts",
    "NPM_CONFIG_IGNORE_SCRIPTS",
    "npm_config_omit",
    "npm_config_force",
    "npm_config_userconfig",
  ]) {
    assert.throws(() => validateBootstrapEnvironment({ [key]: "true" }), {
      code: "BOOTSTRAP_NPM_POLICY_OVERRIDE",
    });
  }
  assert.doesNotThrow(() =>
    validateBootstrapEnvironment({ npm_execpath: "/safe/npm-cli.js" }),
  );
});

test("bootstrap rejects a different npm version or unidentifiable executable", () => {
  assert.throws(
    () =>
      validateBootstrapRuntime(
        EXPECTED_NODE_VERSION,
        "11.18.0",
        TEST_NPM_EXECUTABLE,
        TEST_NODE_EXECUTABLE,
      ),
    { code: "BOOTSTRAP_NPM_UNSUPPORTED" },
  );
  assert.throws(
    () =>
      validateBootstrapRuntime(
        EXPECTED_NODE_VERSION,
        EXPECTED_NPM_VERSION,
        "/tmp/npm",
        TEST_NODE_EXECUTABLE,
      ),
    { code: "BOOTSTRAP_NPM_IDENTITY_INVALID" },
  );
  assert.throws(
    () =>
      validateBootstrapRuntime(
        EXPECTED_NODE_VERSION,
        EXPECTED_NPM_VERSION,
        "/tmp/npm-cli.js",
        TEST_NODE_EXECUTABLE,
      ),
    { code: "BOOTSTRAP_NPM_IDENTITY_INVALID" },
  );
});

test("bootstrap preserves and verifies npm 11 locked install-script arguments", () => {
  assert.deepEqual(LOCKED_NPM_SCRIPT_POLICY_ARGUMENTS, [
    "--no-dangerously-allow-all-scripts",
    "--no-ignore-scripts",
    "--strict-allow-scripts",
  ]);
  assert.deepEqual(LOCKED_NPM_CI_ARGUMENTS, [
    "ci",
    "--include=dev",
    "--include=optional",
    "--no-dangerously-allow-all-scripts",
    "--no-ignore-scripts",
    "--strict-allow-scripts",
    "--no-fund",
  ]);
  assert.doesNotThrow(() =>
    validateNpmInstallPolicyConfiguration(
      JSON.stringify({
        "dangerously-allow-all-scripts": false,
        "ignore-scripts": false,
        "strict-allow-scripts": true,
      }),
    ),
  );
  for (const invalid of [
    "not-json",
    JSON.stringify({
      "dangerously-allow-all-scripts": true,
      "ignore-scripts": false,
      "strict-allow-scripts": true,
    }),
    JSON.stringify({
      "dangerously-allow-all-scripts": false,
      "ignore-scripts": true,
      "strict-allow-scripts": true,
    }),
    JSON.stringify({
      "dangerously-allow-all-scripts": false,
      "ignore-scripts": false,
      "strict-allow-scripts": false,
    }),
  ]) {
    assert.throws(() => validateNpmInstallPolicyConfiguration(invalid), {
      code: "BOOTSTRAP_NPM_POLICY_UNSUPPORTED",
    });
  }
});

test("bootstrap requires every committed toolchain declaration to agree", () => {
  const valid = {
    lockManifest: {
      packages: { "": { engines: { node: "24.19.0", npm: "11.17.0" } } },
    },
    nvmrc: "24.19.0\n",
    packageManifest: {
      engines: { node: "24.19.0", npm: "11.17.0" },
      packageManager: "npm@11.17.0",
    },
  };
  assert.doesNotThrow(() => validateLockedToolchainManifest(valid));
  for (const invalid of [
    {
      ...valid,
      packageManifest: {
        ...valid.packageManifest,
        engines: { ...valid.packageManifest.engines, node: ">=24 <27" },
      },
    },
    {
      ...valid,
      lockManifest: {
        packages: { "": { engines: { node: "24.19.0", npm: ">=11" } } },
      },
    },
    {
      ...valid,
      packageManifest: {
        ...valid.packageManifest,
        packageManager: "npm@11.18.0",
      },
    },
    { ...valid, nvmrc: "26.5.1\n" },
  ]) {
    assert.throws(() => validateLockedToolchainManifest(invalid), {
      code: "BOOTSTRAP_TOOLCHAIN_MANIFEST_MISMATCH",
    });
  }
});
