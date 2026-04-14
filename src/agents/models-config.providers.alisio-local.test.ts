import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadModelRegistry } from "../commands/models/list.registry.js";
import { resolveStateDir } from "../config/paths.js";
import { clearAlisioDynamicModelProviders } from "../infra/alisio-model-providers.js";
import { resolveAlisioAgentDir } from "./agent-paths.js";
import { ensureAlisioModelsJson, resetModelsJsonReadyCacheForTest } from "./models-config.js";
import {
  installModelsConfigTestHooks,
  MODELS_CONFIG_IMPLICIT_ENV_VARS,
  resolveImplicitProvidersForTest,
  unsetEnv,
  withModelsTempHome,
  withTempEnv,
} from "./models-config.e2e-harness.js";
import { readGeneratedModelsJson } from "./models-config.test-utils.js";

installModelsConfigTestHooks();

type GeneratedModelsJson = {
  providers: Record<string, { api?: string; models?: Array<{ id: string }> }>;
};

async function installManagedLocalModel(env: NodeJS.ProcessEnv, modelId = "qwen3-4b-q4-k-m") {
  const stateDir = resolveStateDir(env);
  const modelsDir = path.join(stateDir, "models", "llama.cpp");
  const modelPath = path.join(modelsDir, "resolved.gguf");
  await fs.mkdir(modelsDir, { recursive: true });
  await fs.writeFile(modelPath, "gguf-test-model", "utf8");
  await fs.writeFile(
    path.join(modelsDir, "installed.json"),
    `${JSON.stringify(
      {
        version: 1,
        installed: [
          {
            modelId,
            modelPath,
            sourceUri: "https://example.invalid/qwen3-4b-q4-k-m.gguf",
            installedAt: "2026-04-14T09:00:00.000Z",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

describe("Alisio local implicit providers", () => {
  beforeEach(() => {
    clearAlisioDynamicModelProviders();
    resetModelsJsonReadyCacheForTest();
  });

  it("injects managed local dynamic providers into implicit discovery", async () => {
    await withModelsTempHome(async () => {
      await withTempEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS, async () => {
        unsetEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS);
        await installManagedLocalModel(process.env);
        const agentDir = resolveAlisioAgentDir();

        const providers = await resolveImplicitProvidersForTest({ agentDir });

        expect(providers?.["alisio-local-current-llama"]).toMatchObject({
          api: "alisio:alisio-local-current-llama",
          models: [
            expect.objectContaining({
              id: "qwen3-4b-q4-k-m",
              api: "alisio:alisio-local-current-llama",
            }),
          ],
        });
      });
    });
  });

  it("writes managed local dynamic providers into models.json", async () => {
    await withModelsTempHome(async () => {
      await withTempEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS, async () => {
        unsetEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS);
        await installManagedLocalModel(process.env);

        await ensureAlisioModelsJson({});

        const parsed = await readGeneratedModelsJson<GeneratedModelsJson>();
        expect(parsed.providers["alisio-local-current-llama"]).toMatchObject({
          api: "alisio:alisio-local-current-llama",
          models: [expect.objectContaining({ id: "qwen3-4b-q4-k-m" })],
        });
      });
    });
  });

  it("produces a models.json that the model registry accepts", async () => {
    await withModelsTempHome(async () => {
      await withTempEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS, async () => {
        unsetEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS);
        await installManagedLocalModel(process.env);

        await ensureAlisioModelsJson({});
        const loaded = await loadModelRegistry({});

        expect(loaded.registry.getError?.()).toBeUndefined();
        expect(loaded.models).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              provider: "alisio-local-current-llama",
              id: "qwen3-4b-q4-k-m",
            }),
          ]),
        );
        expect(loaded.availableKeys?.has("alisio-local-current-llama/qwen3-4b-q4-k-m")).toBe(true);
      });
    });
  });

  it("invalidates the models.json cache when the installed local model set changes", async () => {
    await withModelsTempHome(async () => {
      await withTempEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS, async () => {
        unsetEnv(MODELS_CONFIG_IMPLICIT_ENV_VARS);

        const first = await ensureAlisioModelsJson({});
        expect(first.wrote).toBe(false);

        await installManagedLocalModel(process.env);

        const second = await ensureAlisioModelsJson({});
        expect(second.wrote).toBe(true);

        const parsed = await readGeneratedModelsJson<GeneratedModelsJson>();
        expect(parsed.providers["alisio-local-current-llama"]).toMatchObject({
          api: "alisio:alisio-local-current-llama",
          models: [expect.objectContaining({ id: "qwen3-4b-q4-k-m" })],
        });
      });
    });
  });
});
