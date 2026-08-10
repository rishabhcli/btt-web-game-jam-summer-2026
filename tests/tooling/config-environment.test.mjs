import assert from "node:assert/strict";
import test from "node:test";

const previousTarget = process.env.BTT_E2E_TARGET;
process.env.BTT_E2E_TARGET = "e2e";
const { createPlaywrightChildEnvironment } = await import(
  `../../playwright.config.ts?environment-policy=${String(Date.now())}`
);
if (previousTarget === undefined) {
  delete process.env.BTT_E2E_TARGET;
} else {
  process.env.BTT_E2E_TARGET = previousTarget;
}

const viteConfiguration = (
  await import(`../../vite.config.ts?environment-policy=${String(Date.now())}`)
).default;

test("Playwright web-server children reject credential, Vite, PATH, and proxy injection", () => {
  const environment = createPlaywrightChildEnvironment({
    API_TOKEN: "credential-must-not-cross",
    AWS_SECRET_ACCESS_KEY: "credential-must-not-cross",
    BTT_E2E_TARGET: "e2e",
    FORCE_COLOR: "1",
    HOME: "/safe/home",
    HTTP_PROXY: "http://attacker.invalid:8080",
    HTTPS_PROXY: "http://attacker.invalid:8443",
    NODE_OPTIONS: "--import=/tmp/attacker.mjs",
    NO_COLOR: "1",
    PATH: "/tmp/attacker/bin",
    VITE_PRIVATE_CREDENTIAL: "browser-bundle-secret",
  });

  assert.equal(environment.BTT_E2E_TARGET, "e2e");
  assert.equal(environment.HOME, "/safe/home");
  assert.equal(environment.FORCE_COLOR, "1");
  assert.notEqual(environment.PATH, "/tmp/attacker/bin");
  assert.equal(environment.NO_COLOR, undefined);
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

test("Vite disables implicit env files and the conventional VITE exposure channel", async () => {
  const configuration = await viteConfiguration({
    command: "build",
    isPreview: false,
    isSsrBuild: false,
    mode: "production",
  });

  assert.equal(configuration.envDir, false);
  assert.equal(configuration.envPrefix, "BTT_BROWSER_PUBLIC_");
  assert.notEqual(configuration.envPrefix, "VITE_");
  assert.deepEqual(configuration.server.fs.allow, [process.cwd()]);
  assert.equal(configuration.server.fs.strict, true);
  for (const pattern of ["**/.git/**", "**/.dev/**", "**/evidence/runs/**"]) {
    assert.ok(configuration.server.fs.deny.includes(pattern));
  }
  for (const pattern of ["**/.dev/**", "**/dist/**", "**/test-results/**"]) {
    assert.ok(configuration.server.watch.ignored.includes(pattern));
  }
});

test("Vite fails closed on unreviewed project-prefixed browser values", () => {
  const key = "BTT_BROWSER_PUBLIC_SECRET";
  const previousValue = process.env[key];
  process.env[key] = "credential-must-not-enter-bundle";
  try {
    assert.throws(
      () =>
        viteConfiguration({
          command: "build",
          isPreview: false,
          isSsrBuild: false,
          mode: "production",
        }),
      /VITE_BROWSER_ENV_UNAPPROVED.*BTT_BROWSER_PUBLIC_SECRET/u,
    );
  } finally {
    if (previousValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previousValue;
    }
  }
});
