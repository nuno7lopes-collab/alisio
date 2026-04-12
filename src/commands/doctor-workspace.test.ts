import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AlisioConfig } from "../config/config.js";
import { shouldSuggestMemorySystem } from "./doctor-workspace.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.allSettled(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

async function createTempWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-doctor-workspace-"));
  tempDirs.push(dir);
  return dir;
}

describe("shouldSuggestMemorySystem", () => {
  it("does not suggest installation when MEMORY.md already exists", async () => {
    const workspaceDir = await createTempWorkspace();
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf-8");

    await expect(
      shouldSuggestMemorySystem({ workspaceDir, cfg: {} as AlisioConfig }),
    ).resolves.toBe(false);
  });
});
