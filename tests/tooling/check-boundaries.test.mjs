import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkBoundaries } from "../../scripts/check-boundaries.mjs";
import {
  checkLocalState,
  REPOSITORY_ROOT,
} from "../../scripts/check-local-state.mjs";

const thisDirectory = path.dirname(fileURLToPath(import.meta.url));
const checkerPath = path.resolve(
  thisDirectory,
  "../../scripts/check-boundaries.mjs",
);
checkLocalState();
const fixtureRoot = path.resolve(REPOSITORY_ROOT, ".dev/tmp");

async function fixtureRepository(t, files) {
  const repositoryRoot = await mkdtemp(
    path.join(fixtureRoot, "btt-boundaries-test-"),
  );
  t.after(async () => {
    await rm(repositoryRoot, { force: true, recursive: true });
  });

  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const filePath = path.join(repositoryRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, contents, "utf8");
    }),
  );
  return repositoryRoot;
}

test("accepts every allowed pure import edge and ignores import-like text", async (t) => {
  const repositoryRoot = await fixtureRepository(t, {
    "src/domain/result.ts": "export type Result = { readonly ok: true };\n",
    "src/domain/shadowed-require.ts": `
      const require = (value: string) => value;
      export const ordinaryCall = require("../render/not-a-module-load");
    `,
    "src/engine/state.ts": `
      import type { Result } from "../domain/result";
      import { z } from "zod";
      export type State = Result & { readonly schema: typeof z };
    `,
    "src/ghosts/replay.ts": `
      import type { State } from "../engine/state";
      export type Replay = { readonly state: State };
    `,
    "src/history/domain/graph.ts": `
      import type { State } from "../../engine/state";
      export type Graph = { readonly state: State };
    `,
    "src/levels/room.ts": `
      import type { State } from "../engine/state";
      // import "../render/not-an-import";
      const example = 'require("../history/not-a-require")';
      export type Room = { readonly initial: State; readonly example: typeof example };
    `,
  });

  const result = await checkBoundaries(repositoryRoot);

  assert.deepEqual(result.violations, []);
  assert.equal(result.domainFileCount, 6);
  assert.equal(result.importEdgeCount, 5);
});

test("enforces the explicit acyclic import matrix for every pure area", async (t) => {
  const repositoryRoot = await fixtureRepository(t, {
    "src/domain/api.ts": "export type DomainApi = true;\n",
    "src/domain/bad.ts":
      'import type { EngineApi } from "../engine/api";\nvoid (0 as unknown as EngineApi);\n',
    "src/engine/api.ts": "export type EngineApi = true;\n",
    "src/engine/bad.ts":
      'import type { GhostApi } from "../ghosts/api";\nvoid (0 as unknown as GhostApi);\n',
    "src/ghosts/api.ts": "export type GhostApi = true;\n",
    "src/ghosts/bad.ts":
      'import type { LevelApi } from "../levels/api";\nvoid (0 as unknown as LevelApi);\n',
    "src/history/domain/api.ts": "export type HistoryApi = true;\n",
    "src/history/domain/bad.ts":
      'import type { GhostApi } from "../../ghosts/api";\nvoid (0 as unknown as GhostApi);\n',
    "src/levels/api.ts": "export type LevelApi = true;\n",
    "src/levels/bad.ts":
      'import type { HistoryApi } from "../history/domain/api";\nvoid (0 as unknown as HistoryApi);\n',
  });

  const result = await checkBoundaries(repositoryRoot);

  assert.equal(result.violations.length, 5);
  assert.ok(
    result.violations.every(
      ({ code }) => code === "BOUNDARY_PURE_IMPORT_MATRIX",
    ),
  );
  assert.deepEqual(
    result.violations.map(({ file }) => file),
    [
      "src/domain/bad.ts",
      "src/engine/bad.ts",
      "src/ghosts/bad.ts",
      "src/history/domain/bad.ts",
      "src/levels/bad.ts",
    ],
  );
});

test("rejects every import syntax that reaches an adapter while ignoring comments", async (t) => {
  const repositoryRoot = await fixtureRepository(t, {
    "src/engine/bad.ts": `
      import { draw } from "../render/view";
      export { draw as drawAgain } from "../render/view";
      import renderer = require("../render/view");
      const loaded = require("../render/view");
      export const lazy = () => import("../render/view");
      // require("../render/comment-only");
      void draw;
      void renderer;
      void loaded;
    `,
    "src/render/view.ts": "export const draw = () => undefined;\n",
  });

  const result = await checkBoundaries(repositoryRoot);

  assert.equal(result.violations.length, 5);
  assert.ok(
    result.violations.every(
      ({ code }) => code === "BOUNDARY_PURE_UNREVIEWED_LOCAL_AREA",
    ),
  );
  assert.equal(result.importEdgeCount, 5);
});

test("fails closed on unreviewed local areas and unresolved configured aliases", async (t) => {
  const repositoryRoot = await fixtureRepository(t, {
    "src/engine/bad.ts": `
      import "../mystery/tool";
      export { panel } from "#adapter/panel";
      export { absent } from "#missing/absent";
    `,
    "src/mystery/tool.ts": "export const tool = true;\n",
    "src/ui/panel.ts": "export const panel = true;\n",
    "tsconfig.app.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        composite: true,
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: {
          "#adapter/*": ["src/ui/*"],
          "#missing/*": ["src/missing/*"],
        },
      },
      include: ["src/**/*.ts"],
    }),
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    }),
  });

  const result = await checkBoundaries(repositoryRoot);

  assert.deepEqual(
    result.violations.map(({ code }) => code),
    [
      "BOUNDARY_PURE_UNREVIEWED_LOCAL_AREA",
      "BOUNDARY_PURE_UNREVIEWED_LOCAL_AREA",
      "BOUNDARY_UNRESOLVED_LOCAL_ALIAS",
    ],
  );
});

test("rejects browser SDKs, framework state, host modules, and unreviewed packages", async (t) => {
  const repositoryRoot = await fixtureRepository(t, {
    "src/domain/bad.ts": `
      import { Application } from "pixi.js";
      import state = require("zustand");
      const openStore = require("idb");
      export * from "node:crypto";
      export * from "new-browser-cloud-sdk";
      void Application;
      void state;
      void openStore;
    `,
  });

  const result = await checkBoundaries(repositoryRoot);

  assert.deepEqual(
    result.violations.map(({ code }) => code),
    [
      "BOUNDARY_PURE_EXTERNAL_SDK",
      "BOUNDARY_PURE_EXTERNAL_SDK",
      "BOUNDARY_PURE_EXTERNAL_SDK",
      "BOUNDARY_PURE_PLATFORM_IMPORT",
      "BOUNDARY_PURE_UNAPPROVED_EXTERNAL",
    ],
  );
});

test("rejects runtime nondeterminism in every pure area", async (t) => {
  const repositoryRoot = await fixtureRepository(t, {
    "src/domain/random.ts":
      "export const id = globalThis.crypto.randomUUID();\n",
    "src/domain/parsed-date.ts":
      'export const parsed = Date.parse("2026-08-09");\n',
    "src/engine/computed.ts":
      'const capability = "fetch";\nexport const value = globalThis[capability];\n',
    "src/engine/explicit-date.ts":
      "export const epoch = new Date(0).getTime();\n",
    "src/engine/random.ts": "export const roll = Math.random();\n",
    "src/ghosts/clock.ts": "export const now = Date.now();\n",
    "src/ghosts/crypto.ts":
      'export const digest = crypto.subtle.digest("SHA-256", new Uint8Array());\n',
    "src/history/domain/schedule.ts":
      "export const schedule = (work: () => void) => setTimeout(work, 0);\n",
    "src/levels/created.ts": "export const created = new Date();\n",
    "src/levels/transcendental.ts": "export const wave = Math.sin(1);\n",
  });

  const result = await checkBoundaries(repositoryRoot);

  assert.equal(result.violations.length, 10);
  assert.ok(
    result.violations.every(
      ({ code }) => code === "BOUNDARY_RUNTIME_NONDETERMINISM",
    ),
  );
  assert.deepEqual(
    result.violations.map(({ file }) => file),
    [
      "src/domain/parsed-date.ts",
      "src/domain/random.ts",
      "src/engine/computed.ts",
      "src/engine/explicit-date.ts",
      "src/engine/random.ts",
      "src/ghosts/clock.ts",
      "src/ghosts/crypto.ts",
      "src/history/domain/schedule.ts",
      "src/levels/created.ts",
      "src/levels/transcendental.ts",
    ],
  );
});

test("allows deterministic standard-library calls and locally shadowed host names", async (t) => {
  const repositoryRoot = await fixtureRepository(t, {
    "src/engine/deterministic.ts": `
      export const magnitude = Math.abs(-4);
      export const product = Math.imul(7, 6);
      export function injected(
        Math: { readonly random: () => number },
        Date: new (value: number) => { readonly getTime: () => number },
        setTimeout: (work: () => void) => number,
        eval: (source: string) => number,
        Function: (source: string) => () => number,
      ) {
        const local = {
          localeCompare: () => 1,
          stack: "stable",
          toLocaleString: () => "stable",
        };
        return new Date(0).getTime() + Math.random() +
          setTimeout(() => undefined) + eval("1") + Function("1")() +
          local.localeCompare() + local.toLocaleString() + local.stack.length;
      }
    `,
  });

  const result = await checkBoundaries(repositoryRoot);

  assert.deepEqual(result.violations, []);
});

test("rejects code generation, locale-sensitive APIs, and native error stacks", async (t) => {
  const repositoryRoot = await fixtureRepository(t, {
    "src/domain/eval.ts": 'export const value = eval("Date.now()");\n',
    "src/engine/function.ts":
      'export const value = Function("return Math.random()")();\n',
    "src/ghosts/locale.ts": 'export const value = "i".localeCompare("I");\n',
    "src/history/domain/format.ts":
      "export const value = (1).toLocaleString();\n",
    "src/levels/stack.ts": "export const value = new Error().stack;\n",
  });

  const result = await checkBoundaries(repositoryRoot);
  assert.equal(result.violations.length, 5);
  assert.ok(
    result.violations.every(
      ({ code }) => code === "BOUNDARY_RUNTIME_NONDETERMINISM",
    ),
  );
});

test("rejects non-TypeScript pure modules and triple-slash authority injection", async (t) => {
  const repositoryRoot = await fixtureRepository(t, {
    "src/domain/untyped.js": "export const value = 1;\n",
    "src/domain/ambient.d.ts": "declare const document: unknown;\n",
    "src/engine/node.ts":
      '/// <reference types="node" />\nexport const value = Buffer.byteLength("x");\n',
    "src/ghosts/dom.ts":
      '/// <reference lib="dom" />\nexport type View = Document;\n',
    "src/levels/local.ts":
      '/// <reference path="../adapter/types.d.ts" />\nexport const value = 1;\n',
    "src/history/domain/no-default.ts":
      '/// <reference no-default-lib="true" />\nexport const value = 1;\n',
    "src/adapter/types.d.ts": "interface AdapterAuthority {}\n",
  });

  const result = await checkBoundaries(repositoryRoot);
  assert.deepEqual(result.violations.map(({ code }) => code).sort(), [
    "BOUNDARY_PURE_REFERENCE_DIRECTIVE",
    "BOUNDARY_PURE_REFERENCE_DIRECTIVE",
    "BOUNDARY_PURE_REFERENCE_DIRECTIVE",
    "BOUNDARY_PURE_REFERENCE_DIRECTIVE",
    "BOUNDARY_PURE_SOURCE_EXTENSION",
    "BOUNDARY_PURE_SOURCE_EXTENSION",
  ]);
});

test("fails closed on every symlink below src", async (t) => {
  const repositoryRoot = await fixtureRepository(t, {
    "src/engine/state.ts": "export const state = true;\n",
  });
  await symlink(
    "state.ts",
    path.join(repositoryRoot, "src/engine/linked-state.ts"),
  );

  await assert.rejects(
    checkBoundaries(repositoryRoot),
    /\[BOUNDARY_SOURCE_SYMLINK\] src\/engine\/linked-state\.ts/u,
  );
});

test("fails closed when a pure module hides a dependency behind an expression", async (t) => {
  const repositoryRoot = await fixtureRepository(t, {
    "src/engine/load.ts": `
      export async function load(moduleName: string) {
        return import(moduleName);
      }
    `,
  });

  const result = await checkBoundaries(repositoryRoot);

  assert.equal(result.violations.length, 1);
  assert.equal(
    result.violations[0].code,
    "BOUNDARY_NON_LITERAL_MODULE_SPECIFIER",
  );
});

test("CLI returns a non-zero status and stable diagnostic for a violation", async (t) => {
  const repositoryRoot = await fixtureRepository(t, {
    "src/engine/bad.ts": 'import "../render/bridge";\n',
  });

  const execution = spawnSync(
    process.execPath,
    [checkerPath, "--root", repositoryRoot],
    { encoding: "utf8" },
  );

  assert.equal(execution.status, 1);
  assert.equal(execution.stdout, "");
  assert.match(execution.stderr, /Source boundary check failed/u);
  assert.match(execution.stderr, /BOUNDARY_PURE_UNREVIEWED_LOCAL_AREA/u);
  assert.match(execution.stderr, /src\/engine\/bad\.ts:1:8/u);
});
