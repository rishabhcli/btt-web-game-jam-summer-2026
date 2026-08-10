import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import {
  REPOSITORY_ROOT,
  checkLocalState,
  validateLocalDirectory,
} from "./check-local-state.mjs";

const OWNED_PROCESS_ROOT = ".dev/tmp/owned-process";
const MAC_SNAPSHOT_SOURCE = resolve(
  REPOSITORY_ROOT,
  "scripts/owned-process-snapshot.c",
);
const POSIX_PROCESS_TABLE_TIMEOUT_MS = 1_000;
const MAC_PROCESS_TABLE_TIMEOUT_MS = 1_000;
const PROCESS_TABLE_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TERMINATION_GRACE_MS = 3_000;
const DEFAULT_KILL_VERIFICATION_MS = 2_000;
const TRACKING_INTERVAL_MS = 15;
const CLEANUP_POLL_INTERVAL_MS = 25;

function sleep(milliseconds) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds),
  );
}

function isInside(parentPath, candidatePath) {
  const pathFromParent = relative(parentPath, candidatePath);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !pathFromParent.startsWith(sep))
  );
}

function requireRepositoryDirectory(path, label) {
  const absolutePath = resolve(path);
  let canonicalPath;
  let metadata;
  try {
    canonicalPath = realpathSync(absolutePath);
    metadata = lstatSync(canonicalPath);
  } catch (error) {
    throw new OwnedProcessError(
      "OWNED_PROCESS_PATH_INVALID",
      `${label} is not a readable directory: ${error?.message ?? String(error)}`,
    );
  }
  if (!metadata.isDirectory() || !isInside(REPOSITORY_ROOT, canonicalPath)) {
    throw new OwnedProcessError(
      "OWNED_PROCESS_PATH_INVALID",
      `${label} must be a real directory inside the repository`,
    );
  }
  return canonicalPath;
}

function requireExecutable(command) {
  if (typeof command !== "string" || !isAbsolute(command)) {
    throw new OwnedProcessError(
      "OWNED_PROCESS_EXECUTABLE_INVALID",
      "owned commands require an absolute executable path",
    );
  }
  let executable;
  let metadata;
  try {
    executable = realpathSync(command);
    metadata = lstatSync(executable);
  } catch (error) {
    throw new OwnedProcessError(
      "OWNED_PROCESS_EXECUTABLE_INVALID",
      `executable is not a readable file: ${error?.message ?? String(error)}`,
    );
  }
  if (!metadata.isFile()) {
    throw new OwnedProcessError(
      "OWNED_PROCESS_EXECUTABLE_INVALID",
      "owned command executable must resolve to a regular file",
    );
  }
  return executable;
}

function trustedExecutable(candidates) {
  for (const candidate of candidates) {
    try {
      const executable = realpathSync(candidate);
      if (lstatSync(executable).isFile()) return executable;
    } catch {
      // Try the next immutable system location.
    }
  }
  return undefined;
}

const PS_EXECUTABLE =
  process.platform === "win32"
    ? undefined
    : trustedExecutable(["/bin/ps", "/usr/bin/ps"]);
const CLANG_EXECUTABLE =
  process.platform === "darwin"
    ? trustedExecutable(["/usr/bin/clang"])
    : undefined;
let macSnapshotHelperPromise;

function windowsTaskkillExecutable() {
  if (process.platform !== "win32") return undefined;
  const systemRoot = process.env["SystemRoot"];
  if (!systemRoot) return undefined;
  return trustedExecutable([resolve(systemRoot, "System32", "taskkill.exe")]);
}

function exactIdentityEqual(left, right) {
  return Boolean(
    left &&
    right &&
    left.pid === right.pid &&
    left.startToken === right.startToken,
  );
}

function parseProcessTable(output) {
  const processes = [];
  for (const line of output.split(/\r?\n/u)) {
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s*$/u.exec(
        line,
      );
    if (!match) continue;
    processes.push(
      Object.freeze({
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        processGroupId: Number(match[3]),
        sessionId: match[4],
        state: match[5],
        startToken: match[6].replace(/\s+/gu, " "),
      }),
    );
  }
  return processes;
}

export function parseMacProcessTable(output, expectedSeedCount) {
  const processes = [];
  let completion;
  for (const line of output.split(/\r?\n/u)) {
    const completionMatch =
      /^#complete\tseeds=(\d+)\tdiscovered=(\d+)\temitted=(\d+)\tbatch_capacity=(\d+)$/u.exec(
        line,
      );
    if (completionMatch) {
      if (completion) {
        throw new Error(
          "native process snapshot repeated its completion record",
        );
      }
      completion = {
        seeds: Number(completionMatch[1]),
        discovered: Number(completionMatch[2]),
        emitted: Number(completionMatch[3]),
        batchCapacity: Number(completionMatch[4]),
      };
      continue;
    }
    const match = /^(\d+)\t(\d+)\t(\d+)\t([LZ])\t(\d+\.\d+)$/u.exec(line);
    if (!match) continue;
    processes.push(
      Object.freeze({
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        processGroupId: Number(match[3]),
        sessionId: "native",
        state: match[4],
        startToken: match[5],
      }),
    );
  }
  if (
    !completion ||
    !Number.isSafeInteger(completion.seeds) ||
    !Number.isSafeInteger(completion.discovered) ||
    !Number.isSafeInteger(completion.emitted) ||
    !Number.isSafeInteger(completion.batchCapacity) ||
    completion.seeds < 1 ||
    (expectedSeedCount !== undefined &&
      completion.seeds !== expectedSeedCount) ||
    completion.batchCapacity < 1 ||
    completion.emitted !== processes.length ||
    completion.emitted > completion.discovered
  ) {
    throw new Error("native process snapshot completeness proof is invalid");
  }
  return processes;
}

function readLinuxProcessTable() {
  const processes = [];
  for (const entry of readdirSync("/proc", { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
    let source;
    try {
      source = readFileSync(`/proc/${entry.name}/stat`, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ESRCH") continue;
      throw error;
    }
    const match = /^(\d+) \((.*)\) (\S) (.*)$/u.exec(source.trim());
    if (!match) continue;
    const fields = match[4].split(" ");
    const parentPid = Number(fields[0]);
    const processGroupId = Number(fields[1]);
    const sessionId = fields[2];
    const startTimeTicks = fields[18];
    if (
      !Number.isSafeInteger(parentPid) ||
      !Number.isSafeInteger(processGroupId) ||
      typeof sessionId !== "string" ||
      !/^\d+$/u.test(sessionId) ||
      typeof startTimeTicks !== "string" ||
      !/^\d+$/u.test(startTimeTicks)
    ) {
      continue;
    }
    processes.push(
      Object.freeze({
        pid: Number(match[1]),
        parentPid,
        processGroupId,
        sessionId,
        state: match[3],
        startToken: startTimeTicks,
      }),
    );
  }
  return processes;
}

async function ensureMacSnapshotHelper() {
  if (process.platform !== "darwin") return undefined;
  macSnapshotHelperPromise ??= (async () => {
    if (!CLANG_EXECUTABLE) {
      throw new Error("trusted clang executable is unavailable");
    }
    const source = realpathSync(MAC_SNAPSHOT_SOURCE);
    if (!lstatSync(source).isFile() || !isInside(REPOSITORY_ROOT, source)) {
      throw new Error("owned process snapshot source is invalid");
    }
    const candidate = resolve(
      REPOSITORY_ROOT,
      OWNED_PROCESS_ROOT,
      `snapshot-helper-${process.pid}-${randomUUID()}`,
    );
    try {
      await new Promise((resolvePromise, rejectPromise) => {
        let standardError = "";
        let spawnFailure;
        let timedOut = false;
        let interruptedSignal;
        let forceTimer;
        let compiler;
        const signalCompilerGroup = (signal) => {
          if (!Number.isSafeInteger(compiler?.pid) || compiler.pid <= 1) return;
          try {
            process.kill(-compiler.pid, signal);
          } catch (error) {
            if (error?.code !== "ESRCH") spawnFailure ??= error;
          }
        };
        const compilerGroupAlive = () => {
          if (!Number.isSafeInteger(compiler?.pid) || compiler.pid <= 1) {
            return false;
          }
          try {
            process.kill(-compiler.pid, 0);
            return true;
          } catch (error) {
            if (error?.code === "ESRCH") return false;
            spawnFailure ??= error;
            return true;
          }
        };
        const requestStop = (signal) => {
          interruptedSignal ??= signal;
          signalCompilerGroup("SIGTERM");
          forceTimer ??= setTimeout(
            () => signalCompilerGroup("SIGKILL"),
            1_000,
          );
        };
        const onSigint = () => requestStop("SIGINT");
        const onSigterm = () => requestStop("SIGTERM");
        process.on("SIGINT", onSigint);
        process.on("SIGTERM", onSigterm);
        compiler = spawn(
          CLANG_EXECUTABLE,
          ["-O2", "-Wall", "-Wextra", "-Werror", source, "-o", candidate],
          {
            cwd: REPOSITORY_ROOT,
            detached: true,
            env: {
              HOME: resolve(REPOSITORY_ROOT, ".dev/tmp"),
              LANG: "C",
              LC_ALL: "C",
              PATH: "/usr/bin:/bin",
              TMPDIR: resolve(REPOSITORY_ROOT, ".dev/tmp"),
            },
            stdio: ["ignore", "ignore", "pipe"],
            windowsHide: true,
          },
        );
        const timer = setTimeout(() => {
          timedOut = true;
          requestStop("TIMEOUT");
        }, 28_000);
        const hardTimer = setTimeout(() => {
          signalCompilerGroup("SIGKILL");
          process.off("SIGINT", onSigint);
          process.off("SIGTERM", onSigterm);
          compiler.stderr.destroy();
          compiler.unref();
          rejectPromise(
            new Error(
              "snapshot helper compiler exceeded its bounded cleanup deadline",
            ),
          );
        }, 30_000);
        compiler.stderr.setEncoding("utf8");
        compiler.stderr.on("data", (chunk) => {
          standardError += chunk;
          if (Buffer.byteLength(standardError) > 1024 * 1024) {
            requestStop("OUTPUT_LIMIT");
          }
        });
        compiler.once("error", (error) => {
          spawnFailure = error;
        });
        compiler.once("close", async (exitCode) => {
          clearTimeout(timer);
          clearTimeout(hardTimer);
          if (forceTimer) clearTimeout(forceTimer);
          process.off("SIGINT", onSigint);
          process.off("SIGTERM", onSigterm);
          if (compilerGroupAlive()) {
            signalCompilerGroup("SIGTERM");
            await sleep(250);
          }
          if (compilerGroupAlive()) {
            signalCompilerGroup("SIGKILL");
            await sleep(500);
          }
          if (compilerGroupAlive()) {
            spawnFailure ??= new Error(
              "snapshot helper compiler process-group cleanup is unproven",
            );
          }
          if (spawnFailure) rejectPromise(spawnFailure);
          else if (
            interruptedSignal === "SIGINT" ||
            interruptedSignal === "SIGTERM"
          ) {
            rejectPromise(
              new OwnedProcessError(
                "OWNED_PROCESS_CANCELLED",
                `snapshot helper build interrupted by ${interruptedSignal}`,
                { cleanupProven: true, interruptionSignal: interruptedSignal },
              ),
            );
          } else if (timedOut) {
            rejectPromise(new Error("snapshot helper build timed out"));
          } else if (interruptedSignal === "OUTPUT_LIMIT") {
            rejectPromise(
              new Error("snapshot helper build exceeded its output limit"),
            );
          } else if (exitCode !== 0) {
            rejectPromise(
              new Error(
                `snapshot helper build exited ${String(exitCode)}: ${standardError.trim()}`,
              ),
            );
          } else resolvePromise();
        });
      });
    } catch (error) {
      rmSync(candidate, { force: true });
      throw error;
    }
    chmodSync(candidate, 0o700);
    const executable = realpathSync(candidate);
    if (!lstatSync(executable).isFile()) {
      throw new Error("snapshot helper build did not produce a regular file");
    }
    process.once("exit", () => rmSync(candidate, { force: true }));
    return executable;
  })();
  return await macSnapshotHelperPromise;
}

async function runProcessTableProbe(rootPid, trackedPids) {
  if (process.platform === "linux") return readLinuxProcessTable();
  const executable =
    process.platform === "darwin"
      ? await ensureMacSnapshotHelper()
      : PS_EXECUTABLE;
  if (!executable) {
    throw new Error("trusted ps executable is unavailable");
  }
  const sessionField = process.platform === "darwin" ? "sess" : "sid";
  const probeTimeoutMs =
    process.platform === "darwin"
      ? MAC_PROCESS_TABLE_TIMEOUT_MS
      : POSIX_PROCESS_TABLE_TIMEOUT_MS;
  const arguments_ =
    process.platform === "darwin"
      ? [String(rootPid), ...trackedPids.map(String)]
      : ["-eo", `pid=,ppid=,pgid=,${sessionField}=,state=,lstart=`];
  return await new Promise((resolvePromise, rejectPromise) => {
    let output = Buffer.alloc(0);
    let errorOutput = Buffer.alloc(0);
    let timedOut = false;
    let spawnError;
    const child = spawn(executable, arguments_, {
      cwd: REPOSITORY_ROOT,
      env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin", TERM: "dumb" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, probeTimeoutMs);
    child.stdout.on("data", (chunk) => {
      output = Buffer.concat([output, chunk]);
      if (output.byteLength > PROCESS_TABLE_MAX_BYTES) child.kill("SIGKILL");
    });
    child.stderr.on("data", (chunk) => {
      errorOutput = Buffer.concat([errorOutput, chunk]);
      if (errorOutput.byteLength > PROCESS_TABLE_MAX_BYTES) {
        child.kill("SIGKILL");
      }
    });
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (spawnError) {
        rejectPromise(spawnError);
        return;
      }
      if (timedOut) {
        rejectPromise(new Error("trusted process-table probe timed out"));
        return;
      }
      if (
        output.byteLength > PROCESS_TABLE_MAX_BYTES ||
        errorOutput.byteLength > PROCESS_TABLE_MAX_BYTES
      ) {
        rejectPromise(new Error("trusted process-table probe exceeded limit"));
        return;
      }
      if (exitCode !== 0) {
        rejectPromise(
          new Error(
            `trusted process-table probe exited ${String(exitCode)} (${signal ?? "no signal"}): ${errorOutput.toString("utf8").trim()}`,
          ),
        );
        return;
      }
      resolvePromise(
        process.platform === "darwin"
          ? parseMacProcessTable(output.toString("utf8"), arguments_.length)
          : parseProcessTable(output.toString("utf8")),
      );
    });
  });
}

function createScratchEnvironment(sourceEnvironment, scratchDirectory, home) {
  const environment = { ...sourceEnvironment };
  environment["HOME"] = home;
  environment["TEMP"] = scratchDirectory;
  environment["TMP"] = scratchDirectory;
  environment["TMPDIR"] = scratchDirectory;
  environment["XDG_CACHE_HOME"] = resolve(scratchDirectory, "xdg-cache");
  environment["XDG_CONFIG_HOME"] = resolve(scratchDirectory, "xdg-config");
  environment["XDG_DATA_HOME"] = resolve(scratchDirectory, "xdg-data");
  environment["XDG_RUNTIME_DIR"] = resolve(scratchDirectory, "xdg-runtime");
  for (const directory of [
    environment["XDG_CACHE_HOME"],
    environment["XDG_CONFIG_HOME"],
    environment["XDG_DATA_HOME"],
    environment["XDG_RUNTIME_DIR"],
  ]) {
    mkdirSync(directory, { mode: 0o700 });
  }
  return environment;
}

function cancellationSignal(reason) {
  if (reason === "SIGINT" || reason === "SIGTERM") return reason;
  return "ABORT";
}

function interruptionExitCode(signal) {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
}

export class OwnedProcessError extends Error {
  constructor(code, message, result) {
    super(message);
    this.name = "OwnedProcessError";
    this.code = code;
    this.result = result;
    this.suggestedExitCode = result?.interruptionSignal
      ? interruptionExitCode(result.interruptionSignal)
      : 1;
  }
}

function validateOptions(options) {
  if (!options || typeof options !== "object") {
    throw new OwnedProcessError(
      "OWNED_PROCESS_OPTIONS_INVALID",
      "owned process options are required",
    );
  }
  if (
    !Array.isArray(options.args) ||
    options.args.some((argument) => typeof argument !== "string")
  ) {
    throw new OwnedProcessError(
      "OWNED_PROCESS_ARGUMENTS_INVALID",
      "owned process arguments must be an array of strings",
    );
  }
  for (const [name, value] of [
    ["timeoutMs", options.timeoutMs],
    ["maxOutputBytes", options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES],
    [
      "terminationGraceMs",
      options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
    ],
    [
      "killVerificationMs",
      options.killVerificationMs ?? DEFAULT_KILL_VERIFICATION_MS,
    ],
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new OwnedProcessError(
        "OWNED_PROCESS_LIMIT_INVALID",
        `${name} must be a positive safe integer`,
      );
    }
  }
  if (!new Set(["capture", "inherit"]).has(options.outputMode ?? "inherit")) {
    throw new OwnedProcessError(
      "OWNED_PROCESS_OUTPUT_MODE_INVALID",
      "outputMode must be capture or inherit",
    );
  }
  if (options.declareSurvivingDescendants !== undefined) {
    if (typeof options.declareSurvivingDescendants !== "function") {
      throw new OwnedProcessError(
        "OWNED_PROCESS_SURVIVOR_DECLARATION_INVALID",
        "declareSurvivingDescendants must be a function",
      );
    }
    // The run scratch is removed once cleanup is proven, and it holds the
    // child's HOME unless the caller supplies one. A survivor must not be left
    // pointing at a deleted home directory, so the caller has to own it.
    if (typeof options.homeDirectory !== "string") {
      throw new OwnedProcessError(
        "OWNED_PROCESS_SURVIVOR_HOME_REQUIRED",
        "declareSurvivingDescendants requires a caller-owned homeDirectory that outlives the run scratch",
      );
    }
  }
}

/**
 * Run one standalone tool as an exactly owned, bounded process tree.
 *
 * The returned exit code is the command's exit code. Runner failures, timeout,
 * cancellation, output exhaustion, an escaped descendant, or any inability to
 * prove cleanup throw OwnedProcessError instead of being reported as a command
 * exit. All temporary homes and scratch paths are repository-contained.
 */
export async function runOwnedProcess(options) {
  validateOptions(options);
  checkLocalState();
  validateLocalDirectory(OWNED_PROCESS_ROOT, {
    create: true,
    privateMode: true,
  });
  if (process.platform === "darwin") await ensureMacSnapshotHelper();

  const executable = requireExecutable(options.command);
  const cwd = requireRepositoryDirectory(
    options.cwd ?? REPOSITORY_ROOT,
    "owned process cwd",
  );
  const runScratch = mkdtempSync(
    resolve(REPOSITORY_ROOT, OWNED_PROCESS_ROOT, `${randomUUID()}-`),
  );
  let home;
  let environment;
  try {
    if (options.homeDirectory) {
      validateLocalDirectory(options.homeDirectory, {
        create: true,
        privateMode: true,
      });
      home = requireRepositoryDirectory(
        options.homeDirectory,
        "owned process home",
      );
    } else {
      home = resolve(runScratch, "home");
      mkdirSync(home, { mode: 0o700 });
    }
    environment = createScratchEnvironment(options.env ?? {}, runScratch, home);
  } catch (error) {
    rmSync(runScratch, { force: true, recursive: true });
    throw error;
  }
  const outputMode = options.outputMode ?? "inherit";
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const terminationGraceMs = Math.min(
    options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS,
    Math.max(100, Math.floor(options.timeoutMs / 4)),
  );
  const killVerificationMs = Math.min(
    options.killVerificationMs ?? DEFAULT_KILL_VERIFICATION_MS,
    Math.max(100, Math.floor(options.timeoutMs / 4)),
  );
  const executionTimeoutMs =
    options.timeoutMs - terminationGraceMs - killVerificationMs;
  if (executionTimeoutMs < 100) {
    rmSync(runScratch, { force: true, recursive: true });
    throw new OwnedProcessError(
      "OWNED_PROCESS_LIMIT_INVALID",
      "timeoutMs must leave at least 100ms before TERM and KILL cleanup reserves",
    );
  }

  let child;
  try {
    child = spawn(executable, options.args, {
      cwd,
      detached: true,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    rmSync(runScratch, { force: true, recursive: true });
    throw new OwnedProcessError(
      "OWNED_PROCESS_SPAWN_FAILED",
      `owned command could not start: ${error?.message ?? String(error)}`,
    );
  }

  const rootPid = child.pid;
  if (!Number.isSafeInteger(rootPid) || rootPid <= 1) {
    child.kill("SIGKILL");
    rmSync(runScratch, { force: true, recursive: true });
    throw new OwnedProcessError(
      "OWNED_PROCESS_PID_INVALID",
      "owned command did not receive a valid process identifier",
    );
  }

  const startedAt = Date.now();
  const hardDeadline = startedAt + options.timeoutMs;
  const executionDeadline = startedAt + executionTimeoutMs;
  let closeResult;
  let spawnError;
  let totalOutputBytes = 0;
  let outputSequence = 0;
  let outputLimitExceeded = false;
  let stdout = "";
  let stderr = "";
  const orderedOutput = [];
  let settleOutcome;
  const firstOutcome = new Promise((resolvePromise) => {
    settleOutcome = resolvePromise;
  });
  let outcomeSelected = false;
  const chooseOutcome = (outcome) => {
    if (outcomeSelected) return;
    outcomeSelected = true;
    settleOutcome(outcome);
  };

  const observe = (stream, chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalOutputBytes += buffer.byteLength;
    if (totalOutputBytes > maxOutputBytes) {
      if (!outputLimitExceeded) {
        outputLimitExceeded = true;
        chooseOutcome({ kind: "output-limit" });
      }
      return;
    }
    const text = buffer.toString("utf8");
    outputSequence += 1;
    if (outputMode === "capture") {
      if (stream === "stdout") stdout += text;
      else stderr += text;
      orderedOutput.push(
        Object.freeze({ sequence: outputSequence, stream, text }),
      );
    } else if (stream === "stdout") {
      process.stdout.write(buffer);
    } else {
      process.stderr.write(buffer);
    }
    options.onOutput?.(stream, text, outputSequence);
  };

  child.stdout.on("data", (chunk) => observe("stdout", chunk));
  child.stderr.on("data", (chunk) => observe("stderr", chunk));
  child.once("error", (error) => {
    spawnError = error;
    chooseOutcome({ kind: "spawn-error", error });
  });
  child.once("close", (exitCode, signal) => {
    closeResult = { exitCode, signal };
    chooseOutcome({ kind: "close" });
  });

  const trackedDescendants = new Map();
  let rootIdentity;
  let lastSnapshot = [];
  let trackingFailure;
  let stopTracking = false;
  let refreshChain = Promise.resolve();

  const updateTrackedProcesses = (snapshot) => {
    const byPid = new Map(snapshot.map((identity) => [identity.pid, identity]));
    const currentRoot = byPid.get(rootPid);
    if (!rootIdentity && currentRoot) rootIdentity = currentRoot;

    const ownedCurrentPids = new Set();
    if (exactIdentityEqual(rootIdentity, currentRoot))
      ownedCurrentPids.add(rootPid);
    for (const [pid, expected] of trackedDescendants) {
      if (exactIdentityEqual(expected, byPid.get(pid)))
        ownedCurrentPids.add(pid);
    }

    let foundAnother = true;
    while (foundAnother) {
      foundAnother = false;
      for (const identity of snapshot) {
        if (identity.pid === rootPid || ownedCurrentPids.has(identity.pid)) {
          continue;
        }
        if (
          identity.processGroupId === rootPid ||
          ownedCurrentPids.has(identity.parentPid)
        ) {
          trackedDescendants.set(identity.pid, identity);
          ownedCurrentPids.add(identity.pid);
          foundAnother = true;
        }
      }
    }
    lastSnapshot = snapshot;
    return snapshot;
  };

  const refreshTrackedProcesses = async () => {
    if (process.platform === "win32") return [];
    const operation = refreshChain.then(async () =>
      updateTrackedProcesses(
        await runProcessTableProbe(rootPid, [...trackedDescendants.keys()]),
      ),
    );
    refreshChain = operation.catch(() => undefined);
    return await operation;
  };

  const trackingLoop = (async () => {
    if (process.platform === "win32") return;
    while (!stopTracking) {
      try {
        await refreshTrackedProcesses();
      } catch (error) {
        trackingFailure = error;
        chooseOutcome({ kind: "tracking-failure", error });
        return;
      }
      if (!stopTracking) await sleep(TRACKING_INTERVAL_MS);
    }
  })();

  let interruptionSignal;
  let forceKillRequested = false;
  const onParentSignal = (signal) => {
    if (interruptionSignal) {
      forceKillRequested = true;
      return;
    }
    interruptionSignal = signal;
    chooseOutcome({ kind: "cancel", signal });
  };
  const onSigint = () => onParentSignal("SIGINT");
  const onSigterm = () => onParentSignal("SIGTERM");
  const onAbort = () =>
    onParentSignal(cancellationSignal(options.abortSignal?.reason));
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  if (options.abortSignal) {
    if (options.abortSignal.aborted) onAbort();
    else options.abortSignal.addEventListener("abort", onAbort, { once: true });
  }

  const executionTimer = setTimeout(
    () => chooseOutcome({ kind: "timeout" }),
    Math.max(1, executionDeadline - Date.now()),
  );

  const liveOwnedProcesses = (snapshot) => {
    if (process.platform === "win32") {
      return closeResult ? [] : [{ pid: rootPid, state: "unknown" }];
    }
    const byPid = new Map(snapshot.map((identity) => [identity.pid, identity]));
    const live = [];
    const currentRoot = byPid.get(rootPid);
    if (
      exactIdentityEqual(rootIdentity, currentRoot) &&
      !currentRoot.state.startsWith("Z")
    ) {
      live.push(currentRoot);
    }
    for (const [pid, expected] of trackedDescendants) {
      const current = byPid.get(pid);
      if (
        exactIdentityEqual(expected, current) &&
        !current.state.startsWith("Z")
      ) {
        live.push(current);
      }
    }
    return live;
  };

  const signalPosixTree = async (signal) => {
    let snapshot;
    try {
      snapshot = await refreshTrackedProcesses();
    } catch (error) {
      trackingFailure ??= error;
      snapshot = lastSnapshot;
    }
    const byPid = new Map(snapshot.map((identity) => [identity.pid, identity]));
    const currentRoot = byPid.get(rootPid);
    if (
      exactIdentityEqual(rootIdentity, currentRoot) ||
      (!rootIdentity && !closeResult)
    ) {
      try {
        process.kill(-rootPid, signal);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    const exactLiveDescendants = [...trackedDescendants.entries()]
      .filter(([pid, expected]) => exactIdentityEqual(expected, byPid.get(pid)))
      .map(([, identity]) => identity)
      .sort((left, right) => right.pid - left.pid);
    for (const identity of exactLiveDescendants) {
      try {
        process.kill(identity.pid, signal);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
  };

  const signalWindowsTree = async (signal) => {
    const taskkill = windowsTaskkillExecutable();
    if (!taskkill)
      throw new Error("trusted taskkill executable is unavailable");
    const arguments_ = ["/PID", String(rootPid), "/T"];
    if (signal === "SIGKILL") arguments_.push("/F");
    await new Promise((resolvePromise, rejectPromise) => {
      let spawnFailure;
      const killer = spawn(taskkill, arguments_, {
        cwd,
        env: {
          PATH: dirname(taskkill),
          SystemRoot: process.env["SystemRoot"],
        },
        stdio: "ignore",
        windowsHide: true,
      });
      const timer = setTimeout(() => killer.kill(), 2_000);
      killer.once("error", (error) => {
        spawnFailure = error;
      });
      killer.once("close", (exitCode) => {
        clearTimeout(timer);
        if (spawnFailure) rejectPromise(spawnFailure);
        else if (exitCode === 0 || closeResult) resolvePromise();
        else rejectPromise(new Error(`taskkill exited ${String(exitCode)}`));
      });
    });
  };

  const signalTree = async (signal) => {
    if (process.platform === "win32") await signalWindowsTree(signal);
    else await signalPosixTree(signal);
  };

  const waitForCleanupProof = async (deadline, stopOnForcedRequest = false) => {
    while (Date.now() < deadline) {
      if (stopOnForcedRequest && forceKillRequested) return false;
      if (process.platform === "win32") {
        if (closeResult) return true;
      } else {
        const requiredProbeBudget =
          (process.platform === "darwin"
            ? MAC_PROCESS_TABLE_TIMEOUT_MS
            : POSIX_PROCESS_TABLE_TIMEOUT_MS) + CLEANUP_POLL_INTERVAL_MS;
        if (deadline - Date.now() < requiredProbeBudget) return false;
        let snapshot;
        try {
          snapshot = await refreshTrackedProcesses();
        } catch (error) {
          trackingFailure ??= error;
          return false;
        }
        if (closeResult && liveOwnedProcesses(snapshot).length === 0)
          return true;
      }
      await sleep(CLEANUP_POLL_INTERVAL_MS);
    }
    return false;
  };

  // A lifecycle command such as `dev:up` exists in order to leave services
  // running, so "no descendant survived" is the wrong contract for it. The
  // caller instead declares, from the command's own machine-readable output,
  // the exact process identities it claims to have left behind. Anything alive
  // that is not one of those identities — or a live descendant of one — is
  // still a leak, is still refused, and is still terminated. A declaration that
  // is absent, malformed, empty, or that fails to cover every survivor fails
  // closed, so this can only ever narrow what is tolerated, never widen it.
  let declaredSurvivorPids = null;
  let survivingDescendants = null;
  const admitDeclaredSurvivors = async (live, draft) => {
    if (typeof options.declareSurvivingDescendants !== "function") return false;
    let declared;
    try {
      declared = await options.declareSurvivingDescendants(
        Object.freeze(draft),
      );
    } catch (error) {
      trackingFailure ??= error;
      return false;
    }
    if (
      !Array.isArray(declared) ||
      declared.length === 0 ||
      declared.some(
        (pid) => !Number.isSafeInteger(pid) || pid <= 1 || pid === rootPid,
      )
    ) {
      return false;
    }
    declaredSurvivorPids = Object.freeze(
      [...new Set(declared)].sort((a, b) => a - b),
    );

    const liveByPid = new Map(live.map((identity) => [identity.pid, identity]));
    const permitted = new Set(
      declaredSurvivorPids.filter((pid) => liveByPid.has(pid)),
    );
    if (permitted.size !== declaredSurvivorPids.length) return false;
    let grew = true;
    while (grew) {
      grew = false;
      for (const identity of live) {
        if (permitted.has(identity.pid)) continue;
        if (
          permitted.has(identity.parentPid) ||
          permitted.has(identity.processGroupId)
        ) {
          permitted.add(identity.pid);
          grew = true;
        }
      }
    }
    if (live.some((identity) => !permitted.has(identity.pid))) return false;
    survivingDescendants = Object.freeze(
      live
        .map((identity) =>
          Object.freeze({
            pid: identity.pid,
            parentPid: identity.parentPid,
            processGroupId: identity.processGroupId,
            declared: declaredSurvivorPids.includes(identity.pid),
          }),
        )
        .sort((left, right) => left.pid - right.pid),
    );
    return true;
  };

  let outcome;
  let cleanupProven = false;
  let forcedTermination = false;
  let terminationError;
  try {
    outcome = await firstOutcome;
    clearTimeout(executionTimer);
    stopTracking = true;
    await trackingLoop;

    if (outcome.kind === "close" && process.platform !== "win32") {
      try {
        const snapshot = await refreshTrackedProcesses();
        const live = liveOwnedProcesses(snapshot);
        if (!rootIdentity) {
          const error = new Error(
            "owned process leader exited before an exact identity was captured",
          );
          trackingFailure ??= error;
          outcome = { kind: "tracking-failure", error };
        } else if (live.length === 0) {
          cleanupProven = true;
        } else if (
          await admitDeclaredSurvivors(live, {
            exitCode: closeResult?.exitCode ?? null,
            orderedOutput,
            signal: closeResult?.signal ?? null,
            stderr,
            stdout,
          })
        ) {
          cleanupProven = true;
        } else outcome = { kind: "descendants-after-exit" };
      } catch (error) {
        trackingFailure ??= error;
        outcome = { kind: "tracking-failure", error };
      }
    } else if (outcome.kind === "close") {
      cleanupProven = true;
    }

    if (!cleanupProven) {
      try {
        await signalTree("SIGTERM");
      } catch (error) {
        terminationError ??= error;
      }
      const terminationDeadline = Math.min(
        hardDeadline - killVerificationMs,
        Date.now() + terminationGraceMs,
      );
      cleanupProven = await waitForCleanupProof(terminationDeadline, true);
      if (!cleanupProven) {
        forcedTermination = true;
        try {
          await signalTree("SIGKILL");
        } catch (error) {
          terminationError ??= error;
        }
        cleanupProven = await waitForCleanupProof(hardDeadline);
      }
    }
  } finally {
    clearTimeout(executionTimer);
    stopTracking = true;
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    options.abortSignal?.removeEventListener("abort", onAbort);
    await trackingLoop;
  }

  if (trackingFailure) cleanupProven = false;

  const result = Object.freeze({
    cleanupProven,
    declaredSurvivorPids,
    errorCode: spawnError?.code ?? null,
    exitCode: closeResult?.exitCode ?? null,
    forcedTermination,
    interruptionSignal: interruptionSignal ?? null,
    orderedOutput: Object.freeze(orderedOutput),
    outputLimitExceeded,
    survivingDescendants,
    processTreeScope:
      process.platform === "win32"
        ? "windows-taskkill-tree"
        : "dedicated-posix-process-group-plus-exact-descendants",
    scratchDirectory: runScratch,
    signal: closeResult?.signal ?? null,
    stderr,
    stdout,
    timedOut: outcome.kind === "timeout",
    totalOutputBytes,
    trackedDescendantCount: trackedDescendants.size,
    trackingError: trackingFailure?.code ?? trackingFailure?.message ?? null,
  });

  if (!cleanupProven) {
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  }
  if (cleanupProven) {
    try {
      rmSync(runScratch, { force: true, recursive: true });
    } catch (error) {
      throw new OwnedProcessError(
        "OWNED_PROCESS_SCRATCH_CLEANUP_FAILED",
        `owned process scratch could not be removed: ${error?.message ?? String(error)}`,
        result,
      );
    }
  }

  if (!cleanupProven || terminationError) {
    throw new OwnedProcessError(
      "OWNED_PROCESS_CLEANUP_UNPROVEN",
      `owned process-tree cleanup could not be proven${terminationError ? `: ${terminationError.message}` : ""}`,
      result,
    );
  }
  if (outcome.kind === "spawn-error") {
    throw new OwnedProcessError(
      "OWNED_PROCESS_SPAWN_FAILED",
      `owned command failed to spawn: ${outcome.error?.message ?? String(outcome.error)}`,
      result,
    );
  }
  if (outcome.kind === "tracking-failure") {
    throw new OwnedProcessError(
      "OWNED_PROCESS_TRACKING_FAILED",
      `owned process tracking failed: ${outcome.error?.message ?? String(outcome.error)}`,
      result,
    );
  }
  if (outcome.kind === "timeout") {
    throw new OwnedProcessError(
      "OWNED_PROCESS_TIMEOUT",
      `owned command exceeded its ${String(options.timeoutMs)}ms overall deadline`,
      result,
    );
  }
  if (outcome.kind === "cancel") {
    throw new OwnedProcessError(
      "OWNED_PROCESS_CANCELLED",
      `owned command was interrupted by ${outcome.signal}`,
      result,
    );
  }
  if (outcome.kind === "output-limit") {
    throw new OwnedProcessError(
      "OWNED_PROCESS_OUTPUT_LIMIT",
      `owned command exceeded ${String(maxOutputBytes)} output bytes`,
      result,
    );
  }
  if (outcome.kind === "descendants-after-exit") {
    throw new OwnedProcessError(
      "OWNED_PROCESS_DESCENDANTS_AFTER_EXIT",
      "owned command exited while descendants were still alive; they were terminated",
      result,
    );
  }
  return result;
}
