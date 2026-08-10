import assert from "node:assert/strict";
import test from "node:test";

import {
  validateViteServiceInvocation,
  VITE_SERVICES,
} from "../../scripts/vite-service.mjs";

test("Vite service allocation is exact and loopback-only", () => {
  assert.deepEqual(VITE_SERVICES, {
    game: {
      port: 4140,
      serviceId: "game-dev",
      viteArguments: [],
    },
    preview: {
      port: 4141,
      serviceId: "production-preview",
      viteArguments: ["preview"],
    },
    e2e: {
      port: 4142,
      serviceId: "browser-history-e2e",
      viteArguments: ["--mode", "test"],
    },
  });
});

test("each service produces only its reserved Vite command", () => {
  assert.deepEqual(validateViteServiceInvocation(["game"], {}), {
    host: "127.0.0.1",
    port: 4140,
    serviceId: "game-dev",
    serviceName: "game",
    viteArguments: ["--host", "127.0.0.1", "--port", "4140", "--strictPort"],
  });
  assert.deepEqual(validateViteServiceInvocation(["preview"], {}), {
    host: "127.0.0.1",
    port: 4141,
    serviceId: "production-preview",
    serviceName: "preview",
    viteArguments: [
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "4141",
      "--strictPort",
    ],
  });
  assert.deepEqual(validateViteServiceInvocation(["e2e"], {}), {
    host: "127.0.0.1",
    port: 4142,
    serviceId: "browser-history-e2e",
    serviceName: "e2e",
    viteArguments: [
      "--mode",
      "test",
      "--host",
      "127.0.0.1",
      "--port",
      "4142",
      "--strictPort",
    ],
  });
});

test("exact launcher arguments are accepted but arbitrary overrides fail closed", () => {
  assert.equal(
    validateViteServiceInvocation(
      ["game", "--host", "127.0.0.1", "--port", "4140", "--strictPort"],
      { BTT_SERVICE_ID: "game-dev" },
    ).port,
    4140,
  );
  for (const invalidArguments of [
    ["game", "--host", "0.0.0.0", "--port", "4140", "--strictPort"],
    ["game", "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
    ["game", "--port", "4140", "--host", "127.0.0.1", "--strictPort"],
    ["game", "--host", "127.0.0.1", "--port", "4140"],
    ["game", "--mode", "test"],
  ]) {
    assert.throws(() => validateViteServiceInvocation(invalidArguments, {}), {
      code: "VITE_SERVICE_ARGUMENTS_INVALID",
    });
  }
});

test("unknown services and mismatched service identities fail closed", () => {
  assert.throws(() => validateViteServiceInvocation([], {}), {
    code: "VITE_SERVICE_INVALID",
  });
  assert.throws(
    () =>
      validateViteServiceInvocation(["e2e"], {
        BTT_SERVICE_ID: "game-dev",
      }),
    { code: "VITE_SERVICE_ID_MISMATCH" },
  );
});
