import { describe, expect, it } from "vitest";

import { getBuildStatus } from "../../src/build-status";
import { renderFoundationStatus } from "../../src/foundation-view";

describe("foundation contract", () => {
  it("keeps the public status honest until every production gate is proven", () => {
    expect(getBuildStatus()).toEqual({
      readiness: "not-yet-in-production",
      visibleLabel: "Not yet in production",
      playable: false,
    });
    expect(getBuildStatus()).toBe(getBuildStatus());
  });

  it("renders the truthful status and fails explicitly without its root", () => {
    const root = { innerHTML: "" };
    renderFoundationStatus(root, getBuildStatus());
    expect(root.innerHTML).toContain("Not yet in production");
    expect(root.innerHTML).toContain("playable rooms are not available yet");
    expect(root.innerHTML).toContain('aria-labelledby="build-status-heading"');
    expect(() => {
      renderFoundationStatus(null, getBuildStatus());
    }).toThrow("APP_ROOT_MISSING: #main-content was not found");
  });
});
