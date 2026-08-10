import { defineConfig, devices } from "@playwright/test";
import { delimiter, dirname } from "node:path";

export function createPlaywrightChildEnvironment(
  sourceEnvironment: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of [
    "BTT_E2E_TARGET",
    "BTT_PLAYWRIGHT_PROFILE_DIR",
    "BTT_REUSE_OWNED_E2E_SERVER",
    "CI",
    "FORCE_COLOR",
    "HOME",
    "LANG",
    "LC_ALL",
    "NO_COLOR",
    "PLAYWRIGHT_BROWSERS_PATH",
    "TEMP",
    "TMP",
    "TMPDIR",
    "TZ",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "npm_config_cache",
  ]) {
    const value = sourceEnvironment[key];
    if (value !== undefined) result[key] = value;
  }
  result["PATH"] = [
    dirname(process.execPath),
    ...(process.platform === "win32"
      ? []
      : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]),
  ].join(delimiter);
  for (const key of ["ComSpec", "PATHEXT", "SystemRoot"] as const) {
    const value = sourceEnvironment[key];
    if (process.platform === "win32" && value !== undefined) {
      result[key] = value;
    }
  }
  if (result["FORCE_COLOR"] !== undefined) delete result["NO_COLOR"];
  return result;
}

const targets = {
  e2e: {
    command: "npm run serve:e2e -- --host 127.0.0.1 --port 4142 --strictPort",
    port: 4142,
    serviceId: "browser-history-e2e",
  },
  preview: {
    command:
      "npm run serve:preview -- --host 127.0.0.1 --port 4141 --strictPort",
    port: 4141,
    serviceId: "production-preview",
  },
  static: {
    command:
      "npm run serve:static -- --host 127.0.0.1 --port 4143 --strictPort",
    port: 4143,
    serviceId: "static-bundle",
  },
} as const;

type TargetName = keyof typeof targets;

const targetName = process.env["BTT_E2E_TARGET"];
if (targetName === undefined) {
  throw new Error(
    "PLAYWRIGHT_TARGET_REQUIRED: use a repository test:* command with an explicit target",
  );
}
if (!Object.hasOwn(targets, targetName)) {
  throw new Error(
    `PLAYWRIGHT_TARGET_INVALID: ${JSON.stringify(targetName)} is not e2e, preview, or static`,
  );
}
const target = targets[targetName as TargetName];
const baseURL = `http://127.0.0.1:${String(target.port)}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  globalTimeout: 15 * 60_000,
  retries: 0,
  workers: 1,
  reporter: process.env["CI"]
    ? [["line"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  expect: {
    timeout: 5_000,
  },
  timeout: 120_000,
  webServer: {
    command: target.command,
    url: baseURL,
    reuseExistingServer: process.env["BTT_REUSE_OWNED_E2E_SERVER"] === "1",
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...createPlaywrightChildEnvironment(process.env),
      BTT_SERVICE_ID: target.serviceId,
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
