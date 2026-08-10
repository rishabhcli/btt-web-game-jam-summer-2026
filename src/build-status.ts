export type BuildReadiness = "not-yet-in-production";

export interface BuildStatus {
  readonly readiness: BuildReadiness;
  readonly visibleLabel: "Not yet in production";
  readonly playable: false;
}

const status: BuildStatus = Object.freeze({
  readiness: "not-yet-in-production",
  visibleLabel: "Not yet in production",
  playable: false,
});

export function getBuildStatus(): BuildStatus {
  return status;
}
