import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

test("CI bootstraps before full verification and preserves failure evidence", async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, ".github/workflows/ci.yml"),
    "utf8",
  );

  const bootstrapIndex = workflow.indexOf("run: npm run bootstrap");
  const verifyIndex = workflow.indexOf("run: npm run verify-all");
  const uploadIndex = workflow.indexOf(
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  );
  assert.ok(bootstrapIndex >= 0, "CI must invoke the repository bootstrap");
  assert.ok(verifyIndex > bootstrapIndex, "verification must follow bootstrap");
  assert.ok(
    uploadIndex > verifyIndex,
    "evidence upload must follow verification",
  );

  assert.match(workflow, /^\s*push:\s*$/mu);
  assert.match(workflow, /runs-on: ubuntu-24\.04/u);
  assert.match(workflow, /timeout-minutes: 90/u);
  assert.match(workflow, /25 minutes[\s\S]*48-minute deadline/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/u);
  assert.doesNotMatch(workflow, /cancel-in-progress/u);
});
