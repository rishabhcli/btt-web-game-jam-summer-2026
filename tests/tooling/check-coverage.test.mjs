import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  CoveragePolicyError,
  validateCoveragePolicy,
} from "../../scripts/check-coverage.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const basePolicy = {
  schemaVersion: "btt.coverage-policy/v1",
  minimumInstrumentedFiles: 1,
  minimumInstrumentedStatements: 2,
  minimumInstrumentedFunctions: 1,
  minimumInstrumentedBranches: 0,
  maximumExcludedRuntimeFiles: 1,
  maximumExcludedRuntimeBytes: 128,
  excludedRuntimeSources: {
    "src/main.ts": {
      reason: "Composition root is verified through a real browser test.",
      maxBytes: 128,
    },
  },
};
const baseSummary = {
  total: {
    statements: { total: 2 },
    functions: { total: 1 },
    branches: { total: 0 },
  },
  [resolve(repositoryRoot, "src/build-status.ts")]: {},
};

test("coverage policy accepts a visible nonzero scope and explicit exclusion", () => {
  assert.deepEqual(
    validateCoveragePolicy({
      policy: basePolicy,
      summary: baseSummary,
      repositoryRoot,
      sources: ["src/build-status.ts", "src/main.ts"],
      sourceByteLengths: { "src/build-status.ts": 80, "src/main.ts": 100 },
    }),
    {
      actual: { files: 1, statements: 2, functions: 1, branches: 0 },
      excluded: ["src/main.ts"],
    },
  );
});

test("coverage policy fails zero-scope and newly uninstrumented runtime source", () => {
  assert.throws(
    () =>
      validateCoveragePolicy({
        policy: basePolicy,
        summary: { ...baseSummary, total: { statements: { total: 0 } } },
        repositoryRoot,
        sources: ["src/build-status.ts", "src/main.ts"],
        sourceByteLengths: {
          "src/build-status.ts": 80,
          "src/main.ts": 100,
        },
      }),
    (error) =>
      error instanceof CoveragePolicyError &&
      ["COVERAGE_SUMMARY_INVALID", "COVERAGE_SCOPE_TOO_SMALL"].includes(
        error.code,
      ),
  );
  assert.throws(
    () =>
      validateCoveragePolicy({
        policy: basePolicy,
        summary: baseSummary,
        repositoryRoot,
        sources: ["src/build-status.ts", "src/main.ts", "src/new-authority.ts"],
        sourceByteLengths: {
          "src/build-status.ts": 80,
          "src/main.ts": 100,
          "src/new-authority.ts": 100,
        },
      }),
    { code: "COVERAGE_SOURCE_MISSING" },
  );
  assert.throws(
    () =>
      validateCoveragePolicy({
        policy: basePolicy,
        summary: baseSummary,
        repositoryRoot,
        sources: ["src/build-status.ts", "src/main.ts"],
        sourceByteLengths: {
          "src/build-status.ts": 80,
          "src/main.ts": 129,
        },
      }),
    { code: "COVERAGE_EXCLUSION_BUDGET_EXCEEDED" },
  );
});

test("coverage exclusions cannot expand past the reviewed global cap", () => {
  assert.throws(
    () =>
      validateCoveragePolicy({
        policy: {
          ...basePolicy,
          excludedRuntimeSources: {
            ...basePolicy.excludedRuntimeSources,
            "src/second-entry.ts": {
              reason:
                "A second composition root would require explicit policy review.",
              maxBytes: 64,
            },
          },
        },
        summary: baseSummary,
        repositoryRoot,
        sources: ["src/build-status.ts", "src/main.ts", "src/second-entry.ts"],
        sourceByteLengths: {
          "src/build-status.ts": 80,
          "src/main.ts": 100,
          "src/second-entry.ts": 20,
        },
      }),
    (error) =>
      error instanceof CoveragePolicyError &&
      error.code === "COVERAGE_EXCLUSION_CAP_EXCEEDED",
  );
});
