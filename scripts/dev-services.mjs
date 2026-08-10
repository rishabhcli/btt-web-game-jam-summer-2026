#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  ftruncateSync,
  lstatSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { request as httpRequest } from "node:http";

import { OwnedProcessError, runOwnedProcess } from "./owned-process-runner.mjs";

import {
  CACHE_ROOT,
  DEV_HOST,
  DEV_ROOT,
  DIST_ROOT,
  LOG_ROOT,
  NODE_EXECUTABLE,
  PLAYWRIGHT_PROFILE_ROOT,
  RECORD_VERSION,
  REPOSITORY_NAME,
  REPOSITORY_ROOT,
  RESERVED_PORTS,
  RUN_HEADER,
  SERVICES,
  SERVICE_HEADER,
  SUPERVISOR_PATH,
  TMP_ROOT,
  DevRuntimeError,
  assertSafeDevPath,
  assertExactSocketOwnership,
  computeIntegrity,
  createClaimRecord,
  ensureSafeDevLayout,
  gitIgnoreCoversDev,
  inspectBuildIntegrity,
  integrityEqual,
  openSafeAppend,
  parseMacNetstatListeners,
  parsePortsEnv,
  processIdentityEqual,
  readProcessIdentity,
  readRecord,
  readSocketListeners,
  recordPath,
  removeRecord,
  replaceRecord,
  runtimeFail,
  sanitizedEnvironment,
  validateRecord,
  validateSupervisorIdentity,
} from "./dev-service-runtime.mjs";

export {
  DEV_HOST,
  DevRuntimeError as DevServiceError,
  REPOSITORY_NAME,
  REPOSITORY_ROOT,
  RESERVED_PORTS,
  SERVICES as SERVICE_TEMPLATES,
  assertExactSocketOwnership,
  computeIntegrity,
  inspectBuildIntegrity,
  integrityEqual,
  parseMacNetstatListeners,
  parsePortsEnv,
  processIdentityEqual as processIdentityMatches,
  validateRecord as validatePidRecord,
};

const PORTS_FILE = resolve(REPOSITORY_ROOT, "ports.env");
const PACKAGE_FILE = resolve(REPOSITORY_ROOT, "package.json");
const LOCK_FILE = resolve(DEV_ROOT, "lifecycle.lock");
const BUILD_TIMEOUT_MS = 120_000;
const MAX_BUILD_OUTPUT_BYTES = 16 * 1024 * 1024;
const STARTUP_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 60_000;
const HEALTH_REQUEST_TIMEOUT_MS = 10_000;
const HEALTH_CONVERGENCE_TIMEOUT_MS = 60_000;
const HEALTH_RETRY_DELAY_MS = 250;
const MAX_HEALTH_BYTES = 512 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function emitLifecycleResult(result) {
  process.stdout.write(
    `DEV_LIFECYCLE_RESULT ${JSON.stringify({ schemaVersion: "btt.dev-lifecycle/v1", ...result })}\n`,
  );
}

function lifecycleServiceIdentity(service, record, startedByInvocation) {
  return {
    name: service.name,
    serviceId: service.serviceId,
    port: service.port,
    runId: record.runId,
    startInvocationId: record.startInvocationId,
    pid: record.process?.pid ?? null,
    startedByInvocation,
  };
}

export function selectExpectedCleanupServices(
  expectedInvocationId,
  serviceRecords,
) {
  if (
    !UUID_PATTERN.test(expectedInvocationId) ||
    !Array.isArray(serviceRecords) ||
    serviceRecords.length !== SERVICES.length
  ) {
    runtimeFail(
      "DEV_EXPECTED_INVOCATION_MISMATCH",
      "expected cleanup requires one exact record for every service",
    );
  }
  const selected = [];
  for (let index = 0; index < SERVICES.length; index += 1) {
    const service = SERVICES[index];
    const record = serviceRecords[index];
    if (record === undefined) continue;
    if (!validateRecord(record, service)) {
      runtimeFail(
        "DEV_EXPECTED_INVOCATION_MISMATCH",
        `${service.name} has an invalid cleanup record`,
      );
    }
    if (record.startInvocationId === expectedInvocationId) {
      selected.push(service.name);
    }
  }
  return Object.freeze(selected);
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function safeReadJson(path, maximumBytes = 128 * 1024) {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    runtimeFail("DEV_CONFIG_PATH_INVALID", `${path} must be a regular file`);
  }
  if (metadata.size > maximumBytes) {
    runtimeFail("DEV_CONFIG_TOO_LARGE", `${path} exceeds its size limit`);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    runtimeFail("DEV_CONFIG_JSON_INVALID", `${path} is invalid JSON`);
  }
}

async function assertConfiguration() {
  const portsMetadata = await lstat(PORTS_FILE);
  if (portsMetadata.isSymbolicLink() || !portsMetadata.isFile()) {
    runtimeFail("DEV_PORTS_PATH_INVALID", "ports.env must be a regular file");
  }
  parsePortsEnv(await readFile(PORTS_FILE, "utf8"));
  const packageJson = safeReadJson(PACKAGE_FILE);
  const expectedScripts = [
    "build",
    "serve:game",
    "serve:preview",
    "serve:e2e",
    "serve:static",
  ];
  for (const script of expectedScripts) {
    if (
      typeof packageJson.scripts?.[script] !== "string" ||
      packageJson.scripts[script].trim() === ""
    ) {
      runtimeFail(
        "DEV_PACKAGE_COMMAND_MISSING",
        `missing package script ${script}`,
      );
    }
  }
  if (!gitIgnoreCoversDev()) {
    runtimeFail("DEV_DIRECTORY_NOT_IGNORED", ".dev/ must be git-ignored");
  }
}

function lockPayload(command, runId) {
  const owner = readProcessIdentity(process.pid);
  if (!owner)
    runtimeFail("DEV_LOCK_OWNER_INVALID", "cannot identify lock owner");
  return { version: 1, command, runId, owner };
}

async function acquireLifecycleLock(command) {
  await ensureSafeDevLayout();
  const runId = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      assertSafeDevPath(LOCK_FILE, {
        leafKind: "file",
        allowMissingLeaf: true,
      });
      const handle = await open(LOCK_FILE, "wx", 0o600);
      try {
        await handle.writeFile(
          `${JSON.stringify(lockPayload(command, runId), null, 2)}\n`,
          "utf8",
        );
        await handle.sync();
      } finally {
        await handle.close();
      }
      return async () => {
        let current;
        try {
          current = safeReadJson(LOCK_FILE, 32 * 1024);
        } catch (error) {
          if (error?.code === "ENOENT") return;
          throw error;
        }
        if (current.runId !== runId || current.owner?.pid !== process.pid) {
          runtimeFail(
            "DEV_LOCK_OWNERSHIP_LOST",
            "lifecycle lock changed owner",
          );
        }
        assertSafeDevPath(LOCK_FILE, { leafKind: "file" });
        await unlink(LOCK_FILE);
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let existing;
      try {
        existing = safeReadJson(LOCK_FILE, 32 * 1024);
      } catch (readError) {
        runtimeFail(
          "DEV_LOCK_INVALID",
          `lifecycle lock is unsafe: ${readError?.message ?? String(readError)}`,
        );
      }
      const liveOwner = readProcessIdentity(existing.owner?.pid);
      if (processIdentityEqual(existing.owner, liveOwner)) {
        runtimeFail(
          "DEV_LIFECYCLE_BUSY",
          `lifecycle command ${existing.command} is active`,
        );
      }
      assertSafeDevPath(LOCK_FILE, { leafKind: "file" });
      await unlink(LOCK_FILE);
    }
  }
  runtimeFail("DEV_LOCK_FAILED", "could not acquire lifecycle lock");
}

/**
 * Hold the same exclusive lifecycle lock used by up/down for an external
 * consumer (notably Playwright) and expose health validation that runs inside
 * that lease.  The consumer must await all browser work inside `operation`;
 * down cannot begin until the callback settles and the lock is released.
 */
export async function withDevServiceLease(label, operation) {
  if (
    typeof label !== "string" ||
    !/^[a-z0-9][a-z0-9:_-]{0,63}$/u.test(label)
  ) {
    runtimeFail("DEV_LEASE_LABEL_INVALID", "lease label is invalid");
  }
  if (typeof operation !== "function") {
    runtimeFail(
      "DEV_LEASE_OPERATION_INVALID",
      "lease operation must be a function",
    );
  }
  const release = await acquireLifecycleLock(`lease:${label}`);
  try {
    return await operation(
      Object.freeze({
        validatePreflight: runPreflight,
        validateHealth: runHealth,
      }),
    );
  } finally {
    await release();
  }
}

function readLegacyIdentity(stored) {
  const live = readProcessIdentity(stored?.pid);
  if (!live) return { status: "dead" };
  if (
    live.pid !== stored.pid ||
    live.startToken !== stored.startToken ||
    live.command !== stored.command ||
    live.cwd !== stored.cwd ||
    live.cwd !== REPOSITORY_ROOT
  ) {
    return { status: "changed" };
  }
  return { status: "live", identity: live };
}

export function legacyCommandsMatchService(service, leader, listener) {
  const expectedLeader = `npm run ${service.packageScript} --host ${DEV_HOST} --port ${service.port} --strictPort`;
  const expectedListener =
    service.kind === "static"
      ? `node scripts/static-server.mjs --host ${DEV_HOST} --port ${service.port} --strictPort`
      : service.kind === "vite-preview"
        ? `node ${REPOSITORY_ROOT}/node_modules/.bin/vite preview --host ${DEV_HOST} --port ${service.port} --strictPort`
        : `node ${REPOSITORY_ROOT}/node_modules/.bin/vite${service.name === "e2e" ? " --mode test" : ""} --host ${DEV_HOST} --port ${service.port} --strictPort`;
  return (
    leader.command === expectedLeader && listener.command === expectedListener
  );
}

function validateLegacyRecord(service, record) {
  if (
    !record ||
    record.version !== 1 ||
    record.repositoryName !== REPOSITORY_NAME ||
    record.repositoryRoot !== REPOSITORY_ROOT ||
    record.service !== service.name ||
    record.serviceId !== service.serviceId ||
    record.host !== DEV_HOST ||
    record.port !== service.port ||
    record.packageScript !== service.packageScript ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      record.runId ?? "",
    ) ||
    typeof record.startedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(record.startedAt) ||
    record.logPath !== resolve(LOG_ROOT, `${service.name}.log`) ||
    !record.leader ||
    !Array.isArray(record.listeners) ||
    record.listeners.length !== 1 ||
    record.leader.pid === record.listeners[0].pid ||
    !Number.isSafeInteger(record.leader.pid) ||
    record.leader.pid <= 1 ||
    !Number.isSafeInteger(record.listeners[0].pid) ||
    record.listeners[0].pid <= 1 ||
    typeof record.leader.startToken !== "string" ||
    typeof record.listeners[0].startToken !== "string" ||
    record.leader.cwd !== REPOSITORY_ROOT ||
    record.listeners[0].cwd !== REPOSITORY_ROOT ||
    !legacyCommandsMatchService(service, record.leader, record.listeners[0])
  ) {
    return undefined;
  }
  const leaderResult = readLegacyIdentity(record.leader);
  const listenerResult = readLegacyIdentity(record.listeners[0]);
  if (
    leaderResult.status === "changed" ||
    listenerResult.status === "changed"
  ) {
    return undefined;
  }
  const leader = leaderResult.identity;
  const listener = listenerResult.identity;
  if (
    (leader && leader.processGroupId !== leader.pid) ||
    (listener && listener.processGroupId !== record.leader.pid) ||
    (leader && listener && listener.parentPid !== leader.pid) ||
    (leader && listener && listener.sessionId !== leader.sessionId)
  ) {
    return undefined;
  }
  const sockets = readSocketListeners(service.port);
  if (sockets.length > 0) {
    if (!listener) return undefined;
    assertExactSocketOwnership(service, sockets, [listener.pid]);
  } else {
    assertExactSocketOwnership(service, sockets, []);
  }
  return {
    leader,
    listener,
    socketBound: sockets.length > 0,
    allDead: !leader && !listener,
  };
}

function validateLegacyStoppingRecord(service, record) {
  const leader = record?.stoppingIdentity?.leader;
  const listener = record?.stoppingIdentity?.listeners?.[0];
  if (
    record?.version !== 1 ||
    record.legacyStopState !== "stopping" ||
    record.repositoryName !== REPOSITORY_NAME ||
    record.repositoryRoot !== REPOSITORY_ROOT ||
    record.service !== service.name ||
    record.serviceId !== service.serviceId ||
    record.packageScript !== service.packageScript ||
    record.host !== DEV_HOST ||
    record.port !== service.port ||
    !leader ||
    !listener ||
    !legacyCommandsMatchService(service, leader, listener) ||
    listener.parentPid !== leader.pid ||
    leader.processGroupId !== leader.pid ||
    listener.processGroupId !== leader.processGroupId ||
    listener.sessionId !== leader.sessionId
  ) {
    return undefined;
  }
  const liveLeader = readProcessIdentity(leader.pid);
  const liveListener = readProcessIdentity(listener.pid);
  if (liveLeader && !processIdentityEqual(leader, liveLeader)) return undefined;
  if (liveListener && !processIdentityEqual(listener, liveListener))
    return undefined;
  if (liveLeader && liveListener && liveListener.parentPid !== liveLeader.pid) {
    return undefined;
  }
  const sockets = readSocketListeners(service.port);
  assertExactSocketOwnership(
    service,
    sockets,
    sockets.length > 0 && liveListener ? [listener.pid] : [],
  );
  return {
    leader,
    listener,
    liveLeader: liveLeader ? leader : undefined,
    liveListener: liveListener ? listener : undefined,
  };
}

export function classifyV2RuntimeState(
  service,
  record,
  { liveClaimOwner, liveProcess, listeners },
) {
  if (!validateRecord(record, service)) {
    runtimeFail("DEV_RECORD_INVALID", `${service.name} record is invalid`);
  }
  if (record.state === "claiming") {
    assertExactSocketOwnership(service, listeners, []);
    return processIdentityEqual(record.claimOwner, liveClaimOwner)
      ? "claiming"
      : "dead";
  }
  const processAlive =
    processIdentityEqual(record.process, liveProcess) &&
    validateSupervisorIdentity(service, record.runId, liveProcess);
  if (!processAlive) {
    // A reused PID, changed argv/cwd/start token, or surviving socket is
    // foreign.  Never remove the record in that case: the mismatch requires
    // manual inspection rather than a signal based on stale identity data.
    assertExactSocketOwnership(service, listeners, []);
    return "dead";
  }
  if (record.state === "ready") {
    assertExactSocketOwnership(service, listeners, [record.process.pid]);
    return "ready";
  }
  if (listeners.length === 0) {
    assertExactSocketOwnership(service, listeners, []);
    return record.state;
  }
  assertExactSocketOwnership(service, listeners, [record.process.pid]);
  return `${record.state}-bound`;
}

async function assessV2Record(service, record, { removeDead = false } = {}) {
  const liveClaimOwner = record.claimOwner
    ? readProcessIdentity(record.claimOwner.pid)
    : undefined;
  const liveProcess = record.process
    ? readProcessIdentity(record.process.pid)
    : undefined;
  const status = classifyV2RuntimeState(service, record, {
    liveClaimOwner,
    liveProcess,
    listeners: readSocketListeners(service.port),
  });
  if (status === "dead" && removeDead) {
    await removeRecord(service, record.runId);
    return { status: "free" };
  }
  return { status, record, liveProcess };
}

async function inspectService(service, options = {}) {
  const record = await readRecord(service, { allowLegacy: true });
  if (!record) {
    assertExactSocketOwnership(service, readSocketListeners(service.port), []);
    return { status: "free" };
  }
  if (record.version === 1) {
    const legacy = validateLegacyRecord(service, record);
    const stoppingLegacy = legacy
      ? undefined
      : validateLegacyStoppingRecord(service, record);
    if (!legacy && !stoppingLegacy) {
      runtimeFail(
        "DEV_LEGACY_RECORD_INVALID",
        `${service.name} legacy record or socket ownership is invalid`,
      );
    }
    return legacy
      ? {
          status: legacy.allDead
            ? "legacy-dead"
            : legacy.socketBound
              ? "legacy-ready"
              : "legacy-stale",
          record,
          legacy,
        }
      : { status: "legacy-stopping", record, legacy: stoppingLegacy };
  }
  return assessV2Record(service, record, options);
}

async function runPreflight({ removeDead = true } = {}) {
  await ensureSafeDevLayout();
  await assertConfiguration();
  const states = new Map();
  for (const service of SERVICES) {
    const state = await inspectService(service, { removeDead });
    states.set(service.name, state);
    process.stdout.write(
      `preflight ${service.name} ${DEV_HOST}:${service.port}: ${state.status}\n`,
    );
  }
  for (const port of RESERVED_PORTS) {
    const listeners = readSocketListeners(port);
    if (listeners.length > 0) {
      runtimeFail(
        "DEV_FOREIGN_RESERVED_LISTENER",
        `reserved port ${port} is held by ${listeners.map(({ pid }) => pid).join(",")}`,
      );
    }
    process.stdout.write(`preflight reserved ${DEV_HOST}:${port}: free\n`);
  }
  return states;
}

function probeHttp(service, record, check, timeoutMs) {
  return new Promise((resolveProbe, rejectProbe) => {
    const chunks = [];
    let bytes = 0;
    const request = httpRequest(
      {
        host: DEV_HOST,
        port: service.port,
        path: check.path,
        method: "GET",
        agent: false,
        headers: { Accept: "*/*", Connection: "close" },
      },
      (response) => {
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_HEALTH_BYTES) {
            request.destroy(
              new DevRuntimeError(
                "DEV_HEALTH_RESPONSE_TOO_LARGE",
                `${service.name} health response is too large`,
              ),
            );
          } else {
            chunks.push(chunk);
          }
        });
        response.once("end", () =>
          resolveProbe({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.setTimeout(timeoutMs, () =>
      request.destroy(
        new DevRuntimeError(
          "DEV_HEALTH_TIMEOUT",
          `${service.name}${check.path} timed out`,
        ),
      ),
    );
    request.once("error", rejectProbe);
    request.end();
  });
}

export function isRetryableHealthError(error) {
  return (
    error?.code === "DEV_HEALTH_TIMEOUT" ||
    new Set(["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT"]).has(
      error?.code,
    )
  );
}

export function validateHealthResponse(service, record, check, response) {
  if (response.statusCode !== 200) {
    runtimeFail(
      "DEV_HEALTH_STATUS_INVALID",
      `${service.name}${check.path} returned HTTP ${response.statusCode}`,
    );
  }
  if (response.headers[SERVICE_HEADER] !== service.serviceId) {
    runtimeFail(
      "DEV_HEALTH_SERVICE_SPOOF",
      `${service.name} service header mismatch`,
    );
  }
  if (response.headers[RUN_HEADER] !== record.runId) {
    runtimeFail("DEV_HEALTH_RUN_SPOOF", `${service.name} run header mismatch`);
  }
  const contentType = String(response.headers["content-type"] ?? "");
  if (
    check.kind === "vite-client" &&
    (!/javascript|typescript/iu.test(contentType) ||
      !response.body.includes("createHotContext"))
  ) {
    runtimeFail("DEV_HEALTH_VITE_CLIENT_INVALID", "Vite client is not ready");
  }
  if (
    check.kind === "vite-module" &&
    (!/javascript|typescript/iu.test(contentType) || response.body.length < 32)
  ) {
    runtimeFail(
      "DEV_HEALTH_VITE_MODULE_INVALID",
      "entry transform is not ready",
    );
  }
  if (
    check.kind === "game-html" &&
    (!contentType.includes("text/html") ||
      !response.body.includes('name="btt-service" content="game-shell"'))
  ) {
    runtimeFail("DEV_HEALTH_GAME_HTML_INVALID", "game shell is not ready");
  }
  if (check.kind === "static-health") {
    let payload;
    try {
      payload = JSON.parse(response.body);
    } catch {
      runtimeFail("DEV_HEALTH_STATIC_INVALID", "static health is invalid JSON");
    }
    if (
      payload.status !== "ready" ||
      payload.service !== service.serviceId ||
      payload.runId !== record.runId
    ) {
      runtimeFail("DEV_HEALTH_STATIC_INVALID", "static server is not ready");
    }
  }
}

async function assertHealthy(service, record, integrity) {
  const assertRuntimeUnchanged = () => {
    const identity = readProcessIdentity(record.process.pid);
    if (!processIdentityEqual(record.process, identity)) {
      runtimeFail(
        "DEV_HEALTH_PROCESS_CHANGED",
        `${service.name} process changed`,
      );
    }
    assertExactSocketOwnership(service, readSocketListeners(service.port), [
      record.process.pid,
    ]);
    if (!integrityEqual(record.integrity, integrity)) {
      runtimeFail(
        "DEV_HEALTH_INTEGRITY_DRIFT",
        `${service.name} source or build fingerprint drifted`,
      );
    }
  };

  assertRuntimeUnchanged();
  const deadline = Date.now() + HEALTH_CONVERGENCE_TIMEOUT_MS;
  for (const check of service.healthChecks) {
    let lastError;
    while (Date.now() < deadline) {
      try {
        const timeoutMs = Math.max(
          1,
          Math.min(HEALTH_REQUEST_TIMEOUT_MS, deadline - Date.now()),
        );
        validateHealthResponse(
          service,
          record,
          check,
          await probeHttp(service, record, check, timeoutMs),
        );
        lastError = undefined;
        break;
      } catch (error) {
        if (!isRetryableHealthError(error)) throw error;
        lastError = error;
        assertRuntimeUnchanged();
        if (Date.now() < deadline) await sleep(HEALTH_RETRY_DELAY_MS);
      }
    }
    if (lastError) {
      runtimeFail(
        "DEV_HEALTH_CONVERGENCE_TIMEOUT",
        `${service.name}${check.path} did not become ready within ${HEALTH_CONVERGENCE_TIMEOUT_MS}ms (${lastError.code ?? "UNKNOWN"})`,
      );
    }
  }
  assertRuntimeUnchanged();
}

async function assertCurrentIntegrity(expected, code, message) {
  const current = await computeIntegrity();
  if (!integrityEqual(expected, current)) {
    runtimeFail(code, message);
  }
}

async function runHealth() {
  const invocationId = randomUUID();
  const states = await runPreflight({ removeDead: false });
  const integrity = await computeIntegrity();
  for (const service of SERVICES) {
    const state = states.get(service.name);
    if (state.status !== "ready") {
      runtimeFail(
        "DEV_SERVICE_NOT_READY",
        `${service.name} state is ${state.status}, not ready`,
      );
    }
    await assertHealthy(service, state.record, integrity);
    process.stdout.write(
      `health ${service.name}: ready ${service.healthChecks.map(({ path }) => `http://${DEV_HOST}:${service.port}${path}`).join(", ")}\n`,
    );
  }
  const afterIntegrity = await computeIntegrity();
  if (!integrityEqual(integrity, afterIntegrity)) {
    runtimeFail(
      "DEV_HEALTH_INTEGRITY_CHANGED",
      "source or build changed while health was running",
    );
  }
  process.stdout.write("dev health passed: 4/4 exact-owned HTTP services\n");
  emitLifecycleResult({
    command: "health",
    outcome: "PASS",
    invocationId,
    exactOwned: true,
    services: SERVICES.map((service) =>
      lifecycleServiceIdentity(service, states.get(service.name).record, false),
    ),
  });
}

async function runCommandBounded(executable, arguments_, logPath, timeoutMs) {
  let result;
  let runnerError;
  try {
    result = await runOwnedProcess({
      command: executable,
      args: arguments_,
      cwd: REPOSITORY_ROOT,
      env: sanitizedEnvironment({
        npm_config_cache: resolve(CACHE_ROOT, "npm"),
      }),
      outputMode: "capture",
      timeoutMs,
      maxOutputBytes: MAX_BUILD_OUTPUT_BYTES,
    });
  } catch (error) {
    runnerError = error;
    result = error instanceof OwnedProcessError ? error.result : undefined;
  }

  const descriptor = openSafeAppend(logPath);
  try {
    for (const chunk of result?.orderedOutput ?? []) {
      writeSync(descriptor, chunk.text, undefined, "utf8");
    }
    if (runnerError) {
      writeSync(
        descriptor,
        `\nDEV_BUILD_RUNNER_ERROR ${runnerError.code ?? "UNKNOWN"}: ${runnerError.message}\n`,
        undefined,
        "utf8",
      );
    }
  } finally {
    closeSync(descriptor);
  }

  if (runnerError) {
    const code =
      runnerError instanceof OwnedProcessError &&
      runnerError.code === "OWNED_PROCESS_TIMEOUT"
        ? "DEV_BUILD_TIMEOUT"
        : "DEV_BUILD_PROCESS_FAILED";
    runtimeFail(
      code,
      `${executable} failed under the owned process runner (${runnerError.code ?? "UNKNOWN"}); see ${logPath}`,
    );
  }
  if (result.exitCode !== 0) {
    runtimeFail(
      "DEV_BUILD_FAILED",
      `${executable} exited ${result.exitCode ?? result.signal}; see ${logPath}`,
    );
  }
}

async function runBuild() {
  const logPath = resolve(LOG_ROOT, "build.log");
  const descriptor = openSafeAppend(logPath);
  try {
    ftruncateSync(descriptor, 0);
  } finally {
    closeSync(descriptor);
  }
  const tscPath = resolve(REPOSITORY_ROOT, "node_modules/typescript/bin/tsc");
  const vitePath = resolve(REPOSITORY_ROOT, "node_modules/vite/bin/vite.js");
  for (const path of [tscPath, vitePath]) {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      runtimeFail("DEV_BUILD_TOOL_INVALID", `${path} is not a regular file`);
    }
  }
  await runCommandBounded(
    NODE_EXECUTABLE,
    [tscPath, "-b"],
    logPath,
    BUILD_TIMEOUT_MS,
  );
  await runCommandBounded(
    NODE_EXECUTABLE,
    [vitePath, "build"],
    logPath,
    BUILD_TIMEOUT_MS,
  );
  await inspectBuildIntegrity(DIST_ROOT);
}

async function waitForReadyRecord(service, runId) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let lastState;
  do {
    const record = await readRecord(service);
    if (record?.runId !== runId) {
      runtimeFail("DEV_START_CLAIM_LOST", `${service.name} claim changed`);
    }
    lastState = record.state;
    if (record.state === "ready") {
      await assessV2Record(service, record);
      return record;
    }
    if (record.state === "failed") break;
    await sleep(100);
  } while (Date.now() < deadline);
  runtimeFail(
    "DEV_START_TIMEOUT",
    `${service.name} did not become ready; last state ${lastState}`,
  );
}

async function startService(service, integrity, startInvocationId) {
  const runId = randomUUID();
  const claimOwner = readProcessIdentity(process.pid);
  const claim = {
    version: RECORD_VERSION,
    repositoryName: REPOSITORY_NAME,
    repositoryRoot: REPOSITORY_ROOT,
    service: service.name,
    serviceId: service.serviceId,
    host: DEV_HOST,
    port: service.port,
    runId,
    startInvocationId,
    state: "claiming",
    claimOwner,
    socketHolderPids: [],
    integrity,
    createdAt: new Date().toISOString(),
    logPath: resolve(LOG_ROOT, `${service.name}.log`),
  };
  await createClaimRecord(service, claim);
  try {
    const descriptor = openSafeAppend(claim.logPath);
    let child;
    try {
      ftruncateSync(descriptor, 0);
      child = spawn(
        NODE_EXECUTABLE,
        [SUPERVISOR_PATH, "--service", service.name, "--run-id", runId],
        {
          cwd: REPOSITORY_ROOT,
          detached: process.platform !== "win32",
          env: sanitizedEnvironment({
            BTT_DEV_HOST: DEV_HOST,
            BTT_DEV_PORT: String(service.port),
            BTT_SERVICE_ID: service.serviceId,
            BTT_SERVICE_RUN_ID: runId,
            BTT_PLAYWRIGHT_PROFILE_DIR: PLAYWRIGHT_PROFILE_ROOT,
            COMPOSE_PROJECT_NAME: REPOSITORY_NAME,
            npm_config_cache: resolve(CACHE_ROOT, "npm"),
          }),
          stdio: ["ignore", descriptor, descriptor],
        },
      );
    } finally {
      closeSync(descriptor);
    }
    await new Promise((resolveSpawn, rejectSpawn) => {
      child.once("spawn", resolveSpawn);
      child.once("error", rejectSpawn);
    });
    child.unref();
    const record = await waitForReadyRecord(service, runId);
    await assertHealthy(service, record, integrity);
    process.stdout.write(
      `${service.name} ready: pid=${record.process.pid} run=${runId} log=${claim.logPath}\n`,
    );
    return record;
  } catch (error) {
    // Reconcile the current service as well as previously promoted services.
    // This covers launcher death/failure windows after claim, after bind, and
    // before ready-record promotion without discovering or killing by name.
    try {
      const current = await readRecord(service);
      if (current?.runId === runId) {
        await stopService(
          service,
          await assessV2Record(service, current, { removeDead: true }),
        );
      }
    } catch (cleanupError) {
      process.stderr.write(
        `DEV_START_RECONCILE_FAILED: ${service.name}: ${cleanupError?.message ?? String(cleanupError)}\n`,
      );
    }
    throw error;
  }
}

async function waitForStopped(service, identities) {
  const deadline = Date.now() + STOP_TIMEOUT_MS;
  do {
    const alive = identities.filter((identity) =>
      processIdentityEqual(identity, readProcessIdentity(identity.pid)),
    );
    const sockets = readSocketListeners(service.port);
    if (alive.length === 0 && sockets.length === 0) return;
    await sleep(100);
  } while (Date.now() < deadline);
  runtimeFail("DEV_STOP_TIMEOUT", `${service.name} did not stop safely`);
}

export function signalExactIdentity(
  identity,
  signal,
  { readIdentity = readProcessIdentity, sendSignal = process.kill } = {},
) {
  if (signal !== "SIGTERM" && signal !== "SIGINT") {
    runtimeFail("DEV_SIGNAL_INVALID", `unsupported signal ${String(signal)}`);
  }
  const live = readIdentity(identity.pid);
  if (!processIdentityEqual(identity, live)) {
    runtimeFail("DEV_SIGNAL_IDENTITY_CHANGED", `PID ${identity.pid} changed`);
  }
  sendSignal(identity.pid, signal);
  return true;
}

function signalExact(identity, signal) {
  return signalExactIdentity(identity, signal);
}

function signalExactIfAlive(identity, signal) {
  const live = readProcessIdentity(identity.pid);
  if (!live) return false;
  if (!processIdentityEqual(identity, live)) {
    runtimeFail("DEV_SIGNAL_IDENTITY_CHANGED", `PID ${identity.pid} changed`);
  }
  process.kill(identity.pid, signal);
  return true;
}

async function stopLegacyService(service, state) {
  const { leader, listener } = state.legacy;
  if (state.status === "legacy-dead") {
    assertExactSocketOwnership(service, readSocketListeners(service.port), []);
    await removeRecord(service, state.record.runId);
    return;
  }
  if (state.status === "legacy-stopping") {
    if (state.legacy.liveListener) {
      const sockets = readSocketListeners(service.port);
      assertExactSocketOwnership(
        service,
        sockets,
        sockets.length > 0 ? [listener.pid] : [],
      );
      signalExact(listener, "SIGTERM");
    } else {
      assertExactSocketOwnership(
        service,
        readSocketListeners(service.port),
        [],
      );
    }
    if (state.legacy.liveLeader) signalExactIfAlive(leader, "SIGTERM");
    await waitForStopped(service, [listener, leader]);
    await removeRecord(service, state.record.runId);
    return;
  }
  if (!leader || !listener) {
    const sockets = readSocketListeners(service.port);
    assertExactSocketOwnership(
      service,
      sockets,
      sockets.length > 0 && listener ? [listener.pid] : [],
    );
    if (listener) signalExact(listener, "SIGTERM");
    if (leader) signalExactIfAlive(leader, "SIGTERM");
    const identities = [listener, leader].filter(Boolean);
    await waitForStopped(service, identities);
    await removeRecord(service, state.record.runId);
    return;
  }
  // Persist the fully re-read identity, including PGID/session, immediately
  // before signalling. This narrowly upgrades only the live v1 record.
  const upgraded = {
    ...state.record,
    legacyStopState: "stopping",
    stoppingIdentity: { leader, listeners: [listener] },
  };
  const temporaryPath = resolve(
    TMP_ROOT,
    `${service.name}.${randomUUID()}.legacy`,
  );
  assertSafeDevPath(temporaryPath, {
    leafKind: "file",
    allowMissingLeaf: true,
  });
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(upgraded, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  assertSafeDevPath(recordPath(service), { leafKind: "file" });
  await rename(temporaryPath, recordPath(service));
  // Revalidate the complete process/socket/ancestry tuple immediately before
  // the first signal.  The listener is stopped first while its npm ancestry is
  // still exact; the wrapper may then exit naturally before its own signal.
  const immediatelyBeforeSignal = validateLegacyRecord(service, upgraded);
  if (!immediatelyBeforeSignal) {
    runtimeFail(
      "DEV_LEGACY_IDENTITY_CHANGED",
      `${service.name} changed before stop`,
    );
  }
  signalExact(listener, "SIGTERM");
  signalExactIfAlive(leader, "SIGTERM");
  await waitForStopped(service, [listener, leader]);
  await removeRecord(service, state.record.runId);
}

async function stopV2Service(service, state) {
  const record = state.record;
  if (record.state === "claiming") {
    assertExactSocketOwnership(service, readSocketListeners(service.port), []);
    await removeRecord(service, record.runId);
    return;
  }
  const live = readProcessIdentity(record.process.pid);
  if (
    !processIdentityEqual(record.process, live) ||
    !validateSupervisorIdentity(service, record.runId, live)
  ) {
    runtimeFail("DEV_STOP_IDENTITY_CHANGED", `${service.name} process changed`);
  }
  const listeners = readSocketListeners(service.port);
  const holderPids = listeners.length === 0 ? [] : [record.process.pid];
  assertExactSocketOwnership(service, listeners, holderPids);
  const stopping = {
    ...record,
    state: "stopping",
    socketHolderPids: holderPids,
  };
  await replaceRecord(service, stopping, record.runId);
  const signalIdentity = readProcessIdentity(record.process.pid);
  if (
    !processIdentityEqual(record.process, signalIdentity) ||
    !validateSupervisorIdentity(service, record.runId, signalIdentity)
  ) {
    runtimeFail(
      "DEV_STOP_IDENTITY_CHANGED",
      `${service.name} changed before signal`,
    );
  }
  assertExactSocketOwnership(
    service,
    readSocketListeners(service.port),
    holderPids,
  );
  signalExact(record.process, "SIGTERM");
  await waitForStopped(service, [record.process]);
  try {
    await removeRecord(service, record.runId);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function stopService(service, state) {
  if (state.status === "free") return;
  if (
    state.status === "legacy-ready" ||
    state.status === "legacy-stale" ||
    state.status === "legacy-dead" ||
    state.status === "legacy-stopping"
  ) {
    await stopLegacyService(service, state);
    return;
  }
  await stopV2Service(service, state);
}

async function runDown(expectedInvocationId) {
  const selectedStates = new Map();
  let expectedServiceNames;
  if (expectedInvocationId !== undefined) {
    const serviceRecords = [];
    for (const service of SERVICES) {
      serviceRecords.push(await readRecord(service));
    }
    expectedServiceNames = new Set(
      selectExpectedCleanupServices(expectedInvocationId, serviceRecords),
    );
  }
  for (const service of SERVICES) {
    if (expectedServiceNames && !expectedServiceNames.has(service.name)) {
      continue;
    }
    selectedStates.set(
      service.name,
      await inspectService(service, { removeDead: true }),
    );
  }
  const stoppedServices = [];
  for (const service of [...SERVICES].reverse()) {
    const state = selectedStates.get(service.name);
    if (!state) continue;
    if (state.record) {
      stoppedServices.push({
        name: service.name,
        serviceId: service.serviceId,
        port: service.port,
        runId: state.record.runId,
        startInvocationId: state.record.startInvocationId ?? null,
        pid: state.record.process?.pid ?? state.record.leader?.pid ?? null,
      });
    }
    await stopService(service, state);
    process.stdout.write(`${service.name} down\n`);
  }
  emitLifecycleResult({
    command: "down",
    outcome: "PASS",
    expectedInvocationId: expectedInvocationId ?? null,
    exactOwned: true,
    services: stoppedServices.sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
  });
}

async function runUp() {
  const invocationId = randomUUID();
  emitLifecycleResult({
    command: "up",
    outcome: "STARTING",
    invocationId,
    ownership: "pending",
    exactOwned: true,
    services: [],
  });
  const states = await runPreflight();
  let currentIntegrity;
  try {
    currentIntegrity = await computeIntegrity();
  } catch {
    currentIntegrity = undefined;
  }
  const allReusable = currentIntegrity
    ? SERVICES.every((service) => {
        const state = states.get(service.name);
        return (
          state.status === "ready" &&
          integrityEqual(state.record.integrity, currentIntegrity)
        );
      })
    : false;
  if (allReusable) {
    for (const service of SERVICES) {
      await assertHealthy(
        service,
        states.get(service.name).record,
        currentIntegrity,
      );
      process.stdout.write(
        `${service.name} already ready; no duplicate started\n`,
      );
    }
    await assertCurrentIntegrity(
      currentIntegrity,
      "DEV_UP_INTEGRITY_CHANGED",
      "source or build changed while validating reusable services",
    );
    emitLifecycleResult({
      command: "up",
      outcome: "PASS",
      invocationId,
      ownership: "reused",
      exactOwned: true,
      services: SERVICES.map((service) =>
        lifecycleServiceIdentity(
          service,
          states.get(service.name).record,
          false,
        ),
      ),
    });
    return;
  }

  for (const service of [...SERVICES].reverse()) {
    await stopService(service, states.get(service.name));
  }
  await runBuild();
  const integrity = await computeIntegrity();
  const started = [];
  try {
    for (const service of SERVICES) {
      const record = await startService(service, integrity, invocationId);
      started.push({ service, record });
    }
    await assertCurrentIntegrity(
      integrity,
      "DEV_UP_INTEGRITY_CHANGED",
      "source or build changed while services were starting",
    );
  } catch (error) {
    for (const { service } of [...started].reverse()) {
      try {
        await stopService(service, await inspectService(service));
      } catch (rollbackError) {
        process.stderr.write(
          `DEV_UP_ROLLBACK_FAILED: ${service.name}: ${rollbackError?.message ?? String(rollbackError)}\n`,
        );
      }
    }
    throw error;
  }
  emitLifecycleResult({
    command: "up",
    outcome: "PASS",
    invocationId,
    ownership: "started",
    exactOwned: true,
    services: started.map(({ service, record }) =>
      lifecycleServiceIdentity(service, record, true),
    ),
  });
}

async function main() {
  const [command, ...extra] = process.argv.slice(2);
  const expectedInvocationId =
    command === "down" &&
    extra.length === 2 &&
    extra[0] === "--expected-invocation" &&
    UUID_PATTERN.test(extra[1])
      ? extra[1]
      : undefined;
  if (
    !["preflight", "up", "health", "down"].includes(command) ||
    (command === "down"
      ? extra.length > 0 && expectedInvocationId === undefined
      : extra.length > 0)
  ) {
    runtimeFail(
      "DEV_COMMAND_INVALID",
      "usage: dev-services.mjs preflight|up|health|down [--expected-invocation <uuid>]",
    );
  }
  const release = await acquireLifecycleLock(command);
  try {
    if (command === "preflight") await runPreflight();
    else if (command === "up") await runUp();
    else if (command === "health") await runHealth();
    else await runDown(expectedInvocationId);
  } finally {
    await release();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error?.code ?? "DEV_SERVICES_FAILED"}: ${error?.message ?? String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
