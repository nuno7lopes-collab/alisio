import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { removePathIfExists } from "../../scripts/runtime-postbuild-shared.mjs";

describe("removePathIfExists", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries transient ENOTEMPTY failures before succeeding", () => {
    const rmSync = vi.spyOn(fs, "rmSync");
    rmSync
      .mockImplementationOnce(() => {
        const error = new Error("directory not empty");
        Object.assign(error, { code: "ENOTEMPTY" });
        throw error;
      })
      .mockImplementationOnce(() => undefined);

    expect(removePathIfExists("/tmp/demo-runtime-postbuild")).toBe(true);
    expect(rmSync).toHaveBeenCalledTimes(2);
  });
});
