import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  autoMigrateLegacyStateDir,
  resetAutoMigrateLegacyStateDirForTest,
} from "./state-migrations.js";

let tempRoot: string | null = null;

async function makeTempRoot() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "alisio-state-dir-"));
  tempRoot = root;
  return root;
}

afterEach(async () => {
  resetAutoMigrateLegacyStateDirForTest();
  if (!tempRoot) {
    return;
  }
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("state dir auto-migration", () => {
  it("does nothing when only canonical paths are supported", async () => {
    const root = await makeTempRoot();

    const result = await autoMigrateLegacyStateDir({
      env: {} as NodeJS.ProcessEnv,
      homedir: () => root,
    });

    expect(result).toEqual({
      migrated: false,
      skipped: false,
      changes: [],
      warnings: [],
    });
  });

  it("only runs once per process until reset", async () => {
    const root = await makeTempRoot();

    const first = await autoMigrateLegacyStateDir({
      env: {} as NodeJS.ProcessEnv,
      homedir: () => root,
    });
    const second = await autoMigrateLegacyStateDir({
      env: {} as NodeJS.ProcessEnv,
      homedir: () => root,
    });

    expect(first).toEqual({
      migrated: false,
      skipped: false,
      changes: [],
      warnings: [],
    });
    expect(second).toEqual({
      migrated: false,
      skipped: true,
      changes: [],
      warnings: [],
    });
  });

  it("skips state-dir migration when ALISIO_STATE_DIR is explicitly set", async () => {
    const root = await makeTempRoot();

    const result = await autoMigrateLegacyStateDir({
      env: { ALISIO_STATE_DIR: path.join(root, "custom-state") } as NodeJS.ProcessEnv,
      homedir: () => root,
    });

    expect(result).toEqual({
      migrated: false,
      skipped: true,
      changes: [],
      warnings: [],
    });
  });
});
