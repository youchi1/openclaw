import { describe, expect, it } from "vitest";
import { shouldRefreshSnapshotForVersion } from "./refresh-state.js";

describe("shouldRefreshSnapshotForVersion", () => {
  it("returns false when both cached and next are 0", () => {
    expect(shouldRefreshSnapshotForVersion(0, 0)).toBe(false);
  });

  it("returns false when both are undefined", () => {
    expect(shouldRefreshSnapshotForVersion(undefined, undefined)).toBe(false);
  });

  it("returns true when next is bumped above cached", () => {
    expect(shouldRefreshSnapshotForVersion(0, 1)).toBe(true);
    expect(shouldRefreshSnapshotForVersion(50, 100)).toBe(true);
  });

  it("returns false when cached matches next", () => {
    expect(shouldRefreshSnapshotForVersion(42, 42)).toBe(false);
  });

  it("returns false when cached is ahead of next", () => {
    expect(shouldRefreshSnapshotForVersion(100, 50)).toBe(false);
  });

  it("returns true when next is 0 but cached is non-zero (reset detection)", () => {
    expect(shouldRefreshSnapshotForVersion(5, 0)).toBe(true);
  });

  it("returns true when cached is undefined and next is non-zero", () => {
    expect(shouldRefreshSnapshotForVersion(undefined, 10)).toBe(true);
  });
});
