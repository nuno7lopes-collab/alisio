import type { StreamFn } from "@mariozechner/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Message,
  type Model,
} from "@mariozechner/pi-ai";
import { resolveAlisioDynamicProviderSource } from "../infra/alisio-model-providers.js";
import { resolveAlisioProviderAdapter } from "../provider-adapters/alisio-provider-adapters.js";
import {
  normalizeProviderAdapterError,
  type ProviderAdapter,
  type ProviderAdapterMessage,
  type ProviderAdapterRequest,
} from "../provider-adapters/provider-adapter.js";
import {
  buildAssistantMessageWithZeroUsage,
  buildStreamErrorAssistantMessage,
} from "./stream-message-shared.js";

type StreamModel = Parameters<StreamFn>[0];
type StreamContext = Parameters<StreamFn>[1];
type StreamOptions = Parameters<StreamFn>[2];

function extractTextFromUnknownContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const text =
          typeof (entry as { text?: unknown }).text === "string"
            ? (entry as { text: string }).text
            : typeof (entry as { thinking?: unknown }).thinking === "string"
              ? (entry as { thinking: string }).thinking
              : typeof (entry as { content?: unknown }).content === "string"
                ? (entry as { content: string }).content
                : "";
        return text.trim();
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  if (content && typeof content === "object") {
    const text =
      typeof (content as { text?: unknown }).text === "string"
        ? (content as { text: string }).text
        : typeof (content as { content?: unknown }).content === "string"
          ? (content as { content: string }).content
          : "";
    return text.trim();
  }
  return "";
}

function summarizeToolResult(message: Extract<Message, { role: "toolResult" }>): string {
  const prefix = message.isError ? "Erro da ferramenta" : "Resultado da ferramenta";
  const body = extractTextFromUnknownContent(message.content);
  if (!body) {
    return `${prefix} ${message.toolName}.`;
  }
  return `${prefix} ${message.toolName}:\n${body}`;
}

function summarizeAssistantMessage(message: Extract<Message, { role: "assistant" }>): string {
  const chunks: string[] = [];
  for (const block of message.content) {
    if (block.type === "text" && block.text.trim()) {
      chunks.push(block.text.trim());
      continue;
    }
    if (block.type === "thinking" && block.thinking.trim()) {
      chunks.push(block.thinking.trim());
      continue;
    }
    if (block.type === "toolCall") {
      const args = Object.keys(block.arguments ?? {}).length
        ? ` ${JSON.stringify(block.arguments)}`
        : "";
      chunks.push(`Ferramenta ${block.name}${args}`);
    }
  }
  return chunks.join("\n\n").trim();
}

function buildRuntimeMessages(context: StreamContext): ProviderAdapterMessage[] {
  const messages: ProviderAdapterMessage[] = [];
  const systemPrompt = context.systemPrompt?.trim();
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  for (const message of context.messages) {
    if (message.role === "user") {
      const text = extractTextFromUnknownContent(message.content);
      if (text) {
        messages.push({ role: "user", content: text });
      }
      continue;
    }
    if (message.role === "assistant") {
      const text = summarizeAssistantMessage(message);
      if (text) {
        messages.push({ role: "assistant", content: text });
      }
      continue;
    }
    if (message.role === "toolResult") {
      const text = summarizeToolResult(message);
      if (text) {
        messages.push({ role: "user", content: text });
      }
    }
  }
  return messages;
}

function buildProviderAdapterRequest(params: {
  model: StreamModel;
  context: StreamContext;
  options?: StreamOptions;
}): ProviderAdapterRequest {
  return {
    model: {
      id: params.model.id,
      api: params.model.api,
      provider: params.model.provider,
    },
    messages: buildRuntimeMessages(params.context),
    signal: params.options?.signal,
    ...(typeof params.options?.temperature === "number"
      ? { temperature: params.options.temperature }
      : {}),
    ...(typeof params.options?.maxTokens === "number"
      ? { maxTokens: params.options.maxTokens }
      : {}),
  };
}

function buildStreamStart(model: StreamModel): AssistantMessage {
  return buildAssistantMessageWithZeroUsage({
    model: {
      api: model.api,
      provider: model.provider,
      id: model.id,
    },
    content: [],
    stopReason: "stop",
  });
}

function beginProviderAdapterStream(params: {
  model: StreamModel;
  adapter: ProviderAdapter;
  request: ProviderAdapterRequest;
}): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(async () => {
    const partial = buildStreamStart(params.model);
    stream.push({ type: "start", partial });
    let streamedText = "";
    let contentIndex: number | null = null;
    const pushText = (chunk: string) => {
      if (!chunk) {
        return;
      }
      if (contentIndex === null) {
        partial.content.push({ type: "text", text: "" });
        contentIndex = partial.content.length - 1;
        stream.push({ type: "text_start", contentIndex, partial });
      }
      streamedText += chunk;
      const content = partial.content[contentIndex];
      if (content?.type === "text") {
        content.text = streamedText;
      }
      stream.push({ type: "text_delta", contentIndex, delta: chunk, partial });
    };

    try {
      const result = await params.adapter.stream(params.request, async (event) => {
        if (event.type === "text-delta") {
          pushText(event.text);
        }
      });
      const stopReason = result.stopReason;
      const finalText = streamedText || result.text;
      if (!streamedText && result.text) {
        pushText(result.text);
      }
      if (contentIndex !== null) {
        stream.push({ type: "text_end", contentIndex, content: finalText, partial });
      }
      stream.push({
        type: "done",
        reason: stopReason,
        message: buildAssistantMessageWithZeroUsage({
          model: {
            api: params.model.api,
            provider: params.model.provider,
            id: params.model.id,
          },
          content: finalText ? [{ type: "text", text: finalText }] : [],
          stopReason,
        }),
      });
      stream.end();
    } catch (error) {
      const normalized = normalizeProviderAdapterError(error, {
        sourceLabel: params.adapter.sourceLabel,
      });
      stream.push({
        type: "error",
        reason: normalized.code === "aborted" ? "aborted" : "error",
        error: buildStreamErrorAssistantMessage({
          model: {
            api: params.model.api,
            provider: params.model.provider,
            id: params.model.id,
          },
          errorMessage: normalized.message,
        }),
      });
      stream.end();
    }
  });
  return stream;
}

export async function resolveAlisioProviderStream(
  model: Model<string>,
  context: StreamContext,
  options?: StreamOptions,
): Promise<AssistantMessageEventStream | undefined> {
  const source = resolveAlisioDynamicProviderSource(model.provider);
  if (!source) {
    return undefined;
  }

  return beginProviderAdapterStream({
    model,
    adapter: resolveAlisioProviderAdapter(source),
    request: buildProviderAdapterRequest({
      model,
      context,
      options,
    }),
  });
}
