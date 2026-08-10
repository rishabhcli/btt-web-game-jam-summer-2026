import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");

test("npm policy blocks an unreviewed dependency install script", () => {
  const npmrc = readFileSync(resolve(repositoryRoot, ".npmrc"), "utf8");
  assert.match(npmrc, /^strict-allow-scripts=true$/mu);

  const temporaryRoot = resolve(repositoryRoot, ".dev/tmp");
  mkdirSync(temporaryRoot, { mode: 0o700, recursive: true });
  const testRoot = mkdtempSync(join(temporaryRoot, "npm-policy-"));
  const fixtureRoot = join(testRoot, "fixture");
  const consumerRoot = join(testRoot, "consumer");
  const markerPath = join(testRoot, "install-script-ran");
  mkdirSync(fixtureRoot, { mode: 0o700 });
  mkdirSync(consumerRoot, { mode: 0o700 });
  writeFileSync(
    join(fixtureRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "unreviewed-install-script-fixture",
        version: "1.0.0",
        scripts: {
          install: `node -e "require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, 'unsafe')"`,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "install-policy-consumer",
        private: true,
        dependencies: {
          "unreviewed-install-script-fixture": `file:${fixtureRoot}`,
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(join(consumerRoot, ".npmrc"), "strict-allow-scripts=true\n");

  try {
    const result = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: consumerRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: resolve(repositoryRoot, ".dev/cache/npm"),
      },
      timeout: 30_000,
    });
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(`${result.stdout}\n${result.stderr}`, /allow.?scripts/iu);
    assert.throws(() => readFileSync(markerPath), { code: "ENOENT" });
  } finally {
    rmSync(testRoot, { force: true, recursive: true });
  }
});
