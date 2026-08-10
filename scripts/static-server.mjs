#!/usr/bin/env node

import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { DIST_ROOT, inspectBuildIntegrity } from "./dev-service-runtime.mjs";

export const STATIC_HOST = "127.0.0.1";
export const STATIC_PORT = 4143;
export const STATIC_SERVICE_ID = "static-bundle";
export const MAX_REQUEST_TARGET_BYTES = 2_048;
export const MAX_STATIC_FILE_BYTES = 64 * 1024 * 1024;

const DEFAULT_BUILD_ROOT = DIST_ROOT;
const REQUEST_TIMEOUT_MS = 5_000;
const SHUTDOWN_TIMEOUT_MS = 3_000;

const MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

export class StaticServerError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.name = "StaticServerError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function readOption(argv, index, optionName) {
  const token = argv[index];
  const equalsPrefix = `${optionName}=`;
  if (token.startsWith(equalsPrefix)) {
    const value = token.slice(equalsPrefix.length);
    if (value.length === 0) {
      throw new StaticServerError(
        "STATIC_CONFIG_VALUE_MISSING",
        500,
        `${optionName} requires a value`,
      );
    }
    return { value, consumed: 1 };
  }
  if (token === optionName) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new StaticServerError(
        "STATIC_CONFIG_VALUE_MISSING",
        500,
        `${optionName} requires a value`,
      );
    }
    return { value, consumed: 2 };
  }
  return undefined;
}

export function parseStaticServerOptions(argv, env = process.env) {
  let host;
  let portText;

  for (let index = 0; index < argv.length;) {
    const token = argv[index];
    const hostOption = readOption(argv, index, "--host");
    if (hostOption) {
      host = hostOption.value;
      index += hostOption.consumed;
      continue;
    }
    const portOption = readOption(argv, index, "--port");
    if (portOption) {
      portText = portOption.value;
      index += portOption.consumed;
      continue;
    }
    if (token === "--strictPort") {
      index += 1;
      continue;
    }
    throw new StaticServerError(
      "STATIC_CONFIG_UNKNOWN_ARGUMENT",
      500,
      `unsupported argument: ${token}`,
    );
  }

  host ??= env.BTT_DEV_HOST ?? env.HOST;
  portText ??= env.BTT_DEV_PORT ?? env.PORT;
  if (host !== STATIC_HOST) {
    throw new StaticServerError(
      "STATIC_CONFIG_HOST_FORBIDDEN",
      500,
      `host must be exactly ${STATIC_HOST}`,
    );
  }

  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port !== STATIC_PORT) {
    throw new StaticServerError(
      "STATIC_CONFIG_PORT_FORBIDDEN",
      500,
      `port must be exactly ${STATIC_PORT}`,
    );
  }

  const serviceId = env.BTT_SERVICE_ID ?? STATIC_SERVICE_ID;
  if (serviceId !== STATIC_SERVICE_ID) {
    throw new StaticServerError(
      "STATIC_CONFIG_SERVICE_ID_INVALID",
      500,
      `BTT_SERVICE_ID must be ${STATIC_SERVICE_ID}`,
    );
  }
  const runId = env.BTT_SERVICE_RUN_ID;
  if (
    runId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      runId,
    )
  ) {
    throw new StaticServerError(
      "STATIC_CONFIG_RUN_ID_INVALID",
      500,
      "BTT_SERVICE_RUN_ID must be a UUID",
    );
  }

  return Object.freeze({
    host,
    port,
    serviceId,
    runId,
    buildRoot: DEFAULT_BUILD_ROOT,
  });
}

export function validateStaticServerOptions(options) {
  if (
    !options ||
    options.host !== STATIC_HOST ||
    options.port !== STATIC_PORT ||
    options.serviceId !== STATIC_SERVICE_ID ||
    (options.runId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        options.runId,
      )) ||
    resolve(options.buildRoot ?? "") !== DEFAULT_BUILD_ROOT
  ) {
    throw new StaticServerError(
      "STATIC_CONFIG_OPTIONS_INVALID",
      500,
      "static server options must use the repository build on 127.0.0.1:4143",
    );
  }
  return options;
}

export function parseRequestPath(rawTarget) {
  if (typeof rawTarget !== "string" || rawTarget.length === 0) {
    throw new StaticServerError(
      "STATIC_REQUEST_TARGET_INVALID",
      400,
      "request target is missing",
    );
  }
  if (Buffer.byteLength(rawTarget, "utf8") > MAX_REQUEST_TARGET_BYTES) {
    throw new StaticServerError(
      "STATIC_REQUEST_TARGET_TOO_LONG",
      414,
      "request target is too long",
    );
  }

  const rawPath = rawTarget.split(/[?#]/u, 1)[0];
  if (!rawPath.startsWith("/")) {
    throw new StaticServerError(
      "STATIC_REQUEST_TARGET_INVALID",
      400,
      "origin-form request target required",
    );
  }
  if (/%(?:2f|5c)/iu.test(rawPath)) {
    throw new StaticServerError(
      "STATIC_PATH_SEPARATOR_ENCODED",
      403,
      "encoded path separators are forbidden",
    );
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new StaticServerError(
      "STATIC_PATH_ENCODING_INVALID",
      400,
      "path encoding is invalid",
    );
  }
  if (decodedPath.includes("\\") || decodedPath.includes("\0")) {
    throw new StaticServerError(
      "STATIC_PATH_CHARACTER_FORBIDDEN",
      403,
      "path contains a forbidden character",
    );
  }

  const segments = decodedPath.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new StaticServerError(
      "STATIC_PATH_TRAVERSAL",
      403,
      "path traversal is forbidden",
    );
  }
  return Object.freeze({
    decodedPath,
    segments: Object.freeze(segments),
    directoryRequest: decodedPath.endsWith("/"),
  });
}

export function isPathInsideRoot(rootPath, candidatePath) {
  const pathFromRoot = relative(rootPath, candidatePath);
  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  );
}

function securityHeaders(serviceId, runId) {
  return {
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-BTT-Service-Id": serviceId,
    ...(runId ? { "X-BTT-Service-Run-Id": runId } : {}),
    "X-Content-Type-Options": "nosniff",
  };
}

function writeJson(
  response,
  statusCode,
  value,
  serviceId,
  runId,
  headOnly = false,
) {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  response.writeHead(statusCode, {
    ...securityHeaders(serviceId, runId),
    "Cache-Control": "no-store",
    "Content-Length": body.byteLength,
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(headOnly ? undefined : body);
}

function writeError(response, error, serviceId, runId, headOnly = false) {
  const knownError =
    error instanceof StaticServerError
      ? error
      : new StaticServerError(
          "STATIC_INTERNAL_ERROR",
          500,
          "static server could not complete the request",
        );
  writeJson(
    response,
    knownError.statusCode,
    { status: "error", code: knownError.code, message: knownError.message },
    serviceId,
    runId,
    headOnly,
  );
}

export function validateHostHeader(hostHeader, options) {
  const expected = `${options.host}:${options.port}`;
  if (hostHeader !== expected) {
    throw new StaticServerError(
      "STATIC_HOST_HEADER_INVALID",
      421,
      `Host must be exactly ${expected}`,
    );
  }
  return true;
}

async function buildIsReady(buildRoot) {
  try {
    await inspectBuildIntegrity(buildRoot);
    return true;
  } catch {
    return false;
  }
}

export async function resolveStaticFile(buildRoot, requestPath) {
  const rootStats = await lstat(buildRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new StaticServerError(
      "STATIC_BUILD_ROOT_INVALID",
      500,
      "build root is not a real directory",
    );
  }
  const rootRealPath = await realpath(buildRoot);
  if (rootRealPath !== buildRoot) {
    throw new StaticServerError(
      "STATIC_BUILD_ROOT_INVALID",
      500,
      "build root resolves through an unexpected path",
    );
  }

  let candidate = buildRoot;
  let candidateStats = rootStats;
  try {
    for (const segment of requestPath.segments) {
      candidate = join(candidate, segment);
      candidateStats = await lstat(candidate);
      if (candidateStats.isSymbolicLink()) {
        throw new StaticServerError(
          "STATIC_SYMLINK_FORBIDDEN",
          403,
          "served paths may not contain symlinks",
        );
      }
    }
    if (candidateStats.isDirectory()) {
      candidate = join(candidate, "index.html");
      candidateStats = await lstat(candidate);
      if (candidateStats.isSymbolicLink()) {
        throw new StaticServerError(
          "STATIC_SYMLINK_FORBIDDEN",
          403,
          "served paths may not contain symlinks",
        );
      }
    }
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      throw new StaticServerError(
        "STATIC_FILE_NOT_FOUND",
        404,
        "file not found",
      );
    }
    throw error;
  }

  if (!isPathInsideRoot(buildRoot, candidate)) {
    throw new StaticServerError(
      "STATIC_PATH_TRAVERSAL",
      403,
      "path traversal is forbidden",
    );
  }

  const candidateRealPath = await realpath(candidate);
  if (!isPathInsideRoot(rootRealPath, candidateRealPath)) {
    throw new StaticServerError(
      "STATIC_SYMLINK_ESCAPE",
      403,
      "file resolves outside the build root",
    );
  }
  if (!candidateStats.isFile()) {
    throw new StaticServerError(
      "STATIC_FILE_NOT_REGULAR",
      404,
      "file not found",
    );
  }
  if (candidateStats.size > MAX_STATIC_FILE_BYTES) {
    throw new StaticServerError(
      "STATIC_FILE_TOO_LARGE",
      413,
      "file exceeds the static-server size limit",
    );
  }
  if (candidateStats.nlink !== 1) {
    throw new StaticServerError(
      "STATIC_FILE_LINK_COUNT_INVALID",
      403,
      "served files may not have additional hard links",
    );
  }

  let handle;
  try {
    handle = await open(
      candidateRealPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const openedStats = await handle.stat();
    const afterOpenStats = await lstat(candidateRealPath);
    const afterOpenRealPath = await realpath(candidateRealPath);
    if (
      !openedStats.isFile() ||
      openedStats.nlink !== 1 ||
      openedStats.dev !== afterOpenStats.dev ||
      openedStats.ino !== afterOpenStats.ino ||
      afterOpenStats.isSymbolicLink() ||
      afterOpenRealPath !== candidateRealPath ||
      !isPathInsideRoot(rootRealPath, afterOpenRealPath)
    ) {
      throw new StaticServerError(
        "STATIC_FILE_IDENTITY_CHANGED",
        403,
        "served file identity changed while it was opened",
      );
    }
    return Object.freeze({
      handle,
      size: openedStats.size,
      contentType:
        MIME_TYPES.get(extname(candidateRealPath).toLowerCase()) ??
        "application/octet-stream",
    });
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (error?.code === "ELOOP") {
      throw new StaticServerError(
        "STATIC_SYMLINK_FORBIDDEN",
        403,
        "served paths may not contain symlinks",
      );
    }
    throw error;
  }
}

export function parseSingleByteRange(rangeHeader, fileSize) {
  if (rangeHeader === undefined) return undefined;
  if (typeof rangeHeader !== "string") {
    throw new StaticServerError(
      "STATIC_RANGE_INVALID",
      416,
      "only one byte range is supported",
    );
  }
  const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader.trim());
  if (!match || (match[1] === "" && match[2] === "")) {
    throw new StaticServerError(
      "STATIC_RANGE_INVALID",
      416,
      "only one byte range is supported",
    );
  }

  let start;
  let end;
  if (match[1] === "") {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new StaticServerError(
        "STATIC_RANGE_INVALID",
        416,
        "byte range is invalid",
      );
    }
    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? fileSize - 1 : Number(match[2]);
  }

  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    throw new StaticServerError(
      "STATIC_RANGE_NOT_SATISFIABLE",
      416,
      "byte range is not satisfiable",
    );
  }
  end = Math.min(end, fileSize - 1);
  return Object.freeze({ start, end, length: end - start + 1 });
}

async function handleRequest(request, response, options) {
  validateHostHeader(request.headers.host, options);
  const method = request.method ?? "";
  const headOnly = method === "HEAD";
  if (method !== "GET" && !headOnly) {
    response.setHeader("Allow", "GET, HEAD");
    throw new StaticServerError(
      "STATIC_METHOD_NOT_ALLOWED",
      405,
      "only GET and HEAD are supported",
    );
  }

  const requestPath = parseRequestPath(request.url);
  if (requestPath.decodedPath === "/__health") {
    const ready = await buildIsReady(options.buildRoot);
    writeJson(
      response,
      ready ? 200 : 503,
      {
        status: ready ? "ready" : "not_ready",
        service: options.serviceId,
        runId: options.runId,
        build: { index: ready ? "present" : "missing_or_invalid" },
      },
      options.serviceId,
      options.runId,
      headOnly,
    );
    return;
  }

  const file = await resolveStaticFile(options.buildRoot, requestPath);
  let range;
  try {
    range = parseSingleByteRange(request.headers.range, file.size);
  } catch (error) {
    await file.handle.close();
    if (error instanceof StaticServerError && error.statusCode === 416) {
      response.setHeader("Content-Range", `bytes */${file.size}`);
    }
    throw error;
  }
  const statusCode = range ? 206 : 200;
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, file.size - 1);
  const contentLength = range?.length ?? file.size;
  let streamStarted = false;
  try {
    response.writeHead(statusCode, {
      ...securityHeaders(options.serviceId, options.runId),
      "Accept-Ranges": "bytes",
      "Cache-Control": file.contentType.startsWith("text/html")
        ? "no-cache"
        : "public, max-age=3600",
      "Content-Length": contentLength,
      "Content-Type": file.contentType,
      ...(range
        ? {
            "Content-Range": `bytes ${range.start}-${range.end}/${file.size}`,
          }
        : {}),
    });
    if (headOnly || file.size === 0) {
      await file.handle.close();
      response.end();
      return;
    }

    await new Promise((resolveStream, rejectStream) => {
      const stream = file.handle.createReadStream({
        start,
        end,
        autoClose: true,
      });
      streamStarted = true;
      const stop = () => stream.destroy();
      request.once("aborted", stop);
      response.once("close", stop);
      stream.once("error", rejectStream);
      stream.once("end", resolveStream);
      stream.once("close", resolveStream);
      stream.pipe(response);
    });
  } catch (error) {
    if (!streamStarted) await file.handle.close().catch(() => undefined);
    throw error;
  }
}

export async function assertBuildReady(buildRoot = DEFAULT_BUILD_ROOT) {
  try {
    await inspectBuildIntegrity(buildRoot);
  } catch (error) {
    throw new StaticServerError(
      "STATIC_BUILD_NOT_READY",
      500,
      `dist, its manifest, index, and referenced assets must be valid: ${error?.message ?? String(error)}`,
    );
  }
}

export async function startStaticServer(options) {
  validateStaticServerOptions(options);
  await assertBuildReady(options.buildRoot);
  const server = createServer(
    { maxHeaderSize: 16 * 1024, requireHostHeader: true },
    (request, response) => {
      handleRequest(request, response, options).catch((error) => {
        if (!response.headersSent) {
          writeError(
            response,
            error,
            options.serviceId,
            options.runId,
            request.method === "HEAD",
          );
        } else {
          response.destroy(error);
        }
      });
    },
  );
  server.headersTimeout = REQUEST_TIMEOUT_MS;
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = 1_000;
  server.maxRequestsPerSocket = 100;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port, options.host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  return server;
}

function log(event, fields = {}) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      service: STATIC_SERVICE_ID,
      pid: process.pid,
      ...fields,
    })}\n`,
  );
}

async function main() {
  let options;
  try {
    options = parseStaticServerOptions(process.argv.slice(2));
    const server = await startStaticServer(options);
    log("static_server.ready", { host: options.host, port: options.port });

    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      log("static_server.shutdown_started", { signal });
      const forced = setTimeout(() => {
        server.closeAllConnections?.();
        log("static_server.shutdown_forced", { signal });
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forced.unref();
      server.close((error) => {
        clearTimeout(forced);
        if (error) {
          process.stderr.write(
            `${JSON.stringify({
              timestamp: new Date().toISOString(),
              event: "static_server.shutdown_failed",
              service: STATIC_SERVICE_ID,
              code: error.code ?? "UNKNOWN",
            })}\n`,
          );
          process.exitCode = 1;
        } else {
          log("static_server.shutdown_complete", { signal });
        }
      });
      server.closeIdleConnections?.();
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    const code = error?.code ?? "STATIC_START_FAILED";
    process.stderr.write(`${code}: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  await main();
}
