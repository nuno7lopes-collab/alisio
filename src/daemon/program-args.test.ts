import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  access: vi.fn(),
  realpath: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: { access: fsMocks.access, realpath: fsMocks.realpath },
  access: fsMocks.access,
  realpath: fsMocks.realpath,
}));

vi.mock("node:child_process", () => ({
  execFileSync: childProcessMocks.execFileSync,
}));

import { resolveGatewayProgramArguments } from "./program-args.js";

const originalArgv = [...process.argv];

afterEach(() => {
  process.argv = [...originalArgv];
  vi.resetAllMocks();
});

describe("resolveGatewayProgramArguments", () => {
  it("uses realpath-resolved dist entry when running via npx shim", async () => {
    const argv1 = path.resolve("/tmp/.npm/_npx/63c3/node_modules/.bin/alisio");
    const entryPath = path.resolve("/tmp/.npm/_npx/63c3/node_modules/alisio/dist/entry.js");
    process.argv = ["node", argv1];
    fsMocks.realpath.mockResolvedValue(entryPath);
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === entryPath) {
        return;
      }
      throw new Error("missing");
    });

    const result = await resolveGatewayProgramArguments({ port: 40705 });

    expect(result.programArguments).toEqual([
      process.execPath,
      entryPath,
      "gateway",
      "run",
      "--port",
      "40705",
    ]);
  });

  it("prefers the package wrapper over dist entrypoints when available", async () => {
    // Simulates pnpm global install where node_modules/alisio is a symlink
    // to .pnpm/alisio@X.Y.Z/node_modules/alisio.
    const symlinkPath = path.resolve(
      "/Users/test/Library/pnpm/global/5/node_modules/alisio/dist/entry.js",
    );
    const realpathResolved = path.resolve(
      "/Users/test/Library/pnpm/global/5/node_modules/.pnpm/alisio@2026.1.21-2/node_modules/alisio/dist/entry.js",
    );
    const wrapperPath = path.resolve(
      "/Users/test/Library/pnpm/global/5/node_modules/alisio/alisio.mjs",
    );
    process.argv = ["node", symlinkPath];
    fsMocks.realpath.mockResolvedValue(realpathResolved);
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === symlinkPath || target === realpathResolved || target === wrapperPath) {
        return;
      }
      throw new Error("missing");
    });

    const result = await resolveGatewayProgramArguments({ port: 40705 });

    expect(result.programArguments[1]).toBe(wrapperPath);
    expect(result.programArguments[1]).not.toContain("@2026.1.21-2");
  });

  it("falls back to node_modules package dist when .bin path is not resolved", async () => {
    const argv1 = path.resolve("/tmp/.npm/_npx/63c3/node_modules/.bin/alisio");
    const indexPath = path.resolve("/tmp/.npm/_npx/63c3/node_modules/alisio/dist/index.js");
    process.argv = ["node", argv1];
    fsMocks.realpath.mockRejectedValue(new Error("no realpath"));
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === indexPath) {
        return;
      }
      throw new Error("missing");
    });

    const result = await resolveGatewayProgramArguments({ port: 40705 });

    expect(result.programArguments).toEqual([
      process.execPath,
      indexPath,
      "gateway",
      "run",
      "--port",
      "40705",
    ]);
  });

  it("uses src/entry.ts for bun dev mode", async () => {
    const repoIndexPath = path.resolve("/repo/src/index.ts");
    const repoEntryPath = path.resolve("/repo/src/entry.ts");
    process.argv = ["/usr/local/bin/node", repoIndexPath];
    fsMocks.realpath.mockResolvedValue(repoIndexPath);
    fsMocks.access.mockResolvedValue(undefined);
    childProcessMocks.execFileSync.mockReturnValue("/usr/local/bin/bun\n");

    const result = await resolveGatewayProgramArguments({
      dev: true,
      port: 40705,
      runtime: "bun",
    });

    expect(result.programArguments).toEqual([
      "/usr/local/bin/bun",
      repoEntryPath,
      "gateway",
      "run",
      "--port",
      "40705",
    ]);
    expect(result.workingDirectory).toBe(path.resolve("/repo"));
  });
});
