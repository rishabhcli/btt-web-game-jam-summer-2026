import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { format as formatWithPrettier } from "prettier";

import {
  createProcessRunner,
  ownedProcessTreeTarget,
  runVerification,
  runVerificationForTest,
} from "../../scripts/verify-all.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const fixtureRoot = path.join(repositoryRoot, ".dev", "test-tmp");
const commit = "0123456789abcdef0123456789abcdef01234567";
const headTree = "89abcdef0123456789abcdef0123456789abcdef";
const requiredNodeVersion = "v24.19.0";
const upInvocationId = "10000000-0000-4000-8000-000000000001";
const reusedUpInvocationId = "10000000-0000-4000-8000-000000000002";
const previousInvocationId = "10000000-0000-4000-8000-000000000003";
const healthInvocationId = "10000000-0000-4000-8000-000000000004";
const runIds = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
  "20000000-0000-4000-8000-000000000004",
];
const services = [
  { name: "game", serviceId: "game-dev", port: 4140 },
  { name: "preview", serviceId: "production-preview", port: 4141 },
  { name: "e2e", serviceId: "browser-history-e2e", port: 4142 },
  { name: "static", serviceId: "static-bundle", port: 4143 },
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fileIntegrity(label) {
  return { bytes: label.length, sha256: sha256(label) };
}

function browserEvidence(overrides = {}) {
  return {
    chromium: {
      version: "140.0.7339.0",
      executable: { bytes: 101, sha256: "a".repeat(64) },
    },
    firefox: {
      version: "141.0",
      executable: { bytes: 102, sha256: "b".repeat(64) },
    },
    webkit: {
      version: "26.0",
      executable: { bytes: 103, sha256: "c".repeat(64) },
    },
    ...overrides,
  };
}

function lifecycleLine(payload) {
  return `DEV_LIFECYCLE_RESULT ${JSON.stringify({ schemaVersion: "btt.dev-lifecycle/v1", ...payload })}\n`;
}

function serviceIdentities({
  invocationId = upInvocationId,
  startedByInvocation = true,
} = {}) {
  return services.map((service, index) => ({
    ...service,
    runId: runIds[index],
    startInvocationId: invocationId,
    pid: 51_000 + index,
    startedByInvocation,
  }));
}

function lifecycleChunks({ ownership = "started" } = {}) {
  const invocationId =
    ownership === "reused" ? reusedUpInvocationId : upInvocationId;
  const activeServices = serviceIdentities({
    invocationId: ownership === "reused" ? previousInvocationId : invocationId,
    startedByInvocation: ownership === "started",
  });
  return {
    activeServices,
    invocationId,
    chunks: {
      dev_up: [
        {
          stream: "stdout",
          text:
            lifecycleLine({
              command: "up",
              outcome: "STARTING",
              invocationId,
              ownership: "pending",
              exactOwned: true,
              services: [],
            }) +
            lifecycleLine({
              command: "up",
              outcome: "PASS",
              invocationId,
              ownership,
              exactOwned: true,
              services: activeServices,
            }),
        },
      ],
      dev_health: [
        {
          stream: "stdout",
          text:
            services
              .map(
                (service) =>
                  `health ${service.name}: ready http://127.0.0.1:${service.port}/`,
              )
              .join("\n") +
            "\ndev health passed: 4/4 exact-owned HTTP services\n" +
            lifecycleLine({
              command: "health",
              outcome: "PASS",
              invocationId: healthInvocationId,
              exactOwned: true,
              services: activeServices.map((service) => ({
                ...service,
                startedByInvocation: false,
              })),
            }),
        },
      ],
    },
  };
}

async function writeFixtureFile(root, relativePath, contents = "fixture\n") {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

async function createFixture(t) {
  await mkdir(fixtureRoot, { recursive: true });
  const root = await mkdtemp(path.join(fixtureRoot, "verify-all-"));
  t.after(async () => await rm(root, { force: true, recursive: true }));

  const inputPaths = [
    ".github/workflows/ci.yml",
    ".gitignore",
    ".npmrc",
    ".nvmrc",
    "AGENTS.md",
    "GOAL.md",
    "HACKATHON.md",
    "README.md",
    "WINNING_IDEA.md",
    "docs/dependencies.md",
    "evidence/README.md",
    "eslint.config.mjs",
    "package-lock.json",
    "package.json",
    "playwright.config.ts",
    "ports.env",
    "scripts/dev-services.mjs",
    "scripts/verify-all.mjs",
    "src/engine/index.ts",
    "src/main.ts",
    "tests/e2e/foundation.spec.ts",
    "tests/tooling/verify-all.test.mjs",
    "tests/unit/foundation.test.ts",
    "tsconfig.app.json",
    "tsconfig.base.json",
    "tsconfig.domain.json",
    "tsconfig.e2e.json",
    "tsconfig.json",
    "tsconfig.node.json",
    "tsconfig.test.json",
    "vite.config.ts",
    "vitest.config.ts",
  ];
  for (const relativePath of inputPaths) {
    await writeFixtureFile(root, relativePath);
  }
  await writeFixtureFile(
    root,
    "ports.env",
    [
      "DEV_HOST=127.0.0.1",
      "PORT_0=4140",
      "PORT_1=4141",
      "PORT_2=4142",
      "PORT_3=4143",
      "",
    ].join("\n"),
  );
  await writeFixtureFile(
    root,
    "node_modules/@playwright/test/package.json",
    '{"version":"1.62.1"}\n',
  );
  await writeFixtureFile(
    root,
    "node_modules/playwright/package.json",
    '{"version":"1.62.1"}\n',
  );
  await writeFixtureFile(root, "dist/index.html", "<!doctype html>\n");
  await writeFixtureFile(root, "test-tools/git", "fake git\n");
  await writeFixtureFile(root, "test-tools/npm-cli.js", "fake npm\n");
  const trustedTools = {
    gitPath: path.join(root, "test-tools", "git"),
    npmCliPath: path.join(root, "test-tools", "npm-cli.js"),
    integrity: {
      node: fileIntegrity("node"),
      npmCli: fileIntegrity("npm"),
      npmInstallationTree: {
        fileCount: 5,
        totalBytes: 1234,
        aggregateSha256: sha256("npm-installation"),
      },
      git: fileIntegrity("git"),
      localEntrypoints: {
        eslint: fileIntegrity("eslint"),
        playwright: fileIntegrity("playwright"),
        prettier: fileIntegrity("prettier"),
        tsc: fileIntegrity("tsc"),
        vite: fileIntegrity("vite"),
        vitest: fileIntegrity("vitest"),
      },
      installedDependencyTree: {
        fileCount: 12,
        totalBytes: 3456,
        aggregateSha256: sha256("node_modules"),
        excludedGeneratedRoots: [".cache", ".vite", ".vite-temp"],
      },
    },
  };
  return { inputPaths, root, trustedTools };
}

function discoveryOutput(inputPaths) {
  return `${[
    ...inputPaths,
    ".dev/private-generated.txt",
    "dist/index.html",
    "evidence/runs/old/manifest.json",
    "node_modules/generated.js",
  ].join("\0")}\0`;
}

function defaultChunks(specification, inputPaths, npmVersion) {
  const { id } = specification;
  switch (id) {
    case "meta_git_commit":
    case "meta_git_commit_end":
      return [{ stream: "stdout", text: `${commit}\n` }];
    case "meta_git_head_tree":
    case "meta_git_head_tree_end":
      return [{ stream: "stdout", text: `${headTree}\n` }];
    case "meta_git_index_matches_head":
    case "meta_git_index_matches_head_end":
    case "meta_git_status":
    case "meta_git_tag":
    case "meta_git_tag_end":
      return [];
    case "meta_git_inputs":
    case "meta_git_inputs_end":
      return [{ stream: "stdout", text: discoveryOutput(inputPaths) }];
    case "meta_npm_version":
      return [{ stream: "stdout", text: `${npmVersion}\n` }];
    case "meta_playwright_versions":
    case "meta_playwright_versions_end":
      return [
        { stream: "stdout", text: `${JSON.stringify(browserEvidence())}\n` },
      ];
    case "dev_up":
    case "dev_health":
      return lifecycleChunks().chunks[id];
    case "dev_down": {
      const expectedInvocationId = specification.args.at(-1);
      const stoppedServices =
        expectedInvocationId === upInvocationId
          ? serviceIdentities().map(
              ({ name, serviceId, port, runId, startInvocationId, pid }) => ({
                name,
                serviceId,
                port,
                runId,
                startInvocationId,
                pid,
              }),
            )
          : [];
      return [
        {
          stream: "stdout",
          text: lifecycleLine({
            command: "down",
            outcome: "PASS",
            expectedInvocationId,
            exactOwned: true,
            services: stoppedServices,
          }),
        },
      ];
    }
    default:
      return [{ stream: "stdout", text: `${id} passed\n` }];
  }
}

function createFakeRunner({
  inputPaths,
  chunksByCommand = {},
  failures = new Set(),
  npmVersion = "11.17.0",
  onCall,
  blockUntilAbortIds = new Set(),
}) {
  const calls = [];
  const runner = async (specification, onChunk) => {
    calls.push({
      id: specification.id,
      command: specification.command,
      args: [...specification.args],
      environment: { ...specification.env },
    });
    await onCall?.(specification);
    if (blockUntilAbortIds.has(specification.id)) {
      if (!specification.abortSignal?.aborted) {
        await new Promise((resolveAbort) =>
          specification.abortSignal?.addEventListener("abort", resolveAbort, {
            once: true,
          }),
        );
      }
    }
    const chunks =
      chunksByCommand[specification.id] ??
      defaultChunks(specification, inputPaths, npmVersion);
    let totalOutputBytes = 0;
    for (const chunk of chunks) {
      totalOutputBytes += Buffer.byteLength(chunk.text);
      onChunk(chunk.stream, chunk.text);
    }
    const aborted = specification.abortSignal?.aborted === true;
    const failed = failures.has(specification.id);
    return {
      exitCode: aborted ? null : failed ? 1 : 0,
      signal: null,
      timedOut: false,
      aborted,
      outputLimitExceeded: false,
      terminationCause: aborted ? "parent-signal" : null,
      forcedTermination: false,
      processTreeScope: "injected-test-runner",
      trackedDescendantCount: 0,
      descendantTrackingErrorCode: null,
      errorCode: null,
      errorMessage: null,
      totalOutputBytes,
    };
  };
  return { calls, runner };
}

function verificationOptions(root, runner, runId, trustedTools, extra = {}) {
  return {
    repositoryRoot: root,
    runner,
    runIdFactory: () => runId,
    observedNodeVersionForTest: requiredNodeVersion,
    sourceEnvironment: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    tee: false,
    trustedToolsForTest: trustedTools,
    ...extra,
  };
}

async function verifyFixture(fixture, runner, runId, extraOptions = {}) {
  return await runVerificationForTest(
    verificationOptions(
      fixture.root,
      runner,
      runId,
      fixture.trustedTools,
      extraOptions,
    ),
  );
}

async function readRunArtifacts(runDirectory) {
  const entries = await Promise.all(
    ["events.jsonl", "manifest.json", "summary.md", "SHA256SUMS"].map(
      async (name) => [
        name,
        await readFile(path.join(runDirectory, name), "utf8"),
      ],
    ),
  );
  return Object.fromEntries(entries);
}

test("records a noncanonical injected run with immutable ordered redacted evidence and all browser gates", async (t) => {
  const fixture = await createFixture(t);
  const secret = "top-secret-token";
  const { calls, runner } = createFakeRunner({
    inputPaths: fixture.inputPaths,
    chunksByCommand: {
      check: [
        { stream: "stdout", text: "first top-" },
        { stream: "stderr", text: "secret-" },
        { stream: "stdout", text: "token last\n" },
      ],
    },
  });
  const result = await verifyFixture(fixture, runner, "passing-run", {
    sourceEnvironment: {
      HOME: fixture.root,
      PATH: "/malicious/path",
      TOP_SECRET_TOKEN: secret,
    },
  });

  assert.equal(result.outcome, "PASS");
  assert.equal(result.manifest.producer.canonicalClaimEligible, false);
  assert.equal(
    result.manifest.producer.executionMode,
    "injected-test-noncanonical",
  );
  assert.deepEqual(
    calls.map((call) => call.id),
    [
      "meta_git_commit",
      "meta_git_head_tree",
      "meta_git_index_matches_head",
      "meta_git_status",
      "meta_git_inputs",
      "meta_git_tag",
      "meta_npm_version",
      "meta_playwright_versions",
      "check",
      "test",
      "build",
      "audit",
      "dev_preflight",
      "dev_up",
      "dev_health",
      "e2e_4142_all_browsers",
      "e2e_preview_4141_chromium",
      "e2e_static_4143_chromium",
      "dev_down",
      "meta_git_commit_end",
      "meta_git_head_tree_end",
      "meta_git_index_matches_head_end",
      "meta_git_inputs_end",
      "meta_git_tag_end",
      "meta_playwright_versions_end",
    ],
  );
  const downCall = calls.find((call) => call.id === "dev_down");
  assert.deepEqual(downCall.args.slice(-2), [
    "--expected-invocation",
    upInvocationId,
  ]);
  for (const commandId of [
    "e2e_4142_all_browsers",
    "e2e_preview_4141_chromium",
    "e2e_static_4143_chromium",
  ]) {
    assert.equal(
      calls.find((call) => call.id === commandId).environment
        .BTT_REUSE_OWNED_E2E_SERVER,
      "1",
    );
  }
  assert.equal(
    calls.find((call) => call.id === "e2e_preview_4141_chromium").environment
      .BTT_E2E_TARGET,
    "preview",
  );
  assert.equal(
    calls.find((call) => call.id === "e2e_static_4143_chromium").environment
      .BTT_E2E_TARGET,
    "static",
  );
  assert.equal(
    result.manifest.serviceReuse.allFourValidatedOwnedBeforeReuse,
    true,
  );
  assert.equal(result.manifest.cleanup.outcome, "PASS");
  assert.equal(result.manifest.source.cleanStart.clean, true);
  assert.equal(result.manifest.source.endStateProof.stable, true);
  assert.equal(result.manifest.inputs.complete, true);
  assert.equal(result.manifest.reproducibilityBindings.complete, true);
  assert.equal(
    result.manifest.reproducibilityBindings.lockfile.path,
    "package-lock.json",
  );
  assert.equal(result.manifest.toolIntegrity.stable, true);
  assert.equal(result.manifest.system.playwright.browserIntegrityStable, true);
  assert.match(
    result.manifest.toolIntegrity.start.installedDependencyTree.aggregateSha256,
    /^[0-9a-f]{64}$/u,
  );
  assert.equal(result.manifest.randomness.status, "applicable");
  assert.equal(
    result.manifest.randomness.runIdentifier.source,
    "injected-test-run-id-factory",
  );
  assert.equal(
    calls.find((call) => call.id === "meta_git_commit").command,
    fixture.trustedTools.gitPath,
  );
  assert.equal(
    calls.find((call) => call.id === "meta_npm_version").command,
    process.execPath,
  );
  assert.equal(
    calls.find((call) => call.id === "meta_npm_version").args[0],
    fixture.trustedTools.npmCliPath,
  );
  assert.equal(
    calls.some((call) => call.environment.PATH.includes("/malicious/path")),
    false,
  );

  const artifacts = await readRunArtifacts(result.runDirectory);
  const combinedArtifacts = Object.values(artifacts).join("\n");
  assert.equal(combinedArtifacts.includes(secret), false);
  assert.equal(combinedArtifacts.includes(fixture.root), false);
  assert.equal(
    await formatWithPrettier(artifacts["manifest.json"], { parser: "json" }),
    artifacts["manifest.json"],
  );
  assert.equal(
    await formatWithPrettier(artifacts["summary.md"], { parser: "markdown" }),
    artifacts["summary.md"],
  );
  const events = artifacts["events.jsonl"]
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const checkEvents = events.filter(
    (event) => event.type === "command_output" && event.commandId === "check",
  );
  assert.deepEqual(
    checkEvents.map((event) => event.stream),
    ["stdout", "stderr", "stdout"],
  );
  assert.equal(
    checkEvents.map((event) => event.text).join(""),
    "first **************** last\n",
  );

  const expectedChecksums = new Map(
    artifacts.SHA256SUMS.trim()
      .split("\n")
      .map((line) => {
        const [digest, name] = line.split(/\s{2}/u);
        return [name, digest];
      }),
  );
  for (const name of ["events.jsonl", "manifest.json", "summary.md"]) {
    assert.equal(sha256(artifacts[name]), expectedChecksums.get(name));
  }
});

test("canonical entrypoint rejects all evidence-affecting injection", async () => {
  await assert.rejects(
    runVerification({ runner: async () => ({ exitCode: 0 }) }),
    /VERIFY_CANONICAL_INJECTION_FORBIDDEN/u,
  );
  await assert.rejects(
    runVerification({ runIdFactory: () => "predictable" }),
    /VERIFY_CANONICAL_INJECTION_FORBIDDEN/u,
  );
});

test("dirty status and a staged index mismatch are explicit terminal failures", async (t) => {
  const fixture = await createFixture(t);
  const { calls, runner } = createFakeRunner({
    inputPaths: fixture.inputPaths,
    chunksByCommand: {
      meta_git_status: [{ stream: "stdout", text: " M src/main.ts\0" }],
    },
    failures: new Set(["meta_git_index_matches_head"]),
  });
  const result = await verifyFixture(fixture, runner, "dirty-index-run");

  assert.equal(result.outcome, "FAIL");
  assert.ok(result.manifest.failureCodes.includes("DIRTY_START"));
  assert.ok(result.manifest.failureCodes.includes("INDEX_DOES_NOT_MATCH_HEAD"));
  assert.equal(result.manifest.source.cleanStart.indexMatchesHead, false);
  assert.equal(
    calls.some((call) => call.id === "dev_up"),
    false,
  );
  assert.equal(
    calls.some((call) => call.id === "dev_down"),
    false,
  );
});

test("failed artifacts remain immutable and a collision allocates a unique run", async (t) => {
  const fixture = await createFixture(t);
  const failedRunner = createFakeRunner({
    inputPaths: fixture.inputPaths,
    failures: new Set(["test"]),
  });
  const failed = await verifyFixture(
    fixture,
    failedRunner.runner,
    "failed-run",
  );
  assert.equal(failed.outcome, "FAIL");
  assert.equal(
    failedRunner.calls.some((call) => call.id === "dev_down"),
    false,
  );
  const immutableFailure = await readFile(
    path.join(failed.runDirectory, "manifest.json"),
    "utf8",
  );

  const passingRunner = createFakeRunner({ inputPaths: fixture.inputPaths });
  const passing = await runVerificationForTest({
    ...verificationOptions(
      fixture.root,
      passingRunner.runner,
      "unused",
      fixture.trustedTools,
    ),
    runIdFactory: (_startedAt, attempt) =>
      attempt === 0 ? "failed-run" : `collision-retry-${attempt}`,
  });
  assert.equal(passing.outcome, "PASS");
  assert.equal(passing.runId, "collision-retry-1");
  assert.equal(
    await readFile(path.join(failed.runDirectory, "manifest.json"), "utf8"),
    immutableFailure,
  );
});

test("rejects evidence and temporary-directory parent symlinks", async (t) => {
  const first = await createFixture(t);
  await mkdir(path.join(first.root, "outside"));
  await rm(path.join(first.root, "evidence"), { recursive: true });
  await symlink(
    path.join(first.root, "outside"),
    path.join(first.root, "evidence"),
  );
  const firstRunner = createFakeRunner({ inputPaths: first.inputPaths });
  await assert.rejects(
    verifyFixture(first, firstRunner.runner, "unsafe-evidence"),
    /VERIFY_DIRECTORY_PARENT_UNSAFE/u,
  );

  const second = await createFixture(t);
  await mkdir(path.join(second.root, "outside"));
  await symlink(
    path.join(second.root, "outside"),
    path.join(second.root, ".dev"),
  );
  const secondRunner = createFakeRunner({ inputPaths: second.inputPaths });
  await assert.rejects(
    verifyFixture(second, secondRunner.runner, "unsafe-temp"),
    /VERIFY_DIRECTORY_PARENT_UNSAFE/u,
  );
});

test("rejects symlinked and escaping repository input paths", async (t) => {
  const fixture = await createFixture(t);
  await symlink("main.ts", path.join(fixture.root, "src", "linked.ts"));
  const unsafePaths = [...fixture.inputPaths, "src/linked.ts", "../escape.ts"];
  const { runner } = createFakeRunner({ inputPaths: unsafePaths });
  const result = await verifyFixture(fixture, runner, "unsafe-input-run");

  assert.equal(result.outcome, "FAIL");
  assert.ok(result.manifest.failureCodes.includes("INPUT_MANIFEST_INCOMPLETE"));
  assert.ok(
    result.manifest.inputs.files.some(
      (entry) =>
        entry.path === "src/linked.ts" &&
        entry.type === "symbolic-link-rejected",
    ),
  );
  assert.equal(result.manifest.inputs.discovery.rejectedPathDigests.length, 1);
});

test("end proof detects source or discovered-input mutation", async (t) => {
  const fixture = await createFixture(t);
  const { runner } = createFakeRunner({
    inputPaths: fixture.inputPaths,
    async onCall(specification) {
      if (specification.id === "audit") {
        await writeFixtureFile(fixture.root, "src/main.ts", "mutated\n");
      }
    },
  });
  const result = await verifyFixture(fixture, runner, "mutated-input-run");

  assert.equal(result.outcome, "FAIL");
  assert.ok(
    result.manifest.failureCodes.includes(
      "SOURCE_OR_INPUTS_CHANGED_DURING_RUN",
    ),
  );
  assert.equal(result.manifest.source.endStateProof.stable, false);
});

test("served build digest is taken after dev:up rebuilds dist", async (t) => {
  const fixture = await createFixture(t);
  const { runner } = createFakeRunner({
    inputPaths: fixture.inputPaths,
    async onCall(specification) {
      if (specification.id === "dev_up") {
        await writeFixtureFile(
          fixture.root,
          "dist/index.html",
          "<!doctype html><title>served</title>\n",
        );
      }
    },
  });
  const result = await verifyFixture(fixture, runner, "served-build-run");

  assert.equal(result.outcome, "PASS");
  assert.notEqual(
    result.manifest.preliminaryBuildOutput.aggregateSha256,
    result.manifest.buildOutput.aggregateSha256,
  );
  assert.equal(result.manifest.buildOutput.complete, true);
});

test("reused exact-owned services are validated but never stopped", async (t) => {
  const fixture = await createFixture(t);
  const reused = lifecycleChunks({ ownership: "reused" });
  const { calls, runner } = createFakeRunner({
    inputPaths: fixture.inputPaths,
    chunksByCommand: reused.chunks,
  });
  const result = await verifyFixture(fixture, runner, "reused-run");

  assert.equal(result.outcome, "PASS");
  assert.equal(result.manifest.cleanup.attempted, false);
  assert.equal(result.manifest.cleanup.devServiceOwnership, "reused");
  assert.equal(
    calls.some((call) => call.id === "dev_down"),
    false,
  );
});

test("a failed up with a STARTING lease performs only expected-invocation cleanup", async (t) => {
  const fixture = await createFixture(t);
  const startingOnly = lifecycleLine({
    command: "up",
    outcome: "STARTING",
    invocationId: upInvocationId,
    ownership: "pending",
    exactOwned: true,
    services: [],
  });
  const { calls, runner } = createFakeRunner({
    inputPaths: fixture.inputPaths,
    chunksByCommand: {
      dev_up: [{ stream: "stdout", text: startingOnly }],
    },
    failures: new Set(["dev_up"]),
  });
  const result = await verifyFixture(fixture, runner, "partial-up-run");

  assert.equal(result.outcome, "FAIL");
  assert.ok(result.manifest.failureCodes.includes("COMMAND_FAILED:dev_up"));
  assert.ok(
    result.manifest.failureCodes.includes("DEV_UP_OWNERSHIP_PROOF_INVALID"),
  );
  const downCall = calls.find((call) => call.id === "dev_down");
  assert.deepEqual(downCall.args.slice(-2), [
    "--expected-invocation",
    upInvocationId,
  ]);
});

test("health identities must match all four services from the up proof", async (t) => {
  const fixture = await createFixture(t);
  const active = serviceIdentities();
  const invalidHealthServices = active.map((service) => ({
    ...service,
    startedByInvocation: false,
  }));
  [invalidHealthServices[0].runId, invalidHealthServices[1].runId] = [
    invalidHealthServices[1].runId,
    invalidHealthServices[0].runId,
  ];
  const { calls, runner } = createFakeRunner({
    inputPaths: fixture.inputPaths,
    chunksByCommand: {
      dev_health: [
        {
          stream: "stdout",
          text:
            "dev health passed: 4/4 exact-owned HTTP services\n" +
            lifecycleLine({
              command: "health",
              outcome: "PASS",
              invocationId: healthInvocationId,
              exactOwned: true,
              services: invalidHealthServices,
            }),
        },
      ],
    },
  });
  const result = await verifyFixture(fixture, runner, "invalid-health-run");

  assert.equal(result.outcome, "FAIL");
  assert.ok(
    result.manifest.failureCodes.includes("OWNED_SERVICE_HEALTH_PROOF_INVALID"),
  );
  assert.equal(
    calls.some((call) => call.id.startsWith("e2e_")),
    false,
  );
  assert.equal(
    calls.some((call) => call.id === "dev_down"),
    true,
  );
});

test("tag probe failure cannot coexist with PASS", async (t) => {
  const fixture = await createFixture(t);
  const { runner } = createFakeRunner({
    inputPaths: fixture.inputPaths,
    failures: new Set(["meta_git_tag"]),
  });
  const result = await verifyFixture(fixture, runner, "tag-failure-run");
  assert.equal(result.outcome, "FAIL");
  assert.ok(result.manifest.failureCodes.includes("TAG_PROBE_FAILED"));
});

test("requires exact pinned Node and npm versions", async (t) => {
  const fixture = await createFixture(t);
  const { runner } = createFakeRunner({
    inputPaths: fixture.inputPaths,
    npmVersion: "11.18.0",
  });
  const result = await verifyFixture(fixture, runner, "runtime-mismatch-run", {
    observedNodeVersionForTest: "v26.5.1",
  });

  assert.equal(result.outcome, "FAIL");
  assert.ok(result.manifest.failureCodes.includes("NODE_VERSION_MISMATCH"));
  assert.ok(result.manifest.failureCodes.includes("NPM_VERSION_MISMATCH"));
});

test("tool and browser integrity are rechecked at the end", async (t) => {
  const fixture = await createFixture(t);
  const changedTools = structuredClone(fixture.trustedTools);
  changedTools.integrity.localEntrypoints.vite = fileIntegrity("changed-vite");
  const { runner } = createFakeRunner({
    inputPaths: fixture.inputPaths,
    async onCall(specification) {
      if (specification.id === "e2e_static_4143_chromium") {
        await writeFixtureFile(
          fixture.root,
          "dist/index.html",
          "changed after browser reuse\n",
        );
      }
    },
    chunksByCommand: {
      meta_playwright_versions_end: [
        {
          stream: "stdout",
          text: `${JSON.stringify(
            browserEvidence({
              chromium: {
                version: "140.0.7339.0",
                executable: { bytes: 101, sha256: "d".repeat(64) },
              },
            }),
          )}\n`,
        },
      ],
    },
  });
  const result = await verifyFixture(fixture, runner, "integrity-change-run", {
    trustedToolsEndForTest: changedTools,
  });

  assert.equal(result.outcome, "FAIL");
  assert.ok(
    result.manifest.failureCodes.includes("TOOL_INTEGRITY_CHANGED_DURING_RUN"),
  );
  assert.ok(
    result.manifest.failureCodes.includes(
      "BROWSER_INTEGRITY_CHANGED_DURING_RUN",
    ),
  );
  assert.ok(
    result.manifest.failureCodes.includes("SERVED_BUILD_CHANGED_DURING_RUN"),
  );
  assert.equal(result.manifest.toolIntegrity.stable, false);
  assert.equal(result.manifest.system.playwright.browserIntegrityStable, false);
});

test("total deadline aborts work but preserves bounded final evidence", async (t) => {
  const fixture = await createFixture(t);
  const { calls, runner } = createFakeRunner({
    inputPaths: fixture.inputPaths,
    blockUntilAbortIds: new Set(["check"]),
  });
  const result = await verifyFixture(fixture, runner, "deadline-run", {
    totalTimeoutMsForTest: 500,
  });

  assert.equal(result.outcome, "FAIL");
  assert.ok(result.manifest.failureCodes.includes("TOTAL_DEADLINE_EXCEEDED"));
  assert.equal(result.manifest.interruption.partialArtifactsFinalized, true);
  assert.equal(
    calls.some((call) => call.id === "meta_git_inputs_end"),
    true,
  );
  await readRunArtifacts(result.runDirectory);
});

test("parent abort preserves partial evidence without stopping services it never started", async (t) => {
  const fixture = await createFixture(t);
  const abortController = new AbortController();
  const { calls, runner } = createFakeRunner({
    inputPaths: fixture.inputPaths,
    onCall(specification) {
      if (specification.id === "check") abortController.abort("SIGTERM");
    },
  });
  const result = await verifyFixture(fixture, runner, "interrupted-run", {
    abortSignal: abortController.signal,
    interruption: {
      signal: "SIGTERM",
      requestedAtUtc: "2026-08-10T00:00:00.000Z",
    },
  });

  assert.equal(result.outcome, "FAIL");
  assert.ok(result.manifest.failureCodes.includes("INTERRUPTED"));
  assert.equal(
    calls.some((call) => call.id === "dev_down"),
    false,
  );
  assert.equal(result.manifest.interruption.partialArtifactsFinalized, true);
  await readRunArtifacts(result.runDirectory);
});

test(
  "timeout kills a detached descendant outside the command process group",
  { skip: process.platform === "win32" },
  async (t) => {
    assert.deepEqual(ownedProcessTreeTarget(1234), {
      scope: "dedicated-posix-process-group",
      target: -1234,
    });
    const runner = createProcessRunner();
    let output = "";
    let descendantPid = null;
    t.after(() => {
      if (!descendantPid) return;
      try {
        process.kill(descendantPid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    });
    const result = await runner(
      {
        id: "process_tree_test",
        command: process.execPath,
        args: [
          "--input-type=commonjs",
          "--eval",
          'const {spawn}=require("node:child_process");const child=spawn(process.execPath,["--input-type=commonjs","--eval","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"});child.unref();process.stdout.write(String(child.pid)+"\\n");setInterval(()=>{},1000);',
        ],
        cwd: repositoryRoot,
        env: { PATH: "/usr/bin:/bin" },
        timeoutMs: 5_000,
        terminationGraceMs: 500,
        killVerificationMs: 2_000,
        maxOutputBytes: 1024 * 1024,
      },
      (_stream, text) => {
        output += text;
      },
    );
    descendantPid = Number.parseInt(/^[0-9]+$/mu.exec(output)?.[0] ?? "", 10);
    assert.equal(result.timedOut, true);
    assert.equal(result.terminationCause, "timeout");
    assert.ok(result.trackedDescendantCount >= 1);
    assert.ok(Number.isSafeInteger(descendantPid));

    let descendantAlive = true;
    for (let attempt = 0; attempt < 80 && descendantAlive; attempt += 1) {
      try {
        process.kill(descendantPid, 0);
        await new Promise((resolve) => setTimeout(resolve, 25));
      } catch (error) {
        if (error?.code === "ESRCH") descendantAlive = false;
        else throw error;
      }
    }
    assert.equal(descendantAlive, false);
  },
);

test(
  "a successful leader cannot leave a detached descendant behind",
  { skip: process.platform === "win32" },
  async (t) => {
    const runner = createProcessRunner();
    let output = "";
    let descendantPid = null;
    t.after(() => {
      if (!descendantPid) return;
      try {
        process.kill(descendantPid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    });

    const result = await runner(
      {
        id: "successful_leader_with_leaked_descendant",
        command: process.execPath,
        args: [
          "--input-type=commonjs",
          "--eval",
          'const {spawn}=require("node:child_process");const child=spawn(process.execPath,["--input-type=commonjs","--eval","setInterval(()=>{},1000)"],{detached:true,stdio:"ignore"});child.unref();process.stdout.write(String(child.pid)+"\\n");setTimeout(()=>process.exit(0),250);',
        ],
        cwd: repositoryRoot,
        env: { PATH: "/usr/bin:/bin" },
        timeoutMs: 5_000,
        maxOutputBytes: 1024 * 1024,
      },
      (_stream, text) => {
        output += text;
      },
    );

    descendantPid = Number.parseInt(/^[0-9]+$/mu.exec(output)?.[0] ?? "", 10);
    assert.equal(result.exitCode, 0);
    assert.equal(result.terminationCause, "leaked-descendant");
    assert.ok(result.trackedDescendantCount >= 1);
    assert.ok(Number.isSafeInteger(descendantPid));

    let descendantAlive = true;
    for (let attempt = 0; attempt < 80 && descendantAlive; attempt += 1) {
      try {
        process.kill(descendantPid, 0);
        await new Promise((resolve) => setTimeout(resolve, 25));
      } catch (error) {
        if (error?.code === "ESRCH") descendantAlive = false;
        else throw error;
      }
    }
    assert.equal(descendantAlive, false);
  },
);
