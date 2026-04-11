import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import type { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { buildObsidianDailyNoteSeed } from "../../../../packages/memory-host-sdk/src/host/obsidian-layout.js";
import type { AnyAgentTool } from "../../pi-tools.types.js";
import { resetEmbeddedAttemptHarness } from "./attempt.spawn-workspace.test-support.js";

const MEMORY_RELATIVE_PATH = "memory/2026-03-24.md";
const OBSIDIAN_DATE = "2026-03-24";
const OBSIDIAN_SEED = buildObsidianDailyNoteSeed(OBSIDIAN_DATE);

function createAttemptParams(workspaceDir: string) {
  return {
    sessionId: "session-memory-flush",
    sessionKey: "agent:main",
    sessionFile: path.join(workspaceDir, "session.json"),
    workspaceDir,
    prompt: "flush durable notes",
    timeoutMs: 30_000,
    runId: "run-memory-flush",
    provider: "openai",
    modelId: "gpt-5.4",
    model: {
      api: "responses",
      provider: "openai",
      id: "gpt-5.4",
      input: ["text"],
      contextWindow: 128_000,
    } as Model<Api>,
    authStorage: {} as AuthStorage,
    modelRegistry: {} as ModelRegistry,
    thinkLevel: "off" as const,
    trigger: "memory" as const,
    memoryFlushWritePath: MEMORY_RELATIVE_PATH,
    memoryFlushWriteSeedContent: OBSIDIAN_SEED,
  };
}

describe("runEmbeddedAttempt memory flush tool forwarding", () => {
  it("forwards memory trigger metadata into tool creation so append-only guards activate", async () => {
    vi.resetModules();
    resetEmbeddedAttemptHarness();

    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-attempt-memory-flush-"));
    const stop = new Error("stop after tool creation");
    const capturedOptions: Array<Record<string, unknown> | undefined> = [];

    try {
      vi.doMock("../../pi-tools.js", () => {
        const createAlisioCodingTools = vi.fn((options) => {
          capturedOptions.push(options as Record<string, unknown> | undefined);
          throw stop;
        });
        return {
          createAlisioCodingTools,
          resolveToolLoopDetectionConfig: vi.fn(() => undefined),
        };
      });

      const { runEmbeddedAttempt } = await import("./attempt.js");

      await expect(runEmbeddedAttempt(createAttemptParams(workspaceDir))).rejects.toBe(stop);

      expect(capturedOptions).toHaveLength(1);
      expect(capturedOptions[0]).toMatchObject({
        trigger: "memory",
        memoryFlushWritePath: MEMORY_RELATIVE_PATH,
        memoryFlushWriteSeedContent: OBSIDIAN_SEED,
      });
    } finally {
      vi.doUnmock("../../pi-tools.js");
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("activates the memory flush append-only write wrapper", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-attempt-memory-flush-"));
    const memoryFile = path.join(workspaceDir, MEMORY_RELATIVE_PATH);

    try {
      await fs.mkdir(path.dirname(memoryFile), { recursive: true });
      await fs.writeFile(memoryFile, "seed", "utf-8");

      const { wrapToolMemoryFlushAppendOnlyWrite } = await import("../../pi-tools.read.js");
      const fallbackWrite = vi.fn(async () => {
        throw new Error("append-only wrapper should not delegate to the base write tool");
      });
      const writeTool: AnyAgentTool = {
        name: "write",
        label: "write",
        description: "Write content to a file.",
        parameters: { type: "object", properties: {} },
        execute: fallbackWrite,
      };
      const wrapped = wrapToolMemoryFlushAppendOnlyWrite(writeTool, {
        root: workspaceDir,
        relativePath: MEMORY_RELATIVE_PATH,
      });

      await expect(
        wrapped.execute("call-memory-flush-append", {
          path: MEMORY_RELATIVE_PATH,
          content: "new durable note",
        }),
      ).resolves.toMatchObject({
        content: [{ type: "text", text: `Appended content to ${MEMORY_RELATIVE_PATH}.` }],
        details: {
          path: MEMORY_RELATIVE_PATH,
          appendOnly: true,
        },
      });
      await expect(fs.readFile(memoryFile, "utf-8")).resolves.toBe("seed\nnew durable note");
      await expect(
        wrapped.execute("call-memory-flush-deny", {
          path: "memory/other-day.md",
          content: "wrong target",
        }),
      ).rejects.toThrow(
        `Memory flush writes are restricted to ${MEMORY_RELATIVE_PATH}; use that path only.`,
      );
      expect(fallbackWrite).not.toHaveBeenCalled();
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("creates obsidian-friendly daily notes with seed content for absolute vault targets", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-attempt-memory-flush-"));
    const vaultDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-obsidian-vault-"));
    const memoryFile = path.join(vaultDir, "Alisio Memory", "daily", `${OBSIDIAN_DATE}.md`);

    try {
      const { wrapToolMemoryFlushAppendOnlyWrite } = await import("../../pi-tools.read.js");
      const fallbackWrite = vi.fn(async () => {
        throw new Error("append-only wrapper should not delegate to the base write tool");
      });
      const writeTool: AnyAgentTool = {
        name: "write",
        label: "write",
        description: "Write content to a file.",
        parameters: { type: "object", properties: {} },
        execute: fallbackWrite,
      };
      const wrapped = wrapToolMemoryFlushAppendOnlyWrite(writeTool, {
        root: workspaceDir,
        relativePath: memoryFile,
        createSeedContent: OBSIDIAN_SEED,
      });

      await expect(
        wrapped.execute("call-memory-flush-obsidian", {
          path: memoryFile,
          content: "durable memory bullet",
        }),
      ).resolves.toMatchObject({
        details: {
          path: memoryFile,
          appendOnly: true,
        },
      });

      await expect(fs.readFile(memoryFile, "utf-8")).resolves.toBe(
        `${OBSIDIAN_SEED}durable memory bullet`,
      );
      expect(fallbackWrite).not.toHaveBeenCalled();
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      await fs.rm(vaultDir, { recursive: true, force: true });
    }
  });
});
