import process from "node:process";
import { delimiter, dirname } from "node:path";

const BASE_KEYS = Object.freeze([
  "CI",
  "GITHUB_ACTIONS",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
]);

const NETWORK_KEYS = Object.freeze([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);

// Additions are code-owned configuration, not a second copy channel for the
// caller environment. Keep this list exact so a future launcher must review a
// new child capability instead of forwarding credentials or loader hooks by
// accident.
const ADDITION_KEYS = new Set([
  "BTT_SERVICE_ID",
  "FORCE_COLOR",
  "NO_COLOR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "XDG_CACHE_HOME",
  "npm_config_cache",
  "npm_config_dangerously_allow_all_scripts",
  "npm_config_ignore_scripts",
  "npm_config_strict_allow_scripts",
  "npm_config_userconfig",
]);

export class SafeEnvironmentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SafeEnvironmentError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new SafeEnvironmentError(code, message);
}

function trustedPath(sourceEnvironment) {
  const directories = [dirname(process.execPath)];
  if (process.platform === "win32") {
    const systemRoot = sourceEnvironment?.["SystemRoot"];
    if (systemRoot) directories.push(`${systemRoot}\\System32`);
  } else {
    directories.push("/usr/bin", "/bin", "/usr/sbin", "/sbin");
  }
  return [...new Set(directories)].join(delimiter);
}

export function createSafeChildEnvironment(
  sourceEnvironment,
  { additions = {}, network = false } = {},
) {
  const environment = {};
  for (const key of [
    ...BASE_KEYS,
    ...(network ? NETWORK_KEYS : []),
    ...(process.platform === "win32"
      ? ["ComSpec", "PATHEXT", "SystemRoot"]
      : []),
  ]) {
    const value = sourceEnvironment?.[key];
    if (typeof value === "string" && value.length > 0) {
      environment[key] = value;
    }
  }
  environment.PATH = trustedPath(sourceEnvironment);
  for (const [key, value] of Object.entries(additions)) {
    if (!ADDITION_KEYS.has(key)) {
      fail(
        "SAFE_ENV_ADDITION_REJECTED",
        `${key} is not an approved code-owned child-environment addition`,
      );
    }
    if (typeof value !== "string" || value.length === 0) {
      fail(
        "SAFE_ENV_ADDITION_VALUE_INVALID",
        `${key} must be a non-empty string`,
      );
    }
    environment[key] = value;
  }
  return environment;
}
