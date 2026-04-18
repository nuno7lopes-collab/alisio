import { beforeEach, describe, expect, it, vi } from "vitest";
import { withEnv } from "../test-utils/env.js";

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
}));

vi.mock("../logging/subsystem.js", () => ({
  createSubsystemLogger: () => ({
    info: loggerMocks.info,
  }),
}));

type EnvModule = typeof import("./env.js");

let isTruthyEnvValue: EnvModule["isTruthyEnvValue"];
let runtimeEnvKey: EnvModule["runtimeEnvKey"];
let logAcceptedEnvOption: EnvModule["logAcceptedEnvOption"];
let readEnv: EnvModule["readEnv"];

beforeEach(async () => {
  vi.resetModules();
  ({ isTruthyEnvValue, runtimeEnvKey, logAcceptedEnvOption, readEnv } = await import("./env.js"));
});

describe("isTruthyEnvValue", () => {
  it("accepts common truthy values", () => {
    expect(isTruthyEnvValue("1")).toBe(true);
    expect(isTruthyEnvValue("true")).toBe(true);
    expect(isTruthyEnvValue(" yes ")).toBe(true);
    expect(isTruthyEnvValue("ON")).toBe(true);
  });

  it("rejects other values", () => {
    expect(isTruthyEnvValue("0")).toBe(false);
    expect(isTruthyEnvValue("false")).toBe(false);
    expect(isTruthyEnvValue("")).toBe(false);
    expect(isTruthyEnvValue(undefined)).toBe(false);
  });
});

describe("logAcceptedEnvOption", () => {
  it("logs accepted env options once with redaction and formatting", () => {
    loggerMocks.info.mockClear();

    withEnv(
      {
        VITEST: "",
        NODE_ENV: "development",
        ALISIO_TEST_ENV: "  line one\nline two  ",
      },
      () => {
        logAcceptedEnvOption({
          key: "ALISIO_TEST_ENV",
          description: "test option",
          redact: true,
        });
        logAcceptedEnvOption({
          key: "ALISIO_TEST_ENV",
          description: "test option",
          redact: true,
        });
      },
    );

    expect(loggerMocks.info).toHaveBeenCalledTimes(1);
    expect(loggerMocks.info).toHaveBeenCalledWith("env: ALISIO_TEST_ENV=<redacted> (test option)");
  });

  it("skips blank values and test-mode logging", () => {
    loggerMocks.info.mockClear();

    withEnv(
      {
        VITEST: "1",
        NODE_ENV: "development",
        ALISIO_BLANK_ENV: "value",
      },
      () => {
        logAcceptedEnvOption({
          key: "ALISIO_BLANK_ENV",
          description: "skipped in vitest",
        });
      },
    );

    withEnv(
      {
        VITEST: "",
        NODE_ENV: "development",
        ALISIO_BLANK_ENV: "   ",
      },
      () => {
        logAcceptedEnvOption({
          key: "ALISIO_BLANK_ENV",
          description: "blank value",
        });
      },
    );

    expect(loggerMocks.info).not.toHaveBeenCalled();
  });
});

describe("readEnv", () => {
  it("prefers the Alisio key and falls back to the compatibility key", () => {
    const compatKey = runtimeEnvKey("STATE_DIR");
    expect(readEnv("ALISIO_STATE_DIR", { env: { ALISIO_STATE_DIR: "/new" } })).toBe("/new");
    expect(
      readEnv("ALISIO_STATE_DIR", {
        env: { [compatKey]: "/legacy" } as NodeJS.ProcessEnv,
        fallback: compatKey,
      }),
    ).toBe("/legacy");
  });
});
