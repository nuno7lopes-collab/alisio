import { describe, expect, it } from "vitest";
import {
  compareAlisioVersions,
  isSameAlisioStableFamily,
  parseAlisioVersion,
  shouldWarnOnTouchedVersion,
} from "./version.js";

describe("parseAlisioVersion", () => {
  it("parses stable, correction, and beta forms", () => {
    expect(parseAlisioVersion("2026.3.23")).toEqual({
      major: 2026,
      minor: 3,
      patch: 23,
      revision: null,
      prerelease: null,
    });
    expect(parseAlisioVersion("2026.3.23-1")).toEqual({
      major: 2026,
      minor: 3,
      patch: 23,
      revision: 1,
      prerelease: null,
    });
    expect(parseAlisioVersion("2026.3.23-beta.1")).toEqual({
      major: 2026,
      minor: 3,
      patch: 23,
      revision: null,
      prerelease: ["beta", "1"],
    });
    expect(parseAlisioVersion("v2026.3.23.beta.2")).toEqual({
      major: 2026,
      minor: 3,
      patch: 23,
      revision: null,
      prerelease: ["beta", "2"],
    });
  });

  it("rejects invalid versions", () => {
    expect(parseAlisioVersion("2026.3")).toBeNull();
    expect(parseAlisioVersion("latest")).toBeNull();
  });
});

describe("compareAlisioVersions", () => {
  it("treats correction publishes as newer than the base stable release", () => {
    expect(compareAlisioVersions("2026.3.23", "2026.3.23-1")).toBe(-1);
    expect(compareAlisioVersions("2026.3.23-1", "2026.3.23")).toBe(1);
    expect(compareAlisioVersions("2026.3.23-2", "2026.3.23-1")).toBe(1);
  });

  it("treats stable as newer than beta and compares beta identifiers", () => {
    expect(compareAlisioVersions("2026.3.23", "2026.3.23-beta.1")).toBe(1);
    expect(compareAlisioVersions("2026.3.23-beta.2", "2026.3.23-beta.1")).toBe(1);
    expect(compareAlisioVersions("2026.3.23.beta.1", "2026.3.23-beta.2")).toBe(-1);
  });
});

describe("isSameAlisioStableFamily", () => {
  it("treats same-base stable and correction versions as one family", () => {
    expect(isSameAlisioStableFamily("2026.3.23", "2026.3.23-1")).toBe(true);
    expect(isSameAlisioStableFamily("2026.3.23-1", "2026.3.23-2")).toBe(true);
    expect(isSameAlisioStableFamily("2026.3.23", "2026.3.24")).toBe(false);
    expect(isSameAlisioStableFamily("2026.3.23-beta.1", "2026.3.23")).toBe(false);
  });
});

describe("shouldWarnOnTouchedVersion", () => {
  it("skips same-base stable families", () => {
    expect(shouldWarnOnTouchedVersion("2026.3.23", "2026.3.23-1")).toBe(false);
    expect(shouldWarnOnTouchedVersion("2026.3.23-1", "2026.3.23-2")).toBe(false);
  });

  it("skips same-base correction publishes even when current is a prerelease", () => {
    expect(shouldWarnOnTouchedVersion("2026.3.23-beta.1", "2026.3.23-1")).toBe(false);
  });

  it("skips same-base prerelease configs when current is newer", () => {
    expect(shouldWarnOnTouchedVersion("2026.3.23", "2026.3.23-beta.1")).toBe(false);
  });

  it("warns when the touched config is newer", () => {
    expect(shouldWarnOnTouchedVersion("2026.3.23-beta.1", "2026.3.23")).toBe(true);
    expect(shouldWarnOnTouchedVersion("2026.3.23", "2026.3.24")).toBe(true);
    expect(shouldWarnOnTouchedVersion("2026.3.23", "2027.1.1")).toBe(true);
  });
});
