#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEV_HOST,
  REPOSITORY_ROOT,
  RUN_HEADER,
  SERVICE_BY_NAME,
  SERVICE_HEADER,
  assertExactSocketOwnership,
  computeIntegrity,
  ensureSafeDevLayout,
  integrityEqual,
  processIdentityEqual,
  readProcessIdentity,
  readRecord,
  readSocketListeners,
  removeRecord,
  replaceRecord,
  runtimeFail,
  sanitizedEnvironment,
  validateSupervisorIdentity,
} from "./dev-service-runtime.mjs";
import {
  parseStaticServerOptions,
  startStaticServer,
} from "./static-server.mjs";

const SOCKET_DISCOVERY_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

function parseInvocation(argv) {
  if (argv.length !== 4 || argv[0] !== "--service" || argv[2] !== "--run-id") {
    runtimeFail(
      "DEV_SUPERVISOR_ARGUMENTS_INVALID",
      "usage: dev-service-supervisor.mjs --service <name> --run-id <uuid>",
    );
  }
  const service = SERVICE_BY_NAME.get(argv[1]);
  if (!service) {
    runtimeFail("DEV_SUPERVISOR_SERVICE_INVALID", `unknown service ${argv[1]}`);
  }
  const runId = argv[3];
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      runId,
    )
  ) {
    runtimeFail("DEV_SUPERVISOR_RUN_ID_INVALID", "run id is invalid");
  }
  return { service, runId };
}

function log(event, service, runId, details = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      service: service.name,
      serviceId: service.serviceId,
      runId,
      pid: process.pid,
      ...details,
    })}\n`,
  );
}

function runtimeHeadersPlugin(service, runId) {
  const applyHeaders = (_request, response, next) => {
    response.setHeader(SERVICE_HEADER, service.serviceId);
    response.setHeader(RUN_HEADER, runId);
    next();
  };
  return {
    name: "btt-supervisor-runtime-identity",
    configureServer(server) {
      server.middlewares.use(applyHeaders);
    },
    configurePreviewServer(server) {
      server.middlewares.use(applyHeaders);
    },
  };
}

async function startVite(service, runId) {
  const { createServer, preview } = await import("vite");
  const shared = {
    configFile: resolve(REPOSITORY_ROOT, "vite.config.ts"),
    mode: service.mode,
    plugins: [runtimeHeadersPlugin(service, runId)],
  };
  if (service.kind === "vite-preview") {
    const server = await preview({
      ...shared,
      preview: { host: DEV_HOST, port: service.port, strictPort: true },
    });
    return {
      address: () => server.httpServer.address(),
      close: () => server.close(),
    };
  }
  const server = await createServer({
    ...shared,
    server: { host: DEV_HOST, port: service.port, strictPort: true },
  });
  await server.listen();
  return {
    address: () => server.httpServer?.address(),
    close: () => server.close(),
  };
}

async function startStatic(service, runId) {
  const environment = {
    BTT_DEV_HOST: DEV_HOST,
    BTT_DEV_PORT: String(service.port),
    BTT_SERVICE_ID: service.serviceId,
    BTT_SERVICE_RUN_ID: runId,
  };
  const options = {
    ...parseStaticServerOptions(
      ["--host", DEV_HOST, "--port", String(service.port), "--strictPort"],
      environment,
    ),
    runId,
  };
  const server = await startStaticServer(options);
  return {
    address: () => server.address(),
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
        server.closeIdleConnections?.();
      }),
  };
}

async function waitForExactSocket(service, expectedPids) {
  const deadline = Date.now() + SOCKET_DISCOVERY_TIMEOUT_MS;
  let lastError;
  do {
    try {
      const listeners = readSocketListeners(service.port);
      assertExactSocketOwnership(service, listeners, expectedPids);
      return listeners;
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  } while (Date.now() < deadline);
  runtimeFail(
    "DEV_SUPERVISOR_SOCKET_TIMEOUT",
    `${service.name} socket ownership did not converge: ${lastError?.message ?? "unknown"}`,
  );
}

async function closeBounded(server) {
  if (!server) return;
  let timer;
  await Promise.race([
    Promise.resolve(server.close()),
    new Promise((_, rejectTimeout) => {
      timer = setTimeout(
        () =>
          rejectTimeout(
            new Error(`shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms`),
          ),
        SHUTDOWN_TIMEOUT_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function runSupervisor(argv) {
  const { service, runId } = parseInvocation(argv);
  for (const key of [
    "NODE_OPTIONS",
    "NODE_INSPECT_RESUME_ON_START",
    "VSCODE_INSPECTOR_OPTIONS",
  ]) {
    if (process.env[key]) {
      runtimeFail(
        "DEV_SUPERVISOR_ENVIRONMENT_UNSAFE",
        `${key} must not reach the supervisor`,
      );
    }
  }
  const safeEnvironment = sanitizedEnvironment({
    BTT_DEV_HOST: DEV_HOST,
    BTT_DEV_PORT: String(service.port),
    BTT_SERVICE_ID: service.serviceId,
    BTT_SERVICE_RUN_ID: runId,
  });
  for (const key of Object.keys(process.env)) {
    if (!(key in safeEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, safeEnvironment);
  await ensureSafeDevLayout();
  const claim = await readRecord(service);
  if (!claim || claim.state !== "claiming" || claim.runId !== runId) {
    runtimeFail("DEV_SUPERVISOR_CLAIM_MISSING", "matching claim is required");
  }
  const identity = readProcessIdentity(process.pid);
  if (!validateSupervisorIdentity(service, runId, identity)) {
    runtimeFail(
      "DEV_SUPERVISOR_IDENTITY_INVALID",
      "supervisor process identity does not match its invocation",
    );
  }

  let record = {
    ...claim,
    state: "starting",
    claimOwner: undefined,
    process: identity,
    socketHolderPids: [],
  };
  delete record.claimOwner;
  await replaceRecord(service, record, runId);

  let server;
  let shutdownRequested = false;
  let requestedReason = "shutdown";
  let requestedExitCode = 0;
  let shutdownPromise;
  let forcedExitTimer;
  const shutdown = async (reason, exitCode = 0) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownRequested = true;
    forcedExitTimer ??= setTimeout(() => {
      process.stderr.write(
        `DEV_SUPERVISOR_FORCED_EXIT: ${service.name} exceeded the bounded shutdown deadline\n`,
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS + 2_000);
    shutdownPromise = (async () => {
      let shutdownError;
      let recordWasMarkedStopping = false;
      try {
        const current = await readRecord(service);
        if (current?.runId !== runId) {
          runtimeFail(
            "DEV_SUPERVISOR_RECORD_OWNERSHIP_LOST",
            "matching record disappeared during shutdown",
          );
        }
        record = { ...current, state: "stopping" };
        await replaceRecord(service, record, runId);
        recordWasMarkedStopping = true;
      } catch (error) {
        shutdownError = error;
      }
      try {
        await closeBounded(server);
      } catch (error) {
        shutdownError ??= error;
      }
      try {
        await waitForExactSocket(service, []);
      } catch (error) {
        shutdownError ??= error;
      }
      if (recordWasMarkedStopping && !shutdownError) {
        try {
          await removeRecord(service, runId);
        } catch (error) {
          shutdownError ??= error;
        }
      }
      if (!shutdownError) {
        clearTimeout(forcedExitTimer);
        log("dev_service.stopped", service, runId, { reason });
      } else {
        process.stderr.write(
          `DEV_SUPERVISOR_SHUTDOWN_FAILED: ${shutdownError?.message ?? String(shutdownError)}\n`,
        );
        exitCode = 1;
      }
      process.exitCode = exitCode;
    })();
    return shutdownPromise;
  };
  const requestShutdown = (reason, exitCode = 0) => {
    shutdownRequested = true;
    requestedReason = reason;
    requestedExitCode = exitCode;
    forcedExitTimer ??= setTimeout(() => {
      process.stderr.write(
        `DEV_SUPERVISOR_FORCED_EXIT: ${service.name} did not finish startup shutdown\n`,
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS + 2_000);
    // If binding is still in progress, the continuation below performs the
    // close.  Removing the claim before that continuation would create an
    // unrecorded listener if the bind completes after the signal.
    if (server) void shutdown(reason, exitCode);
  };
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));
  process.once("SIGINT", () => requestShutdown("SIGINT", 130));

  try {
    server =
      service.kind === "static"
        ? await startStatic(service, runId)
        : await startVite(service, runId);
    const address = server.address();
    if (
      !address ||
      typeof address === "string" ||
      address.address !== DEV_HOST ||
      address.port !== service.port
    ) {
      runtimeFail(
        "DEV_SUPERVISOR_BOUND_ADDRESS_INVALID",
        `${service.name} bound an unexpected address`,
      );
    }
    if (shutdownRequested) {
      await shutdown(requestedReason, requestedExitCode);
      return;
    }
    await waitForExactSocket(service, [process.pid]);
    const liveIntegrity = await computeIntegrity();
    if (!integrityEqual(claim.integrity, liveIntegrity)) {
      runtimeFail(
        "DEV_SUPERVISOR_INTEGRITY_DRIFT",
        "source or build changed during startup",
      );
    }
    const promotionIdentity = readProcessIdentity(process.pid);
    if (
      !processIdentityEqual(identity, promotionIdentity) ||
      !validateSupervisorIdentity(service, runId, promotionIdentity)
    ) {
      runtimeFail(
        "DEV_SUPERVISOR_IDENTITY_CHANGED",
        "supervisor identity changed before readiness promotion",
      );
    }
    await waitForExactSocket(service, [process.pid]);
    record = {
      ...record,
      state: "ready",
      socketHolderPids: [process.pid],
      integrity: liveIntegrity,
    };
    await replaceRecord(service, record, runId);
    log("dev_service.ready", service, runId, {
      host: DEV_HOST,
      port: service.port,
      sourceDigest: liveIntegrity.source.digest,
      buildDigest: liveIntegrity.build.digest,
    });
  } catch (error) {
    process.stderr.write(
      `${error?.code ?? "DEV_SUPERVISOR_START_FAILED"}: ${error?.message ?? String(error)}\n`,
    );
    await shutdown("startup-failure", 1);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  await runSupervisor(process.argv.slice(2));
}
