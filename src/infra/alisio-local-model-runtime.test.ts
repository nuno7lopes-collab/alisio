import { describe, expect, it } from "vitest";
import { listManagedLocalAvailableModels } from "./alisio-local-model-runtime.js";

function createHardware(totalMemoryGb: number) {
  return {
    platform: "darwin",
    architecture: "arm64",
    totalMemoryGb,
    cpuCores: 8,
  } as const;
}

describe("listManagedLocalAvailableModels", () => {
  it("returns the published Alisio llama.cpp catalog", () => {
    const models = listManagedLocalAvailableModels();

    expect(models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "qwen3-4b-q4-k-m",
          name: "Qwen3 4B",
          runtimeKind: "llama.cpp",
          ownedBy: "llama.cpp",
        }),
        expect.objectContaining({
          id: "qwen3-8b-q4-k-m",
          name: "Qwen3 8B",
          runtimeKind: "llama.cpp",
          ownedBy: "llama.cpp",
        }),
      ]),
    );
  });

  it("attaches hardware-based recommendations to the managed llama.cpp catalog", () => {
    const models = listManagedLocalAvailableModels(createHardware(16));
    const midTierModel = models.find((model) => model.id === "qwen3-8b-q4-k-m");

    expect(midTierModel).toMatchObject({
      runtimeKind: "llama.cpp",
      recommendation: expect.objectContaining({
        modelId: "qwen3-8b-q4-k-m",
      }),
    });
  });
});
