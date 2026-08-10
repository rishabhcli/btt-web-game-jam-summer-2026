import assert from "node:assert/strict";
import test from "node:test";

import {
  createSafeChildEnvironment,
  SafeEnvironmentError,
} from "../../scripts/safe-environment.mjs";

const hostileEnvironment = Object.freeze({
  API_TOKEN: "credential-must-not-cross",
  AWS_SECRET_ACCESS_KEY: "credential-must-not-cross",
  CI: "true",
  HOME: "/safe/home",
  HTTP_PROXY: "http://attacker.invalid:8080",
  HTTPS_PROXY: "http://attacker.invalid:8443",
  NODE_OPTIONS: "--import=/tmp/attacker.mjs",
  PATH: "/tmp/attacker/bin",
  VITE_PRIVATE_CREDENTIAL: "browser-bundle-secret",
});

test("safe child environments filter credentials, Vite values, PATH, and proxies by default", () => {
  const environment = createSafeChildEnvironment(hostileEnvironment);

  assert.equal(environment.CI, "true");
  assert.equal(environment.HOME, "/safe/home");
  assert.notEqual(environment.PATH, hostileEnvironment.PATH);
  for (const key of [
    "API_TOKEN",
    "AWS_SECRET_ACCESS_KEY",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NODE_OPTIONS",
    "VITE_PRIVATE_CREDENTIAL",
  ]) {
    assert.equal(environment[key], undefined, `${key} crossed the boundary`);
  }
});

test("network forwarding is explicit and does not enable credential forwarding", () => {
  const environment = createSafeChildEnvironment(hostileEnvironment, {
    network: true,
  });

  assert.equal(environment.HTTP_PROXY, hostileEnvironment.HTTP_PROXY);
  assert.equal(environment.HTTPS_PROXY, hostileEnvironment.HTTPS_PROXY);
  assert.equal(environment.API_TOKEN, undefined);
  assert.equal(environment.VITE_PRIVATE_CREDENTIAL, undefined);
});

test("code-owned additions cannot override authority-bearing environment keys", () => {
  for (const key of [
    "API_TOKEN",
    "HTTP_PROXY",
    "PATH",
    "VITE_PRIVATE_CREDENTIAL",
  ]) {
    assert.throws(
      () =>
        createSafeChildEnvironment({}, { additions: { [key]: "injected" } }),
      (error) =>
        error instanceof SafeEnvironmentError &&
        error.code === "SAFE_ENV_ADDITION_REJECTED",
    );
  }

  assert.equal(
    createSafeChildEnvironment(
      {},
      {
        additions: { npm_config_cache: "/repo/.dev/cache/npm" },
      },
    ).npm_config_cache,
    "/repo/.dev/cache/npm",
  );
});
