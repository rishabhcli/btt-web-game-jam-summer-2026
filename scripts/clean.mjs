import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  REPOSITORY_ROOT,
  checkLocalState,
  validateLocalDirectory,
} from "./check-local-state.mjs";

const generatedPaths = [
  "coverage",
  "dist",
  "playwright-report",
  "test-results",
];
checkLocalState();
for (const path of generatedPaths) {
  validateLocalDirectory(path, { create: false, privateMode: false });
}
await Promise.all(
  generatedPaths.map((path) =>
    rm(resolve(REPOSITORY_ROOT, path), { force: true, recursive: true }),
  ),
);
process.stdout.write(`removed generated paths: ${generatedPaths.join(", ")}\n`);
