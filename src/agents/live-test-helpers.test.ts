import { describe, expect, it } from "vitest";
import {
  isLiveEnvEnabled,
  isLiveProfileKeyModeEnabled,
  isLiveTestEnabled,
  readLiveEnv,
} from "./live-test-helpers.js";

describe("isLiveTestEnabled", () => {
  it("treats ALISIO_LIVE_TEST, OPENCLAW_LIVE_TEST, and LIVE as shared live gates", () => {
    expect(isLiveTestEnabled([], { ALISIO_LIVE_TEST: "1" })).toBe(true);
    expect(isLiveTestEnabled([], { LIVE: "1" })).toBe(true);
    expect(isLiveTestEnabled([], { OPENCLAW_LIVE_TEST: "1" })).toBe(true);
    expect(isLiveTestEnabled([], {})).toBe(false);
  });

  it("supports provider-specific live flags", () => {
    expect(isLiveTestEnabled(["MINIMAX_LIVE_TEST"], { MINIMAX_LIVE_TEST: "1" })).toBe(true);
    expect(isLiveTestEnabled(["MINIMAX_LIVE_TEST"], { MINIMAX_LIVE_TEST: "0" })).toBe(false);
  });
});

describe("isLiveProfileKeyModeEnabled", () => {
  it("only enables profile-key mode for the dedicated flag", () => {
    expect(isLiveProfileKeyModeEnabled({ ALISIO_LIVE_REQUIRE_PROFILE_KEYS: "1" })).toBe(true);
    expect(isLiveProfileKeyModeEnabled({ OPENCLAW_LIVE_REQUIRE_PROFILE_KEYS: "1" })).toBe(true);
    expect(isLiveProfileKeyModeEnabled({ OPENCLAW_LIVE_TEST: "1" })).toBe(false);
    expect(isLiveProfileKeyModeEnabled({ LIVE: "1" })).toBe(false);
  });
});

describe("readLiveEnv", () => {
  it("prefers canonical Alisio env names before legacy fallbacks", () => {
    expect(readLiveEnv(["ALISIO_LIVE_TEST", "OPENCLAW_LIVE_TEST"], {})).toBeUndefined();
    expect(
      readLiveEnv(["ALISIO_LIVE_TEST", "OPENCLAW_LIVE_TEST"], { OPENCLAW_LIVE_TEST: "1" }),
    ).toBe("1");
    expect(
      readLiveEnv(["ALISIO_LIVE_TEST", "OPENCLAW_LIVE_TEST"], {
        ALISIO_LIVE_TEST: "2",
        OPENCLAW_LIVE_TEST: "1",
      }),
    ).toBe("2");
  });
});

describe("isLiveEnvEnabled", () => {
  it("accepts either canonical or legacy truthy flags", () => {
    expect(isLiveEnvEnabled(["ALISIO_LIVE_GATEWAY", "OPENCLAW_LIVE_GATEWAY"], {})).toBe(false);
    expect(
      isLiveEnvEnabled(["ALISIO_LIVE_GATEWAY", "OPENCLAW_LIVE_GATEWAY"], {
        OPENCLAW_LIVE_GATEWAY: "1",
      }),
    ).toBe(true);
    expect(
      isLiveEnvEnabled(["ALISIO_LIVE_GATEWAY", "OPENCLAW_LIVE_GATEWAY"], {
        ALISIO_LIVE_GATEWAY: "1",
      }),
    ).toBe(true);
  });
});
