import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OwnedProcessError,
  parseMacProcessTable,
  runOwnedProcess,
} from "../../scripts/owned-process-runner.mjs";
import { REPOSITORY_ROOT } from "../../scripts/check-local-state.mjs";

const IGNORE_TERM_DESCENDANT = String.raw`
process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
`;

// A launcher shaped like `dev:up`: it starts a long-lived detached service,
// prints the exact PID it claims to have left behind, then exits cleanly.
const SERVICE_LAUNCHER = String.raw`
const { spawn } = require("node:child_process");
const service = spawn(
  process.execPath,
  ["--input-type=commonjs", "--eval", ${JSON.stringify(IGNORE_TERM_DESCENDANT)}],
  { detached: true, stdio: "ignore" },
);
service.unref();
process.stdout.write("DETACHED_PID=" + String(service.pid) + "\\n");
// Stay alive past several tracking polls so the service is a *tracked*
// descendant when the launcher exits; that is the state a real dev:up reaches
// and the state the declaration has to be judged against.
setTimeout(() => {}, 400);
`;

const HOSTILE_LEADER = String.raw`
const { spawn } = require("node:child_process");
const descendant = spawn(
  process.execPath,
  ["--input-type=commonjs", "--eval", ${JSON.stringify(IGNORE_TERM_DESCENDANT)}],
  { detached: true, stdio: "ignore" },
);
descendant.unref();
process.stdout.write("DETACHED_PID=" + String(descendant.pid) + "\\n");
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});
setInterval(() => {}, 1_000);
`;

async function waitForPidToDisappear(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.fail(`PID ${String(pid)} survived owned process cleanup`);
}

function detachedPid(output) {
  const value = Number.parseInt(
    /DETACHED_PID=(\d+)/u.exec(output)?.[1] ?? "",
    10,
  );
  assert.ok(Number.isSafeInteger(value) && value > 1);
  return value;
}

test("standalone bootstrap and Playwright entrypoints use the owned runner", () => {
  for (const relativePath of [
    "scripts/bootstrap.mjs",
    "scripts/playwright-runner.mjs",
    "scripts/playwright-target.mjs",
  ]) {
    const source = readFileSync(`${REPOSITORY_ROOT}/${relativePath}`, "utf8");
    assert.match(source, /runOwnedProcess/u, relativePath);
    assert.doesNotMatch(source, /\bspawnSync\b/u, relativePath);
    assert.doesNotMatch(source, /\bspawn\s*\(/u, relativePath);
  }
});

test("macOS native snapshots require an explicit non-truncation proof", () => {
  const valid = [
    "41\t1\t41\tL\t1723100000.000041",
    "42\t41\t42\tZ\t1723100000.000042",
    "#complete\tseeds=1\tdiscovered=3\temitted=2\tbatch_capacity=4096",
    "",
  ].join("\n");
  assert.deepEqual(
    parseMacProcessTable(valid, 1).map(({ pid, startToken, state }) => ({
      pid,
      startToken,
      state,
    })),
    [
      { pid: 41, startToken: "1723100000.000041", state: "L" },
      { pid: 42, startToken: "1723100000.000042", state: "Z" },
    ],
  );
  for (const invalid of [
    valid.replace(/^#complete.*$/mu, ""),
    valid.replace("seeds=1", "seeds=2"),
    valid.replace("batch_capacity=4096", "batch_capacity=0"),
    valid.replace("emitted=2", "emitted=1"),
    `${valid}#complete\tseeds=1\tdiscovered=3\temitted=2\tbatch_capacity=4096\n`,
  ]) {
    assert.throws(() => parseMacProcessTable(invalid, 1), /complet/iu);
  }
});

test("owned runner captures output without losing observed cross-stream order", async () => {
  const result = await runOwnedProcess({
    args: [
      "--input-type=commonjs",
      "--eval",
      'process.stdout.write("first\\n");setTimeout(()=>{process.stderr.write("second\\n");process.stdout.write("third\\n")},20)',
    ],
    command: process.execPath,
    cwd: REPOSITORY_ROOT,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    outputMode: "capture",
    timeoutMs: 5_000,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.cleanupProven, true);
  assert.equal(result.stdout, "first\nthird\n");
  assert.equal(result.stderr, "second\n");
  assert.deepEqual(
    result.orderedOutput.map(({ sequence }) => sequence),
    [1, 2, 3],
  );
  assert.deepEqual(
    new Set(
      result.orderedOutput.map(({ stream, text }) => `${stream}:${text}`),
    ),
    new Set(["stdout:first\n", "stderr:second\n", "stdout:third\n"]),
  );
  assert.deepEqual(result.orderedOutput[0], {
    sequence: 1,
    stream: "stdout",
    text: "first\n",
  });
});

test(
  "timeout kills an escaped detached grandchild that ignores TERM and proves cleanup",
  { skip: process.platform === "win32" },
  async () => {
    let failure;
    try {
      await runOwnedProcess({
        args: ["--input-type=commonjs", "--eval", HOSTILE_LEADER],
        command: process.execPath,
        cwd: REPOSITORY_ROOT,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        killVerificationMs: 2_000,
        outputMode: "capture",
        terminationGraceMs: 500,
        timeoutMs: 5_000,
      });
    } catch (error) {
      failure = error;
    }

    assert.ok(failure instanceof OwnedProcessError);
    assert.equal(failure.code, "OWNED_PROCESS_TIMEOUT");
    assert.equal(failure.result.cleanupProven, true);
    assert.equal(failure.result.forcedTermination, true);
    assert.ok(failure.result.trackedDescendantCount >= 1);
    const pid = detachedPid(failure.result.stdout);
    await waitForPidToDisappear(pid);
  },
);

test(
  "a declared surviving service is admitted while an undeclared one is still a leak",
  { skip: process.platform === "win32" },
  async () => {
    const lifecycleOptions = {
      args: ["--input-type=commonjs", "--eval", SERVICE_LAUNCHER],
      command: process.execPath,
      cwd: REPOSITORY_ROOT,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      homeDirectory: ".dev/tmp/lifecycle-home",
      killVerificationMs: 2_000,
      outputMode: "capture",
      terminationGraceMs: 500,
      timeoutMs: 15_000,
    };

    const declared = await runOwnedProcess({
      ...lifecycleOptions,
      declareSurvivingDescendants: ({ stdout }) => [detachedPid(stdout)],
    });
    const survivorPid = detachedPid(declared.stdout);
    assert.equal(declared.cleanupProven, true);
    assert.equal(declared.exitCode, 0);
    assert.deepEqual(declared.declaredSurvivorPids, [survivorPid]);
    assert.ok(
      declared.survivingDescendants.some(
        (entry) => entry.pid === survivorPid && entry.declared === true,
      ),
    );
    // Still alive because it was declared, not because the check was skipped.
    process.kill(survivorPid, 0);
    process.kill(survivorPid, "SIGKILL");
    await waitForPidToDisappear(survivorPid);

    // The same launcher without a declaration is an ordinary leak.
    let undeclaredFailure;
    try {
      await runOwnedProcess(lifecycleOptions);
    } catch (error) {
      undeclaredFailure = error;
    }
    assert.ok(undeclaredFailure instanceof OwnedProcessError);
    assert.equal(
      undeclaredFailure.code,
      "OWNED_PROCESS_DESCENDANTS_AFTER_EXIT",
    );
    await waitForPidToDisappear(detachedPid(undeclaredFailure.result.stdout));

    // A declaration that does not cover the survivor is refused as well.
    let mismatchedFailure;
    try {
      await runOwnedProcess({
        ...lifecycleOptions,
        declareSurvivingDescendants: ({ stdout }) => [
          detachedPid(stdout) + 1_000_000,
        ],
      });
    } catch (error) {
      mismatchedFailure = error;
    }
    assert.ok(mismatchedFailure instanceof OwnedProcessError);
    assert.equal(
      mismatchedFailure.code,
      "OWNED_PROCESS_DESCENDANTS_AFTER_EXIT",
    );
    await waitForPidToDisappear(detachedPid(mismatchedFailure.result.stdout));

    // A throwing declaration fails closed rather than admitting the survivor.
    let throwingFailure;
    try {
      await runOwnedProcess({
        ...lifecycleOptions,
        declareSurvivingDescendants: () => {
          throw new Error("declaration unavailable");
        },
      });
    } catch (error) {
      throwingFailure = error;
    }
    assert.ok(throwingFailure instanceof OwnedProcessError);
    assert.equal(throwingFailure.result.cleanupProven, false);
    await waitForPidToDisappear(detachedPid(throwingFailure.result.stdout));
  },
);

test("declaring survivors without a caller-owned home is refused", async () => {
  await assert.rejects(
    runOwnedProcess({
      args: ["--version"],
      command: process.execPath,
      cwd: REPOSITORY_ROOT,
      declareSurvivingDescendants: () => [2],
      outputMode: "capture",
      timeoutMs: 5_000,
    }),
    { code: "OWNED_PROCESS_SURVIVOR_HOME_REQUIRED" },
  );
  await assert.rejects(
    runOwnedProcess({
      args: ["--version"],
      command: process.execPath,
      cwd: REPOSITORY_ROOT,
      declareSurvivingDescendants: "not-a-function",
      homeDirectory: ".dev/tmp/lifecycle-home",
      outputMode: "capture",
      timeoutMs: 5_000,
    }),
    { code: "OWNED_PROCESS_SURVIVOR_DECLARATION_INVALID" },
  );
});

test(
  "parent SIGTERM is converted into bounded exact-tree cancellation",
  { skip: process.platform === "win32" },
  async () => {
    let signalSent = false;
    let failure;
    try {
      await runOwnedProcess({
        args: ["--input-type=commonjs", "--eval", HOSTILE_LEADER],
        command: process.execPath,
        cwd: REPOSITORY_ROOT,
        env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        killVerificationMs: 2_000,
        onOutput(_stream, output) {
          if (!signalSent && /DETACHED_PID=\d+/u.test(output)) {
            signalSent = true;
            setTimeout(() => process.emit("SIGTERM"), 100);
          }
        },
        outputMode: "capture",
        terminationGraceMs: 500,
        timeoutMs: 8_000,
      });
    } catch (error) {
      failure = error;
    }

    assert.equal(signalSent, true);
    assert.ok(failure instanceof OwnedProcessError);
    assert.equal(failure.code, "OWNED_PROCESS_CANCELLED");
    assert.equal(failure.suggestedExitCode, 143);
    assert.equal(failure.result.cleanupProven, true);
    assert.equal(failure.result.forcedTermination, true);
    const pid = detachedPid(failure.result.stdout);
    await waitForPidToDisappear(pid);
  },
);
