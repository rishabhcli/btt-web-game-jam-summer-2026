import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  link,
  mkdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

import { checkLocalState } from "../../scripts/check-local-state.mjs";

import {
  DEV_HOST,
  DevServiceError,
  REPOSITORY_NAME,
  REPOSITORY_ROOT,
  RESERVED_PORTS,
  SERVICE_TEMPLATES,
  selectExpectedCleanupServices,
  assertExactSocketOwnership,
  classifyV2RuntimeState,
  inspectBuildIntegrity,
  isRetryableHealthError,
  legacyCommandsMatchService,
  parseMacNetstatListeners,
  parsePortsEnv,
  processIdentityMatches,
  signalExactIdentity,
  validateHealthResponse,
  validatePidRecord,
  withDevServiceLease,
} from "../../scripts/dev-services.mjs";
import {
  LOG_ROOT,
  NODE_EXECUTABLE,
  RUN_HEADER,
  SERVICE_INTEGRITY_INPUTS,
  SERVICE_HEADER,
  SUPERVISOR_PATH,
  assertSafeExistingNode,
  assertSafePathComponents,
  ensureSafeDevLayout,
  integrityEqual,
  parseLsofSocketListeners,
  parseMacNativeSocketListeners,
  parsePsIdentity,
  readProcessIdentity,
  sanitizedEnvironment,
  supervisorCommand,
  validateSupervisorIdentity,
} from "../../scripts/dev-service-runtime.mjs";
import {
  MAX_REQUEST_TARGET_BYTES,
  STATIC_HOST,
  STATIC_PORT,
  STATIC_SERVICE_ID,
  StaticServerError,
  isPathInsideRoot,
  parseRequestPath,
  parseSingleByteRange,
  resolveStaticFile,
  parseStaticServerOptions,
  startStaticServer,
  validateHostHeader,
  validateStaticServerOptions,
} from "../../scripts/static-server.mjs";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CREATED_AT = "2026-08-10T00:00:00.000Z";
const validPortsSource = `
# repository-owned assignments
DEV_HOST=127.0.0.1
PORT_0=4140 # game
PORT_1=4141 # preview
PORT_2=4142 # e2e
PORT_3=4143 # static
`;
checkLocalState();
const REPOSITORY_TMP_ROOT = resolve(REPOSITORY_ROOT, ".dev/tmp");

function expectCode(callback, code) {
  assert.throws(callback, (error) => {
    assert.ok(
      error instanceof DevServiceError || error instanceof StaticServerError,
    );
    assert.equal(error.code, code);
    return true;
  });
}

async function expectRejectedCode(callback, code) {
  await assert.rejects(callback, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

function fixtureIntegrity() {
  return {
    source: {
      algorithm: "sha256",
      digest: "a".repeat(64),
      fileCount: 12,
    },
    build: {
      algorithm: "sha256",
      digest: "b".repeat(64),
      manifestDigest: "c".repeat(64),
      assetCount: 1,
      assets: ["assets/main.js"],
    },
  };
}

function fixtureIdentity(service = SERVICE_TEMPLATES[0], runId = RUN_ID) {
  return {
    pid: 42000,
    parentPid: 1,
    processGroupId: 42000,
    sessionId: "0",
    startToken: "Sun Aug 9 22:34:48 2026",
    command: supervisorCommand(service, runId),
    cwd: REPOSITORY_ROOT,
  };
}

function fixtureRecord(service = SERVICE_TEMPLATES[0], state = "ready") {
  const processIdentity = fixtureIdentity(service);
  return {
    version: 2,
    repositoryName: REPOSITORY_NAME,
    repositoryRoot: REPOSITORY_ROOT,
    service: service.name,
    serviceId: service.serviceId,
    host: DEV_HOST,
    port: service.port,
    runId: RUN_ID,
    startInvocationId: "22222222-2222-4222-8222-222222222222",
    state,
    process: processIdentity,
    socketHolderPids: state === "ready" ? [processIdentity.pid] : [],
    integrity: fixtureIntegrity(),
    createdAt: CREATED_AT,
    logPath: resolve(LOG_ROOT, `${service.name}.log`),
  };
}

function listener(
  service,
  pid = 42000,
  localAddress = undefined,
  protocol = "tcp4",
) {
  return {
    pid,
    protocol,
    localAddress: localAddress ?? `${DEV_HOST}.${service.port}`,
  };
}

async function makeBuildFixture(t) {
  const root = await mkdtemp(join(REPOSITORY_TMP_ROOT, "btt-build-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, ".vite"), { recursive: true });
  await mkdir(resolve(root, "assets"), { recursive: true });
  await writeFile(
    resolve(root, "index.html"),
    '<!doctype html><meta name="btt-service" content="game-shell"><link href="/assets/main.css" rel="stylesheet"><script type="module" src="/assets/main.js"></script>',
  );
  await writeFile(
    resolve(root, ".vite/manifest.json"),
    `${JSON.stringify({ "index.html": { file: "assets/main.js", css: ["assets/main.css"] } })}\n`,
  );
  await writeFile(resolve(root, "assets/main.js"), "console.log('built');\n");
  await writeFile(resolve(root, "assets/main.css"), "body { color: white; }\n");
  return root;
}

test("ports.env accepts only loopback assignments 4140-4143", () => {
  const config = parsePortsEnv(validPortsSource);
  assert.equal(config.host, DEV_HOST);
  assert.deepEqual(config.ports, {
    PORT_0: 4140,
    PORT_1: 4141,
    PORT_2: 4142,
    PORT_3: 4143,
  });
  assert.deepEqual(RESERVED_PORTS, [4144, 4145, 4146, 4147, 4148, 4149]);
  expectCode(
    () => parsePortsEnv(validPortsSource.replace(DEV_HOST, "0.0.0.0")),
    "DEV_HOST_INVALID",
  );
  expectCode(
    () => parsePortsEnv(`${validPortsSource}\nPORT_4=4144\n`),
    "DEV_PORT_ALLOCATION_FORBIDDEN",
  );
  expectCode(
    () => parsePortsEnv(validPortsSource.replace("PORT_2=4142", "PORT_2=5173")),
    "DEV_PORT_INVALID",
  );
});

test("health convergence retries only transient transport failures", () => {
  for (const code of [
    "DEV_HEALTH_TIMEOUT",
    "ECONNREFUSED",
    "ECONNRESET",
    "EPIPE",
    "ETIMEDOUT",
  ]) {
    assert.equal(isRetryableHealthError({ code }), true, code);
  }
  for (const code of [
    "DEV_HEALTH_SERVICE_SPOOF",
    "DEV_HEALTH_RUN_SPOOF",
    "DEV_HEALTH_STATUS_INVALID",
    "UNKNOWN",
  ]) {
    assert.equal(isRetryableHealthError({ code }), false, code);
  }
});

test("the service contract has four unique markers and multi-path readiness", () => {
  assert.deepEqual(
    SERVICE_TEMPLATES.map(({ name, port, serviceId }) => ({
      name,
      port,
      serviceId,
    })),
    [
      { name: "game", port: 4140, serviceId: "game-dev" },
      { name: "preview", port: 4141, serviceId: "production-preview" },
      { name: "e2e", port: 4142, serviceId: "browser-history-e2e" },
      { name: "static", port: 4143, serviceId: "static-bundle" },
    ],
  );
  assert.deepEqual(
    SERVICE_TEMPLATES.map((service) =>
      service.healthChecks.map(({ path }) => path),
    ),
    [
      ["/@vite/client", "/", "/src/main.ts"],
      ["/"],
      ["/@vite/client", "/", "/src/main.ts"],
      ["/__health", "/"],
    ],
  );
});

test("service integrity binds every build and native lifecycle input", () => {
  assert.deepEqual(SERVICE_INTEGRITY_INPUTS, [
    "src",
    "index.html",
    "package.json",
    "package-lock.json",
    "vite.config.ts",
    "tsconfig.json",
    "tsconfig.base.json",
    "tsconfig.domain.json",
    "tsconfig.app.json",
    "tsconfig.test.json",
    "tsconfig.e2e.json",
    "tsconfig.node.json",
    "scripts/static-server.mjs",
    "scripts/vite-service.mjs",
    "scripts/safe-environment.mjs",
    "scripts/dev-services.mjs",
    "scripts/dev-service-runtime.mjs",
    "scripts/dev-service-supervisor.mjs",
    "scripts/owned-process-runner.mjs",
    "scripts/owned-process-snapshot.c",
    "scripts/check-local-state.mjs",
    "scripts/dev-process-cwd.c",
    "scripts/dev-socket-listeners.c",
  ]);
});

test("macOS socket parsing includes wildcard and IPv6 listeners", () => {
  const source = `
tcp4 0 0 127.0.0.1.4142 *.* LISTEN 0 0 131072 131072 node:98286 00100
tcp4 0 0 0.0.0.0.4142 *.* LISTEN 0 0 131072 131072 ruby:22222 00100
tcp4 0 0 *.4142 *.* LISTEN 0 0 131072 131072 ruby:22223 00100
tcp6 0 0 ::1.4142 *.* LISTEN 0 0 131072 131072 node:11111 00100
tcp6 0 0 [::]:4142 *.* LISTEN 0 0 131072 131072 python:33333 00100
`;
  assert.deepEqual(parseMacNetstatListeners(source, 4142), [
    { pid: 98286, protocol: "tcp4", localAddress: "127.0.0.1.4142" },
    { pid: 22222, protocol: "tcp4", localAddress: "0.0.0.0.4142" },
    { pid: 22223, protocol: "tcp4", localAddress: "*.4142" },
    { pid: 11111, protocol: "tcp6", localAddress: "::1.4142" },
    { pid: 33333, protocol: "tcp6", localAddress: "[::]:4142" },
  ]);
  assert.deepEqual(parseMacNetstatListeners(source, 4143), []);
});

test("native macOS socket parsing preserves PID, interface, and protocol", () => {
  const source = [
    "98286\ttcp4\t127.0.0.1\t4142",
    "22222\ttcp4\t0.0.0.0\t4142",
    "11111\ttcp6\t::1\t4142",
    "33333\ttcp6\t::\t4142",
    "44444\ttcp4\t127.0.0.1\t4143",
    "",
  ].join("\n");
  assert.deepEqual(parseMacNativeSocketListeners(source, 4142), [
    { pid: 98286, protocol: "tcp4", localAddress: "127.0.0.1:4142" },
    { pid: 22222, protocol: "tcp4", localAddress: "0.0.0.0:4142" },
    { pid: 11111, protocol: "tcp6", localAddress: "[::1]:4142" },
    { pid: 33333, protocol: "tcp6", localAddress: "[::]:4142" },
  ]);
  assert.deepEqual(parseMacNativeSocketListeners(source, 4143), [
    { pid: 44444, protocol: "tcp4", localAddress: "127.0.0.1:4143" },
  ]);
  expectCode(
    () => parseMacNativeSocketListeners("not-safe-output\n", 4142),
    "DEV_SOCKET_HELPER_OUTPUT_INVALID",
  );
});

test("lsof socket parsing retains the actual endpoint", () => {
  assert.deepEqual(
    parseLsofSocketListeners("p91\nn127.0.0.1:4140\np92\nn*:4140\n", 4140),
    [
      { pid: 91, protocol: "tcp", localAddress: "127.0.0.1:4140" },
      { pid: 92, protocol: "tcp", localAddress: "*:4140" },
    ],
  );
});

test("exact socket ownership rejects extras, swaps, wildcard, and IPv6", () => {
  const service = SERVICE_TEMPLATES[0];
  assert.equal(
    assertExactSocketOwnership(service, [listener(service)], [42000]),
    true,
  );
  expectCode(
    () =>
      assertExactSocketOwnership(
        service,
        [listener(service), listener(service, 42001)],
        [42000],
      ),
    "DEV_SOCKET_OWNER_MISMATCH",
  );
  expectCode(
    () =>
      assertExactSocketOwnership(service, [listener(service, 42001)], [42000]),
    "DEV_SOCKET_OWNER_MISMATCH",
  );
  expectCode(
    () =>
      assertExactSocketOwnership(
        service,
        [listener(service, 42000, `*.${service.port}`)],
        [42000],
      ),
    "DEV_SOCKET_INTERFACE_MISMATCH",
  );
  expectCode(
    () =>
      assertExactSocketOwnership(
        service,
        [listener(service, 42000, `::1.${service.port}`, "tcp6")],
        [42000],
      ),
    "DEV_SOCKET_INTERFACE_MISMATCH",
  );
});

test("identity comparison refuses same argv/cwd after PID reuse or group drift", () => {
  const identity = fixtureIdentity();
  assert.equal(processIdentityMatches(identity, { ...identity }), true);
  assert.equal(
    processIdentityMatches(identity, { ...identity, startToken: "reused" }),
    false,
  );
  assert.equal(
    processIdentityMatches(identity, { ...identity, processGroupId: 999 }),
    false,
  );
  assert.equal(
    processIdentityMatches(identity, { ...identity, sessionId: "foreign" }),
    false,
  );
  assert.equal(
    processIdentityMatches(identity, { ...identity, cwd: "/tmp/foreign" }),
    false,
  );
});

test("signal guard never invokes kill for a foreign or reused PID", () => {
  const identity = fixtureIdentity();
  let sent = false;
  expectCode(
    () =>
      signalExactIdentity(identity, "SIGTERM", {
        readIdentity: () => ({ ...identity, startToken: "reused" }),
        sendSignal: () => {
          sent = true;
        },
      }),
    "DEV_SIGNAL_IDENTITY_CHANGED",
  );
  assert.equal(sent, false);
  assert.equal(
    signalExactIdentity(identity, "SIGTERM", {
      readIdentity: () => ({ ...identity }),
      sendSignal: (pid, signal) => {
        assert.equal(pid, identity.pid);
        assert.equal(signal, "SIGTERM");
        sent = true;
      },
    }),
    true,
  );
  assert.equal(sent, true);
});

test("external health leases reject unsafe labels before touching lifecycle state", async () => {
  await expectRejectedCode(
    () => withDevServiceLease("../foreign", async () => undefined),
    "DEV_LEASE_LABEL_INVALID",
  );
});

test("ps identity parsing records actual cwd, start, PGID, session, and argv", () => {
  const parsed = parsePsIdentity(
    `42000 1 42000 0 Sun Aug 9 22:34:48 2026 ${NODE_EXECUTABLE} ${SUPERVISOR_PATH} --service game --run-id ${RUN_ID}`,
    REPOSITORY_ROOT,
  );
  assert.deepEqual(parsed, fixtureIdentity());
});

test("native identity inspection returns the external process actual cwd", async () => {
  await ensureSafeDevLayout();
  const child = spawn(NODE_EXECUTABLE, ["-e", "setTimeout(() => {}, 30000)"], {
    cwd: REPOSITORY_ROOT,
    env: sanitizedEnvironment(),
    stdio: "ignore",
  });
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once("spawn", resolveSpawn);
    child.once("error", rejectSpawn);
  });
  try {
    const identity = readProcessIdentity(child.pid);
    assert.equal(identity?.pid, child.pid);
    assert.equal(identity?.cwd, REPOSITORY_ROOT);
    assert.match(identity?.startToken ?? "", /^\w{3} \w{3}/u);
    assert.match(identity?.command ?? "", /setTimeout/u);
    assert.ok(Number.isSafeInteger(identity?.processGroupId));
    assert.equal(typeof identity?.sessionId, "string");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolveExit) => child.once("exit", resolveExit));
  }
});

test("supervisor identity accepts only the absolute exact invocation", () => {
  const service = SERVICE_TEMPLATES[0];
  const identity = fixtureIdentity(service);
  assert.equal(validateSupervisorIdentity(service, RUN_ID, identity), true);
  assert.equal(
    validateSupervisorIdentity(service, RUN_ID, {
      ...identity,
      command: identity.command.replace(SUPERVISOR_PATH, "/tmp/foreign.mjs"),
    }),
    false,
  );
  assert.equal(
    validateSupervisorIdentity(service, RUN_ID, {
      ...identity,
      processGroupId: identity.pid + 1,
    }),
    false,
  );
});

test("sanitized child environments defeat forged PATH and debugger injection", () => {
  const environment = sanitizedEnvironment({
    PATH: "/tmp/attacker/bin",
    NODE_OPTIONS: "--inspect=0.0.0.0:9229",
    NODE_PATH: "/tmp/attacker/modules",
    VSCODE_INSPECTOR_OPTIONS: "spoof",
  });
  assert.notEqual(environment.PATH, "/tmp/attacker/bin");
  assert.equal(environment.NODE_OPTIONS, undefined);
  assert.equal(environment.NODE_PATH, undefined);
  assert.equal(environment.VSCODE_INSPECTOR_OPTIONS, undefined);
});

test("v2 records reject socket duplication and identity/asset forgery", () => {
  const service = SERVICE_TEMPLATES[0];
  const record = fixtureRecord(service);
  assert.equal(validatePidRecord(record, service), true);
  assert.equal(
    validatePidRecord({ ...record, startInvocationId: "not-a-uuid" }, service),
    false,
  );
  assert.equal(
    validatePidRecord({ ...record, repositoryRoot: "/tmp/foreign" }, service),
    false,
  );
  assert.equal(
    validatePidRecord({ ...record, socketHolderPids: [42000, 42000] }, service),
    false,
  );
  assert.equal(
    validatePidRecord(
      {
        ...record,
        process: { ...record.process, command: "node foreign.mjs" },
      },
      service,
    ),
    false,
  );
  assert.equal(
    validatePidRecord(
      {
        ...record,
        integrity: {
          ...record.integrity,
          build: { ...record.integrity.build, assets: ["../escape.js"] },
        },
      },
      service,
    ),
    false,
  );
});

test("expected-invocation cleanup requires the same exact four-service lease", () => {
  const invocationId = "22222222-2222-4222-8222-222222222222";
  const records = SERVICE_TEMPLATES.map((service) => fixtureRecord(service));
  assert.deepEqual(selectExpectedCleanupServices(invocationId, records), [
    "game",
    "preview",
    "e2e",
    "static",
  ]);
  expectCode(
    () => selectExpectedCleanupServices(invocationId, records.slice(0, 3)),
    "DEV_EXPECTED_INVOCATION_MISMATCH",
  );
  assert.deepEqual(
    selectExpectedCleanupServices(invocationId, [
      records[0],
      { ...records[1], startInvocationId: RUN_ID },
      undefined,
      records[3],
    ]),
    ["game", "static"],
  );
  expectCode(
    () =>
      selectExpectedCleanupServices(invocationId, [
        records[0],
        { ...records[1], repositoryRoot: "/tmp/foreign" },
        records[2],
        records[3],
      ]),
    "DEV_EXPECTED_INVOCATION_MISMATCH",
  );
});

test("crash-window reconciliation recognizes exact starting listener only", () => {
  const service = SERVICE_TEMPLATES[0];
  const record = fixtureRecord(service, "starting");
  assert.equal(
    classifyV2RuntimeState(service, record, {
      liveProcess: { ...record.process },
      listeners: [listener(service)],
    }),
    "starting-bound",
  );
  assert.equal(
    classifyV2RuntimeState(service, record, {
      liveProcess: undefined,
      listeners: [],
    }),
    "dead",
  );
  expectCode(
    () =>
      classifyV2RuntimeState(service, record, {
        liveProcess: { ...record.process, startToken: "reused" },
        listeners: [listener(service)],
      }),
    "DEV_SOCKET_OWNER_MISMATCH",
  );
});

test("ready-state classification fails closed on extra listener and socket swap", () => {
  const service = SERVICE_TEMPLATES[0];
  const record = fixtureRecord(service);
  assert.equal(
    classifyV2RuntimeState(service, record, {
      liveProcess: { ...record.process },
      listeners: [listener(service)],
    }),
    "ready",
  );
  expectCode(
    () =>
      classifyV2RuntimeState(service, record, {
        liveProcess: { ...record.process },
        listeners: [listener(service), listener(service, 42001)],
      }),
    "DEV_SOCKET_OWNER_MISMATCH",
  );
  expectCode(
    () =>
      classifyV2RuntimeState(service, record, {
        liveProcess: { ...record.process },
        listeners: [listener(service, 42001)],
      }),
    "DEV_SOCKET_OWNER_MISMATCH",
  );
});

test("legacy-v1 migration recognizes only exact npm and child command shapes", () => {
  for (const service of SERVICE_TEMPLATES) {
    const leader = {
      command: `npm run ${service.packageScript} --host ${DEV_HOST} --port ${service.port} --strictPort`,
    };
    const listenerIdentity = {
      command:
        service.kind === "static"
          ? `node scripts/static-server.mjs --host ${DEV_HOST} --port ${service.port} --strictPort`
          : service.kind === "vite-preview"
            ? `node ${REPOSITORY_ROOT}/node_modules/.bin/vite preview --host ${DEV_HOST} --port ${service.port} --strictPort`
            : `node ${REPOSITORY_ROOT}/node_modules/.bin/vite${service.name === "e2e" ? " --mode test" : ""} --host ${DEV_HOST} --port ${service.port} --strictPort`,
    };
    assert.equal(
      legacyCommandsMatchService(service, leader, listenerIdentity),
      true,
    );
    assert.equal(
      legacyCommandsMatchService(service, leader, {
        ...listenerIdentity,
        command: listenerIdentity.command.replace(String(service.port), "5173"),
      }),
      false,
    );
  }
});

test("HTTP readiness requires unique run/service markers and real payloads", () => {
  const service = SERVICE_TEMPLATES[0];
  const record = fixtureRecord(service);
  const check = service.healthChecks[0];
  const response = {
    statusCode: 200,
    headers: {
      [SERVICE_HEADER]: service.serviceId,
      [RUN_HEADER]: RUN_ID,
      "content-type": "text/javascript; charset=utf-8",
    },
    body: "export const createHotContext = () => 'real Vite client';",
  };
  assert.equal(
    validateHealthResponse(service, record, check, response),
    undefined,
  );
  expectCode(
    () =>
      validateHealthResponse(service, record, check, {
        ...response,
        headers: { ...response.headers, [RUN_HEADER]: "spoof" },
      }),
    "DEV_HEALTH_RUN_SPOOF",
  );
  expectCode(
    () =>
      validateHealthResponse(service, record, check, {
        ...response,
        headers: { ...response.headers, [SERVICE_HEADER]: "foreign" },
      }),
    "DEV_HEALTH_SERVICE_SPOOF",
  );
  expectCode(
    () =>
      validateHealthResponse(service, record, check, {
        ...response,
        body: "ok",
      }),
    "DEV_HEALTH_VITE_CLIENT_INVALID",
  );
});

test("static readiness marker binds JSON to the exact run", () => {
  const service = SERVICE_TEMPLATES[3];
  const record = fixtureRecord(service);
  const response = {
    statusCode: 200,
    headers: {
      [SERVICE_HEADER]: service.serviceId,
      [RUN_HEADER]: RUN_ID,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      status: "ready",
      service: service.serviceId,
      runId: RUN_ID,
    }),
  };
  assert.equal(
    validateHealthResponse(service, record, service.healthChecks[0], response),
    undefined,
  );
  expectCode(
    () =>
      validateHealthResponse(service, record, service.healthChecks[0], {
        ...response,
        body: JSON.stringify({
          status: "ready",
          service: service.serviceId,
          runId: "spoof",
        }),
      }),
    "DEV_HEALTH_STATIC_INVALID",
  );
});

test("safe path walking rejects a symlinked .dev root or nested component", async (t) => {
  const sandbox = await mkdtemp(join(REPOSITORY_TMP_ROOT, "btt-dev-path-"));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const realDev = resolve(sandbox, "real-dev");
  const linkedDev = resolve(sandbox, ".dev");
  await mkdir(realDev, { mode: 0o700 });
  await symlink(realDev, linkedDev, "dir");
  expectCode(
    () =>
      assertSafePathComponents(linkedDev, resolve(linkedDev, "logs/a.log"), {
        leafKind: "file",
        allowMissingLeaf: true,
      }),
    "DEV_PATH_SYMLINK_FORBIDDEN",
  );

  const safeDev = resolve(sandbox, "safe-dev");
  const outside = resolve(sandbox, "outside");
  await mkdir(safeDev, { mode: 0o700 });
  await mkdir(outside, { mode: 0o700 });
  await symlink(outside, resolve(safeDev, "logs"), "dir");
  expectCode(
    () =>
      assertSafePathComponents(safeDev, resolve(safeDev, "logs/a.log"), {
        leafKind: "file",
        allowMissingLeaf: true,
      }),
    "DEV_PATH_SYMLINK_FORBIDDEN",
  );
  expectCode(
    () =>
      assertSafeExistingNode(resolve(safeDev, "logs"), { kind: "directory" }),
    "DEV_PATH_SYMLINK_FORBIDDEN",
  );
});

test("build integrity rejects a symlinked dist root", async (t) => {
  const target = await makeBuildFixture(t);
  const parent = await mkdtemp(join(REPOSITORY_TMP_ROOT, "btt-dist-link-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const linked = resolve(parent, "dist");
  await symlink(target, linked, "dir");
  await expectRejectedCode(
    () => inspectBuildIntegrity(linked, { expectedRoot: target }),
    "DEV_BUILD_ROOT_INVALID",
  );
});

test("build fingerprint detects stale files and rejects missing referenced assets", async (t) => {
  const root = await makeBuildFixture(t);
  const expectedRoot = await realpath(root);
  const first = await inspectBuildIntegrity(root, { expectedRoot });
  await writeFile(resolve(root, "assets/main.js"), "console.log('changed');\n");
  const second = await inspectBuildIntegrity(root, { expectedRoot });
  assert.equal(
    integrityEqual(
      { source: fixtureIntegrity().source, build: first },
      { source: fixtureIntegrity().source, build: second },
    ),
    false,
  );
  await unlink(resolve(root, "assets/main.css"));
  await assert.rejects(() => inspectBuildIntegrity(root, { expectedRoot }));
});

test("build integrity rejects symlinked referenced assets", async (t) => {
  const root = await makeBuildFixture(t);
  const expectedRoot = await realpath(root);
  await unlink(resolve(root, "assets/main.css"));
  await symlink(
    resolve(root, "assets/main.js"),
    resolve(root, "assets/main.css"),
  );
  await expectRejectedCode(
    () => inspectBuildIntegrity(root, { expectedRoot }),
    "DEV_DIGEST_SYMLINK_FORBIDDEN",
  );
});

test("static server options cannot bypass loopback, port, identity, or build root", async () => {
  const parsed = parseStaticServerOptions(
    ["--host", STATIC_HOST, "--port", String(STATIC_PORT), "--strictPort"],
    { BTT_SERVICE_ID: STATIC_SERVICE_ID, BTT_SERVICE_RUN_ID: RUN_ID },
  );
  assert.equal(validateStaticServerOptions(parsed), parsed);
  assert.equal(validateHostHeader("127.0.0.1:4143", parsed), true);
  expectCode(
    () => validateHostHeader("attacker.example:4143", parsed),
    "STATIC_HOST_HEADER_INVALID",
  );
  expectCode(
    () =>
      parseStaticServerOptions([
        "--host",
        "0.0.0.0",
        "--port",
        String(STATIC_PORT),
      ]),
    "STATIC_CONFIG_HOST_FORBIDDEN",
  );
  expectCode(
    () => parseStaticServerOptions(["--host", STATIC_HOST, "--port", "8080"]),
    "STATIC_CONFIG_PORT_FORBIDDEN",
  );
  await expectRejectedCode(
    () => startStaticServer({ ...parsed, host: "0.0.0.0" }),
    "STATIC_CONFIG_OPTIONS_INVALID",
  );
  await expectRejectedCode(
    () => startStaticServer({ ...parsed, buildRoot: "/tmp/foreign-dist" }),
    "STATIC_CONFIG_OPTIONS_INVALID",
  );
});

test("static request parsing rejects traversal and supports bounded byte ranges", () => {
  assert.deepEqual(parseRequestPath("/assets/main.js?x=1").segments, [
    "assets",
    "main.js",
  ]);
  expectCode(() => parseRequestPath("/%2e%2e/secret"), "STATIC_PATH_TRAVERSAL");
  expectCode(() => parseRequestPath("/a%2fb"), "STATIC_PATH_SEPARATOR_ENCODED");
  expectCode(
    () => parseRequestPath(`/${"a".repeat(MAX_REQUEST_TARGET_BYTES + 1)}`),
    "STATIC_REQUEST_TARGET_TOO_LONG",
  );
  assert.deepEqual(parseSingleByteRange("bytes=2-4", 10), {
    start: 2,
    end: 4,
    length: 3,
  });
  assert.deepEqual(parseSingleByteRange("bytes=-3", 10), {
    start: 7,
    end: 9,
    length: 3,
  });
  expectCode(
    () => parseSingleByteRange("bytes=20-21", 10),
    "STATIC_RANGE_NOT_SATISFIABLE",
  );
  expectCode(
    () => parseSingleByteRange(["bytes=0-1", "bytes=2-3"], 10),
    "STATIC_RANGE_INVALID",
  );
  assert.equal(
    isPathInsideRoot("/safe/root", "/safe/root/assets/main.js"),
    true,
  );
  assert.equal(isPathInsideRoot("/safe/root", "/safe/escape"), false);
});

test("static file opening binds a regular in-root descriptor and rejects links", async (t) => {
  const root = await makeBuildFixture(t);
  const assetPath = resolve(root, "assets/main.js");
  const opened = await resolveStaticFile(
    root,
    parseRequestPath("/assets/main.js"),
  );
  try {
    assert.equal(
      (await opened.handle.readFile("utf8")).trim(),
      "console.log('built');",
    );
  } finally {
    await opened.handle.close();
  }

  const symlinkPath = resolve(root, "assets/symlink.js");
  await symlink(assetPath, symlinkPath);
  await expectRejectedCode(
    () => resolveStaticFile(root, parseRequestPath("/assets/symlink.js")),
    "STATIC_SYMLINK_FORBIDDEN",
  );
  await unlink(symlinkPath);

  const hardlinkPath = resolve(root, "assets/hardlink.js");
  await link(assetPath, hardlinkPath);
  await expectRejectedCode(
    () => resolveStaticFile(root, parseRequestPath("/assets/hardlink.js")),
    "STATIC_FILE_LINK_COUNT_INVALID",
  );
  await unlink(hardlinkPath);
});
