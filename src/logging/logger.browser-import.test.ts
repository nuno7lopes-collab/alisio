import { afterEach, describe, expect, it, vi } from "vitest";

type LoggerModule = typeof import("./logger.js");

const originalGetBuiltinModule = (
  process as NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }
).getBuiltinModule;

async function importBrowserSafeLogger(params?: {
  resolvePreferredAlisioTmpDir?: ReturnType<typeof vi.fn>;
}): Promise<{
  module: LoggerModule;
  resolvePreferredAlisioTmpDir: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const resolvePreferredAlisioTmpDir =
    params?.resolvePreferredAlisioTmpDir ??
    vi.fn(() => {
      throw new Error("resolvePreferredAlisioTmpDir should not run during browser-safe import");
    });

  vi.doMock("../infra/tmp-alisio-dir.js", async () => {
    const actual = await vi.importActual<typeof import("../infra/tmp-alisio-dir.js")>(
      "../infra/tmp-alisio-dir.js",
    );
    return {
      ...actual,
      resolvePreferredAlisioTmpDir,
    };
  });

  Object.defineProperty(process, "getBuiltinModule", {
    configurable: true,
    value: undefined,
  });

  const module = await import("./logger.js");
  return { module, resolvePreferredAlisioTmpDir };
}

describe("logging/logger browser-safe import", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../infra/tmp-alisio-dir.js");
    Object.defineProperty(process, "getBuiltinModule", {
      configurable: true,
      value: originalGetBuiltinModule,
    });
  });

  it("does not resolve the preferred temp dir at import time when node fs is unavailable", async () => {
    const { module, resolvePreferredAlisioTmpDir } = await importBrowserSafeLogger();

    expect(resolvePreferredAlisioTmpDir).not.toHaveBeenCalled();
    expect(module.DEFAULT_LOG_DIR).toBe("/tmp/alisio");
    expect(module.DEFAULT_LOG_FILE).toBe("/tmp/alisio/alisio.log");
  });

  it("disables file logging when imported in a browser-like environment", async () => {
    const { module, resolvePreferredAlisioTmpDir } = await importBrowserSafeLogger();

    expect(module.getResolvedLoggerSettings()).toMatchObject({
      level: "silent",
      file: "/tmp/alisio/alisio.log",
    });
    expect(module.isFileLogLevelEnabled("info")).toBe(false);
    expect(() => module.getLogger().info("browser-safe")).not.toThrow();
    expect(resolvePreferredAlisioTmpDir).not.toHaveBeenCalled();
  });
});
