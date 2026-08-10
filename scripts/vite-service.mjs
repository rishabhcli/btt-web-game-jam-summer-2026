import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { checkLocalState } from "./check-local-state.mjs";
import { createSafeChildEnvironment } from "./safe-environment.mjs";

export const VITE_SERVICES = Object.freeze({
  game: Object.freeze({
    port: 4140,
    serviceId: "game-dev",
    viteArguments: Object.freeze([]),
  }),
  preview: Object.freeze({
    port: 4141,
    serviceId: "production-preview",
    viteArguments: Object.freeze(["preview"]),
  }),
  e2e: Object.freeze({
    port: 4142,
    serviceId: "browser-history-e2e",
    viteArguments: Object.freeze(["--mode", "test"]),
  }),
});

const HOST = "127.0.0.1";

export class ViteServiceContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ViteServiceContractError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ViteServiceContractError(code, message);
}

export function validateViteServiceInvocation(arguments_, environment) {
  const [serviceName, ...cliArguments] = arguments_;
  const service = VITE_SERVICES[serviceName];
  if (!service) {
    fail(
      "VITE_SERVICE_INVALID",
      "usage: node scripts/vite-service.mjs game|preview|e2e [--host 127.0.0.1 --port <allocated> --strictPort]",
    );
  }

  const exactArguments = [
    "--host",
    HOST,
    "--port",
    String(service.port),
    "--strictPort",
  ];
  if (
    cliArguments.length !== 0 &&
    (cliArguments.length !== exactArguments.length ||
      cliArguments.some((value, index) => value !== exactArguments[index]))
  ) {
    fail(
      "VITE_SERVICE_ARGUMENTS_INVALID",
      `${serviceName} accepts no overrides; the only accepted explicit arguments are ${exactArguments.join(" ")}`,
    );
  }

  const suppliedServiceId = environment["BTT_SERVICE_ID"];
  if (
    suppliedServiceId !== undefined &&
    suppliedServiceId !== service.serviceId
  ) {
    fail(
      "VITE_SERVICE_ID_MISMATCH",
      `${serviceName} requires BTT_SERVICE_ID=${service.serviceId}`,
    );
  }

  return Object.freeze({
    ...service,
    host: HOST,
    serviceName,
    viteArguments: Object.freeze([...service.viteArguments, ...exactArguments]),
  });
}

export async function runViteService(
  arguments_,
  environment,
  {
    spawnProcess = spawn,
    viteCliPath = resolve("node_modules/.bin/vite"),
  } = {},
) {
  checkLocalState();
  const contract = validateViteServiceInvocation(arguments_, environment);
  const childEnvironment = createSafeChildEnvironment(environment, {
    additions: {
      BTT_SERVICE_ID: contract.serviceId,
      TEMP: resolve(".dev/tmp"),
      TMP: resolve(".dev/tmp"),
      TMPDIR: resolve(".dev/tmp"),
      XDG_CACHE_HOME: resolve(".dev/cache"),
    },
  });
  const child = spawnProcess(
    process.execPath,
    [viteCliPath, ...contract.viteArguments],
    {
      cwd: process.cwd(),
      env: childEnvironment,
      stdio: "inherit",
    },
  );

  return await new Promise((resolvePromise, rejectPromise) => {
    let forwardedSignal;
    const forwardSignal = (signal) => {
      forwardedSignal = signal;
      if (!child.killed) child.kill(signal);
    };
    const onSigint = () => forwardSignal("SIGINT");
    const onSigterm = () => forwardSignal("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    const cleanup = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };
    child.once("error", (error) => {
      cleanup();
      rejectPromise(error);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (signal || forwardedSignal) {
        resolvePromise(128 + (signal === "SIGINT" ? 2 : 15));
      } else {
        resolvePromise(code ?? 1);
      }
    });
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  try {
    process.exitCode = await runViteService(process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(
      `${error?.code ?? "VITE_SERVICE_FAILED"}: ${error?.message ?? String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
