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

import {
  installAlisioLocalModel,
  listInstalledAlisioLocalModels,
  uninstallAlisioLocalModel,
} from "./alisio-local-llama-runtime.js";

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

  it("drops unusable manifest entries and only reports real installed files", async () => {
    const env = {
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_TEST_FAST: "1",
      HOME: stateDir,
    } as NodeJS.ProcessEnv;
    const modelsDir = path.join(stateDir, "models", "llama.cpp");
    await fs.mkdir(modelsDir, { recursive: true });
    await fs.writeFile(path.join(modelsDir, "ready.gguf"), "model-bytes");
    await fs.writeFile(
      path.join(modelsDir, "installed.json"),
      JSON.stringify(
        {
          version: 1,
          installed: [
            {
              modelId: "qwen3-4b-q4-k-m",
              modelPath: path.join(modelsDir, "ready.gguf"),
              sourceUri: "hf:Qwen/Qwen3-4B-GGUF:Q4_K_M",
              installedAt: "2026-04-06T10:00:00.000Z",
            },
            {
              modelId: "qwen3-8b-q4-k-m",
              modelPath: path.join(modelsDir, "missing.gguf"),
              sourceUri: "hf:Qwen/Qwen3-8B-GGUF:Q4_K_M",
              installedAt: "2026-04-06T10:01:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    );

    await expect(listInstalledAlisioLocalModels(env)).resolves.toEqual([
      {
        id: "qwen3-4b-q4-k-m",
        name: "Qwen3 4B",
        ownedBy: "llama.cpp",
      },
    ]);

    const manifest = JSON.parse(
      await fs.readFile(path.join(modelsDir, "installed.json"), "utf8"),
    ) as { installed: Array<{ modelId: string }> };
    expect(manifest.installed.map((entry) => entry.modelId)).toEqual(["qwen3-4b-q4-k-m"]);
  });

  it("removes the model from the manifest and deletes its file on uninstall", async () => {
    const env = {
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_TEST_FAST: "1",
      HOME: stateDir,
    } as NodeJS.ProcessEnv;

    await installAlisioLocalModel({
      modelId: "qwen3-8b-q4-k-m",
      env,
    });

    const modelsDir = path.join(stateDir, "models", "llama.cpp");
    const modelPath = path.join(modelsDir, "resolved.gguf");
    await fs.writeFile(modelPath, "downloaded-model");

    const removed = await uninstallAlisioLocalModel({
      modelId: "qwen3-8b-q4-k-m",
      env,
    });

    expect(removed).toMatchObject({
      id: "qwen3-8b-q4-k-m",
      name: "Qwen3 8B",
      ownedBy: "llama.cpp",
    });
    await expect(fs.access(modelPath)).rejects.toThrow();

    const manifest = JSON.parse(
      await fs.readFile(path.join(modelsDir, "installed.json"), "utf8"),
    ) as { installed: unknown[] };
    expect(manifest.installed).toEqual([]);
  });
});
