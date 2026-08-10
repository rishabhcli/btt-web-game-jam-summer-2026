import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkLocalState } from "../../scripts/check-local-state.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
checkLocalState();

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, relativePath), "utf8"),
  );
}

test("TypeScript projects keep domain, app, and test ambient types separate", async () => {
  const [root, base, domain, app, unit, e2e, node] = await Promise.all([
    readJson("tsconfig.json"),
    readJson("tsconfig.base.json"),
    readJson("tsconfig.domain.json"),
    readJson("tsconfig.app.json"),
    readJson("tsconfig.test.json"),
    readJson("tsconfig.e2e.json"),
    readJson("tsconfig.node.json"),
  ]);

  assert.equal(base.compilerOptions.target, "ES2022");
  assert.equal(domain.compilerOptions.target, "ES2022");
  assert.deepEqual(domain.compilerOptions.lib, ["ES2022"]);
  assert.deepEqual(domain.compilerOptions.types, []);
  assert.equal(domain.compilerOptions.emitDeclarationOnly, true);
  assert.deepEqual(app.compilerOptions.types, ["vite/client"]);
  assert.equal(app.compilerOptions.target, "ES2022");
  assert.equal(app.compilerOptions.emitDeclarationOnly, true);
  assert.deepEqual(unit.compilerOptions.types, ["node", "vitest/globals"]);
  assert.deepEqual(e2e.compilerOptions.types, ["node"]);
  assert.deepEqual(node.compilerOptions.types, ["node"]);
  assert.ok(app.include.every((entry) => !entry.startsWith("tests/")));
  assert.ok(unit.include.every((entry) => !entry.startsWith("src/")));
  assert.ok(e2e.include.every((entry) => !entry.startsWith("src/")));

  const pureExclusions = [
    "src/build-status.ts",
    "src/domain/**",
    "src/engine/**",
    "src/ghosts/**",
    "src/levels/**",
    "src/history/domain/**",
  ];
  assert.deepEqual(app.exclude, pureExclusions);
  assert.deepEqual(app.references, [{ path: "./tsconfig.domain.json" }]);
  for (const testConfig of [unit, e2e]) {
    assert.deepEqual(testConfig.references, [
      { path: "./tsconfig.domain.json" },
      { path: "./tsconfig.app.json" },
    ]);
  }

  const references = new Set(root.references.map(({ path: value }) => value));
  for (const required of [
    "./tsconfig.domain.json",
    "./tsconfig.app.json",
    "./tsconfig.test.json",
    "./tsconfig.e2e.json",
    "./tsconfig.node.json",
  ]) {
    assert.ok(
      references.has(required),
      `${required} must be in the root build`,
    );
  }
});

test("the pure compiler rejects browser, Node, and Vitest globals", async (t) => {
  const probeRoot = await mkdtemp(
    path.join(repositoryRoot, ".dev/tmp/btt-domain-types-"),
  );
  t.after(async () => {
    await rm(probeRoot, { force: true, recursive: true });
  });

  const probePath = path.join(probeRoot, "ambient-probe.ts");
  const configPath = path.join(probeRoot, "tsconfig.json");
  await writeFile(
    probePath,
    "void document;\nvoid process;\nvoid describe;\n",
    "utf8",
  );
  await writeFile(
    configPath,
    JSON.stringify({
      extends: path.join(repositoryRoot, "tsconfig.base.json"),
      compilerOptions: { lib: ["ES2022"], types: [] },
      files: [probePath],
    }),
    "utf8",
  );

  const execution = spawnSync(
    process.execPath,
    [
      path.join(repositoryRoot, "node_modules/typescript/bin/tsc"),
      "-p",
      configPath,
      "--pretty",
      "false",
    ],
    {
      encoding: "utf8",
      killSignal: "SIGKILL",
      timeout: 60_000,
    },
  );
  const output = `${execution.stdout}${execution.stderr}`;

  assert.equal(execution.error, undefined, execution.error?.message);
  assert.equal(execution.status, 2);
  assert.match(output, /Cannot find name 'document'/u);
  assert.match(output, /Cannot find name 'process'/u);
  assert.match(output, /Cannot find name 'describe'/u);
});
