import type { BuildStatus } from "./build-status";

export interface FoundationRoot {
  innerHTML: string;
}

export function renderFoundationStatus(
  root: FoundationRoot | null,
  status: BuildStatus,
): void {
  if (!root) {
    throw new Error("APP_ROOT_MISSING: #main-content was not found");
  }
  root.innerHTML = `
    <p class="eyebrow">BTT Web Game Jam — engineering status</p>
    <h1>The playable rooms are not available yet.</h1>
    <p class="explanation">This build exposes the repository's verified development foundation only. It does not claim a working game or production release.</p>
    <section class="status" aria-labelledby="build-status-heading">
      <h2 id="build-status-heading">Current build status</h2>
      <p data-testid="readiness-status">${status.visibleLabel}</p>
    </section>
  `;
}
