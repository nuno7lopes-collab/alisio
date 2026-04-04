import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveModelFileMock = vi.hoisted(() =>
  vi.fn(async (_sourceUri: string, options?: string | { directory?: string }) => {
    const directory =
      typeof options === "string" ? options : options?.directory?.trim() || "/tmp/openclaw-models";
    return `${directory}/resolved.gguf`;
  }),
);

vi.mock("./llama-cpp.runtime.js", () => ({
  resolveModelFile: resolveModelFileMock,
  getLlama: vi.fn(),
  LlamaLogLevel: { error: 0 },
  LlamaChatSession: class {},
}));

import { installAlisioLocalModel } from "./alisio-local-llama-runtime.js";

describe("installAlisioLocalModel", () => {
  let stateDir: string;

  beforeEach(async () => {
    resolveModelFileMock.mockClear();
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-alisio-llama-"));
  });

  afterEach(async () => {
    await fs.rm(stateDir, { recursive: true, force: true });
  });

  it("downloads the published quantization configured in the catalog and persists it", async () => {
    const env = {
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_TEST_FAST: "1",
      HOME: stateDir,
    } as NodeJS.ProcessEnv;

    const installed = await installAlisioLocalModel({
      modelId: "qwen3-8b-q4-k-m",
      env,
    });

    expect(installed).toMatchObject({
      id: "qwen3-8b-q4-k-m",
      name: "Qwen3 8B",
      ownedBy: "llama.cpp",
    });
    expect(resolveModelFileMock).toHaveBeenCalledWith(
      "hf:Qwen/Qwen3-8B-GGUF:Q4_K_M",
      expect.objectContaining({
        directory: path.join(stateDir, "models", "llama.cpp"),
        cli: false,
      }),
    );

    const manifestPath = path.join(stateDir, "models", "llama.cpp", "installed.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as {
      version: number;
      installed: Array<{
        modelId: string;
        modelPath: string;
        sourceUri: string;
      }>;
    };

    expect(manifest).toMatchObject({
      version: 1,
      installed: [
        {
          modelId: "qwen3-8b-q4-k-m",
          modelPath: path.join(stateDir, "models", "llama.cpp", "resolved.gguf"),
          sourceUri: "hf:Qwen/Qwen3-8B-GGUF:Q4_K_M",
        },
      ],
    });
  });
});
