import { describe, expect, it, vi } from "vitest";
import {
  inspectLocalModelRuntime,
  inspectLocalModelRuntimes,
  installOllamaLocalModel,
  uninstallOllamaLocalModel,
} from "./alisio-local-model-runtime.js";

function resolveFetchInputUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

describe("inspectLocalModelRuntime", () => {
  it("detects Ollama via /api/tags and marks running models from /api/ps", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = resolveFetchInputUrl(input);
      if (url.endsWith("/api/tags")) {
        return new Response(
          JSON.stringify({
            models: [{ name: "qwen3:4b" }, { name: "qwen3:8b" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/ps")) {
        return new Response(
          JSON.stringify({
            models: [{ name: "qwen3:8b" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected url: ${url}`);
    };

    const inspection = await inspectLocalModelRuntime({
      env: {
        ALISIO_NODE_MODEL_BASE_URL: "http://127.0.0.1:11434",
      } as NodeJS.ProcessEnv,
      fetchImpl,
    });

    expect(inspection.runtimeKind).toBe("ollama");
    expect(inspection.supportsInstall).toBe(true);
    expect(inspection.models).toEqual([
      expect.objectContaining({ id: "qwen3:8b", running: true }),
      expect.objectContaining({ id: "qwen3:4b" }),
    ]);
    expect(inspection.availableModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "qwen3:4b", runtimeKind: "ollama" }),
        expect.objectContaining({ id: "qwen3:8b", runtimeKind: "ollama" }),
      ]),
    );
  });

  it("classifies the default local OpenAI-compatible endpoint as LM Studio", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = resolveFetchInputUrl(input);
      if (url.endsWith("/api/tags")) {
        return new Response("missing", { status: 404 });
      }
      if (url.endsWith("/v1/models")) {
        return new Response(
          JSON.stringify({
            data: [{ id: "gpt-oss-20b", owned_by: "lmstudio" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected url: ${url}`);
    };

    const inspection = await inspectLocalModelRuntime({
      env: {
        ALISIO_NODE_MODEL_BASE_URL: "http://127.0.0.1:1234",
      } as NodeJS.ProcessEnv,
      fetchImpl,
    });

    expect(inspection.runtimeKind).toBe("lmstudio");
    expect(inspection.supportsInstall).toBe(false);
    expect(inspection.models).toEqual([
      {
        id: "gpt-oss-20b",
        name: "gpt-oss-20b",
        ownedBy: "lmstudio",
      },
    ]);
    expect(inspection.availableModels).toEqual([
      {
        id: "gpt-oss-20b",
        name: "gpt-oss-20b",
        runtimeKind: "lmstudio",
        ownedBy: "lmstudio",
      },
    ]);
  });

  it("discovers Ollama and LM Studio as separate local runtimes on the same computer", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = resolveFetchInputUrl(input);
      if (url === "http://127.0.0.1:11434/api/tags") {
        return new Response(
          JSON.stringify({
            models: [{ name: "qwen3:8b" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "http://127.0.0.1:11434/api/ps") {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "http://127.0.0.1:1234/v1/models") {
        return new Response(
          JSON.stringify({
            data: [{ id: "gpt-oss-20b", owned_by: "lmstudio" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "http://127.0.0.1:1234/models") {
        return new Response("missing", { status: 404 });
      }
      throw new Error(`unexpected url: ${url}`);
    };

    const inspections = await inspectLocalModelRuntimes({ fetchImpl });

    expect(inspections.map((inspection) => inspection.runtimeKind)).toEqual(
      expect.arrayContaining(["ollama", "lmstudio"]),
    );
    expect(inspections.find((inspection) => inspection.runtimeKind === "ollama")?.models).toEqual([
      { id: "qwen3:8b", name: "qwen3:8b", ownedBy: "ollama" },
    ]);
    expect(inspections.find((inspection) => inspection.runtimeKind === "lmstudio")?.models).toEqual(
      [{ id: "gpt-oss-20b", name: "gpt-oss-20b", ownedBy: "lmstudio" }],
    );
  });

  it("installs an Ollama model via /api/pull and forwards streamed progress", async () => {
    const fetchImpl = vi.fn(async (input, init) => {
      expect(resolveFetchInputUrl(input)).toBe("http://127.0.0.1:11434/api/pull");
      expect(init).toMatchObject({
        method: "POST",
      });
      return new Response('{"completed":25,"total":100}\n{"completed":100,"total":100}\n', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const onProgress = vi.fn();

    const installed = await installOllamaLocalModel({
      modelId: "qwen3:8b",
      env: {
        ALISIO_NODE_MODEL_BASE_URL: "http://127.0.0.1:11434",
      } as NodeJS.ProcessEnv,
      fetchImpl,
      onProgress,
    });

    expect(installed).toEqual({
      id: "qwen3:8b",
      name: "qwen3:8b",
      ownedBy: "ollama",
    });
    expect(onProgress).toHaveBeenNthCalledWith(1, {
      downloadedSize: 25,
      totalSize: 100,
    });
    expect(onProgress).toHaveBeenNthCalledWith(2, {
      downloadedSize: 100,
      totalSize: 100,
    });
  });

  it("uninstalls an Ollama model via /api/delete", async () => {
    const fetchImpl = vi.fn(async (input, init) => {
      expect(resolveFetchInputUrl(input)).toBe("http://127.0.0.1:11434/api/delete");
      expect(init).toMatchObject({
        method: "DELETE",
      });
      return new Response(null, { status: 200 });
    }) as typeof fetch;

    const removed = await uninstallOllamaLocalModel({
      modelId: "qwen3:8b",
      env: {
        ALISIO_NODE_MODEL_BASE_URL: "http://127.0.0.1:11434",
      } as NodeJS.ProcessEnv,
      fetchImpl,
    });

    expect(removed).toEqual({
      id: "qwen3:8b",
      name: "qwen3:8b",
      ownedBy: "ollama",
    });
  });
});
