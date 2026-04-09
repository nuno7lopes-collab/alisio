import { chatWithInstalledAlisioLocalModel } from "../infra/alisio-local-llama-runtime.js";
import type { AlisioDynamicProviderSource } from "../infra/alisio-model-providers.js";
import {
  type ProviderAdapter,
  type ProviderAdapterRequest,
  type ProviderAdapterResponse,
  type ProviderAdapterStreamEmitter,
  ProviderAdapterError,
  normalizeProviderAdapterError,
} from "./provider-adapter.js";

function resolveTaskText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  if (typeof (payload as { text?: unknown }).text === "string") {
    return (payload as { text: string }).text;
  }
  if (typeof (payload as { response?: { text?: unknown } }).response?.text === "string") {
    return (payload as { response: { text: string } }).response.text;
  }
  return "";
}

function createNodeTaskAdapter(
  source: Extract<AlisioDynamicProviderSource, { kind: "linked-node" }>,
): ProviderAdapter {
  const sourceLabel = "linked device runtime";
  return {
    id: source.providerId,
    sourceLabel,
    async stream(
      request: ProviderAdapterRequest,
      emit: ProviderAdapterStreamEmitter,
    ): Promise<ProviderAdapterResponse> {
      try {
        const result = await source.runTask({
          timeoutMs: 120_000,
          input: {
            model: request.model.id,
            messages: request.messages,
            ...(typeof request.temperature === "number"
              ? { temperature: request.temperature }
              : {}),
            ...(typeof request.maxTokens === "number"
              ? { maxTokens: request.maxTokens, max_tokens: request.maxTokens }
              : {}),
          },
          onEvent: (event) => {
            if (event.kind !== "delta") {
              return;
            }
            const delta = resolveTaskText(event.payload);
            if (delta) {
              void Promise.resolve(emit({ type: "text-delta", text: delta }));
            }
          },
        });
        if (!result.ok) {
          throw new ProviderAdapterError({
            code: "upstream",
            sourceLabel,
            message: result.error?.message ?? "linked device request failed",
          });
        }
        return {
          text: resolveTaskText(result.payload),
          stopReason: "stop",
        };
      } catch (error) {
        throw normalizeProviderAdapterError(error, {
          sourceLabel,
          fallbackCode: "upstream",
        });
      }
    },
  };
}

function createManagedLocalAdapter(
  source: Extract<AlisioDynamicProviderSource, { kind: "managed-local" }>,
): ProviderAdapter {
  const sourceLabel = "local managed runtime";
  return {
    id: source.providerId,
    sourceLabel,
    async stream(
      request: ProviderAdapterRequest,
      emit: ProviderAdapterStreamEmitter,
    ): Promise<ProviderAdapterResponse> {
      try {
        const result = await chatWithInstalledAlisioLocalModel({
          modelId: request.model.id,
          messages: request.messages,
          signal: request.signal,
          maxTokens: request.maxTokens,
          temperature: request.temperature,
          onTextChunk: async (chunk) => {
            await emit({ type: "text-delta", text: chunk });
          },
        });
        return {
          text: result.text,
          stopReason: "stop",
        };
      } catch (error) {
        throw normalizeProviderAdapterError(error, {
          sourceLabel,
          fallbackCode: "upstream",
        });
      }
    },
  };
}

export function resolveAlisioProviderAdapter(source: AlisioDynamicProviderSource): ProviderAdapter {
  if (source.kind === "managed-local") {
    return createManagedLocalAdapter(source);
  }
  return createNodeTaskAdapter(source);
}
