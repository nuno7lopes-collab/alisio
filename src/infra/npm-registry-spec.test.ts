import { describe, expect, it } from "vitest";
import {
  formatPrereleaseResolutionError,
  isExactSemverVersion,
  isPrereleaseSemverVersion,
  isPrereleaseResolutionAllowed,
  parseRegistryNpmSpec,
  validateRegistryNpmSpec,
} from "./npm-registry-spec.js";

function parseSpecOrThrow(spec: string) {
  const parsed = parseRegistryNpmSpec(spec);
  expect(parsed).not.toBeNull();
  return parsed!;
}

describe("npm registry spec validation", () => {
  it.each([
    "@alisio/voice-call",
    "@alisio/voice-call@1.2.3",
    "@alisio/voice-call@1.2.3-beta.4",
    "@alisio/voice-call@latest",
    "@alisio/voice-call@beta",
  ])("accepts %s", (spec) => {
    expect(validateRegistryNpmSpec(spec)).toBeNull();
  });

  it.each([
    {
      spec: "@alisio/voice-call@^1.2.3",
      expected: "exact version or dist-tag",
    },
    {
      spec: "@alisio/voice-call@~1.2.3",
      expected: "exact version or dist-tag",
    },
    {
      spec: "https://npmjs.org/pkg.tgz",
      expected: "URLs are not allowed",
    },
    {
      spec: "git+ssh://github.com/alisio/alisio",
      expected: "URLs are not allowed",
    },
    {
      spec: "@alisio/voice-call@",
      expected: "missing version/tag after @",
    },
    {
      spec: "@alisio/voice-call@../beta",
      expected: "invalid version/tag",
    },
  ])("rejects %s", ({ spec, expected }) => {
    expect(validateRegistryNpmSpec(spec)).toContain(expected);
  });
});

describe("npm registry spec parsing helpers", () => {
  it.each([
    {
      spec: "@alisio/voice-call",
      expected: {
        name: "@alisio/voice-call",
        raw: "@alisio/voice-call",
        selectorKind: "none",
        selectorIsPrerelease: false,
      },
    },
    {
      spec: "@alisio/voice-call@beta",
      expected: {
        name: "@alisio/voice-call",
        raw: "@alisio/voice-call@beta",
        selector: "beta",
        selectorKind: "tag",
        selectorIsPrerelease: false,
      },
    },
    {
      spec: "@alisio/voice-call@1.2.3-beta.1",
      expected: {
        name: "@alisio/voice-call",
        raw: "@alisio/voice-call@1.2.3-beta.1",
        selector: "1.2.3-beta.1",
        selectorKind: "exact-version",
        selectorIsPrerelease: true,
      },
    },
  ])("parses %s", ({ spec, expected }) => {
    expect(parseRegistryNpmSpec(spec)).toEqual(expected);
  });

  it.each([
    { value: "v1.2.3", expected: true },
    { value: "1.2", expected: false },
  ])("detects exact semver versions for %s", ({ value, expected }) => {
    expect(isExactSemverVersion(value)).toBe(expected);
  });

  it.each([
    { value: "1.2.3-beta.1", expected: true },
    { value: "1.2.3", expected: false },
  ])("detects prerelease semver versions for %s", ({ value, expected }) => {
    expect(isPrereleaseSemverVersion(value)).toBe(expected);
  });
});

describe("npm prerelease resolution policy", () => {
  it.each([
    {
      spec: "@alisio/voice-call",
      resolvedVersion: "1.2.3-beta.1",
      expected: false,
    },
    {
      spec: "@alisio/voice-call@latest",
      resolvedVersion: "1.2.3-rc.1",
      expected: false,
    },
    {
      spec: "@alisio/voice-call@beta",
      resolvedVersion: "1.2.3-beta.4",
      expected: true,
    },
    {
      spec: "@alisio/voice-call@1.2.3-beta.1",
      resolvedVersion: "1.2.3-beta.1",
      expected: true,
    },
    {
      spec: "@alisio/voice-call",
      resolvedVersion: "1.2.3",
      expected: true,
    },
    {
      spec: "@alisio/voice-call@latest",
      resolvedVersion: undefined,
      expected: true,
    },
  ])("decides prerelease resolution for %s -> %s", ({ spec, resolvedVersion, expected }) => {
    expect(
      isPrereleaseResolutionAllowed({
        spec: parseSpecOrThrow(spec),
        resolvedVersion,
      }),
    ).toBe(expected);
  });

  it.each([
    {
      spec: "@alisio/voice-call",
      resolvedVersion: "1.2.3-beta.1",
      expected: `Use "@alisio/voice-call@beta"`,
    },
    {
      spec: "@alisio/voice-call@beta",
      resolvedVersion: "1.2.3-rc.1",
      expected: "Use an explicit prerelease tag or exact prerelease version",
    },
  ])("formats prerelease guidance for %s", ({ spec, resolvedVersion, expected }) => {
    expect(
      formatPrereleaseResolutionError({
        spec: parseSpecOrThrow(spec),
        resolvedVersion,
      }),
    ).toContain(expected);
  });
});
