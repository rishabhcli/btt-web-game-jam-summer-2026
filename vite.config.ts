import { defineConfig, type ResolvedConfig } from "vite";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repositoryRoot = realpathSync(
  fileURLToPath(new URL(".", import.meta.url)),
);
const deniedServerPaths = [
  ".env",
  ".env.*",
  "*.{crt,pem}",
  "**/.git/**",
  "**/.dev/**",
  "**/coverage/**",
  "**/evidence/runs/**",
  "**/playwright-report/**",
  "**/test-results/**",
] as const;
const ignoredWatchPaths = [
  "**/.dev/**",
  "**/coverage/**",
  "**/dist/**",
  "**/evidence/runs/**",
  "**/playwright-report/**",
  "**/test-results/**",
] as const;

const servicePorts = {
  "browser-history-e2e": 4142,
  "game-dev": 4140,
  "production-preview": 4141,
} as const;
const browserEnvironmentPrefix = "BTT_BROWSER_PUBLIC_";
const approvedBrowserEnvironmentKeys = new Set<string>();

type ServiceId = keyof typeof servicePorts;

function isServiceId(value: string | undefined): value is ServiceId {
  return value !== undefined && Object.hasOwn(servicePorts, value);
}

function assertResolvedServiceConfig(
  config: ResolvedConfig,
  serviceId: ServiceId,
  isPreview: boolean,
): void {
  const expectedServiceId = isPreview ? "production-preview" : serviceId;
  if (serviceId !== expectedServiceId) {
    throw new Error(
      `VITE_SERVICE_MODE_MISMATCH: preview=${String(isPreview)} cannot use ${serviceId}`,
    );
  }
  const options = isPreview ? config.preview : config.server;
  const serviceHeader = options.headers["X-BTT-Service-Id"];
  const hostAllowlistIsLoopbackOnly =
    Array.isArray(options.allowedHosts) &&
    options.allowedHosts.length > 0 &&
    options.allowedHosts.every((host) => host === "127.0.0.1");
  const fileBoundaryIsExact =
    config.root === repositoryRoot &&
    config.server.fs.strict === true &&
    config.server.fs.allow.length === 1 &&
    config.server.fs.allow[0] === repositoryRoot &&
    deniedServerPaths.every((pattern) =>
      config.server.fs.deny.includes(pattern),
    );
  const ignoredPaths = config.server.watch?.ignored;
  const watchBoundaryIsExact =
    Array.isArray(ignoredPaths) &&
    ignoredWatchPaths.every((pattern) => ignoredPaths.includes(pattern));
  if (
    options.host !== "127.0.0.1" ||
    options.port !== servicePorts[serviceId] ||
    !options.strictPort ||
    options.cors !== false ||
    !hostAllowlistIsLoopbackOnly ||
    !fileBoundaryIsExact ||
    !watchBoundaryIsExact ||
    serviceHeader !== serviceId
  ) {
    const observed = JSON.stringify({
      allowedHosts: options.allowedHosts,
      cors: options.cors,
      host: options.host,
      port: options.port,
      fileBoundaryIsExact,
      serviceHeader,
      strictPort: options.strictPort,
      watchBoundaryIsExact,
    });
    throw new Error(
      `VITE_SERVICE_CONFIGURATION_INVALID: ${serviceId} must bind only 127.0.0.1:${String(servicePorts[serviceId])} with strictPort and its identity header; observed=${observed}`,
    );
  }
}

export default defineConfig(({ command, isPreview = false }) => {
  const unapprovedBrowserEnvironmentKeys = Object.keys(process.env)
    .filter(
      (key) =>
        key.startsWith(browserEnvironmentPrefix) &&
        !approvedBrowserEnvironmentKeys.has(key),
    )
    .sort();
  if (unapprovedBrowserEnvironmentKeys.length > 0) {
    throw new Error(
      `VITE_BROWSER_ENV_UNAPPROVED: no browser runtime configuration is approved; remove ${unapprovedBrowserEnvironmentKeys.join(", ")}`,
    );
  }
  const serviceId = process.env["BTT_SERVICE_ID"];
  if (serviceId !== undefined && !isServiceId(serviceId)) {
    throw new Error(
      `VITE_SERVICE_ID_INVALID: unsupported BTT_SERVICE_ID ${JSON.stringify(serviceId)}`,
    );
  }
  if (command === "serve" && !isServiceId(serviceId)) {
    throw new Error(
      "VITE_SERVICE_ID_REQUIRED: Vite servers must start through an allocated serve:* command",
    );
  }
  if (
    command === "serve" &&
    ((isPreview && serviceId !== "production-preview") ||
      (!isPreview && serviceId === "production-preview"))
  ) {
    throw new Error(
      `VITE_SERVICE_MODE_MISMATCH: preview=${String(isPreview)} cannot use ${String(serviceId)}`,
    );
  }
  const headers =
    serviceId === undefined ? {} : { "X-BTT-Service-Id": serviceId };
  const serverPort =
    serviceId === "browser-history-e2e" ? 4142 : servicePorts["game-dev"];

  return {
    // No runtime configuration is approved for the browser bundle yet. Vite's
    // conventional VITE_* channel is deliberately disabled, and repository
    // .env files are never an implicit source. A reviewed public value must use
    // this project-specific prefix and be added with its consumer.
    envDir: false,
    envPrefix: browserEnvironmentPrefix,
    plugins:
      command === "serve" && isServiceId(serviceId)
        ? [
            {
              name: "reserved-service-contract",
              configResolved(config: ResolvedConfig) {
                assertResolvedServiceConfig(config, serviceId, isPreview);
              },
            },
          ]
        : [],
    server: {
      allowedHosts: ["127.0.0.1"],
      cors: false,
      host: "127.0.0.1",
      port: serverPort,
      strictPort: true,
      headers,
      fs: {
        allow: [repositoryRoot],
        deny: [...deniedServerPaths],
        strict: true,
      },
      watch: { ignored: [...ignoredWatchPaths] },
    },
    preview: {
      allowedHosts: ["127.0.0.1"],
      cors: false,
      host: "127.0.0.1",
      port: 4141,
      strictPort: true,
      headers,
    },
    build: {
      target: "es2022",
      sourcemap: true,
      manifest: true,
    },
  };
});
