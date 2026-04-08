import type { StreamFn } from "@mariozechner/pi-agent-core";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Message,
  type Model,
} from "@mariozechner/pi-ai";
import { chatWithInstalledAlisioLocalModel } from "../infra/alisio-local-llama-runtime.js";
import {
  resolveAlisioDynamicProviderSource,
  type AlisioDynamicProviderSource,
} from "../infra/alisio-model-providers.js";
import { fetchOpenAiCompatibleEndpoint } from "../shared/openai-compatible-endpoints.js";
import { CUSTOM_LOCAL_AUTH_MARKER } from "./model-auth-markers.js";
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

function buildRuntimeMessages(
  context: StreamContext,
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
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

function isSyntheticNoAuthKey(apiKey: string | undefined): boolean {
  return !apiKey?.trim() || apiKey.trim() === CUSTOM_LOCAL_AUTH_MARKER;
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

function beginTextStream(params: {
  model: StreamModel;
  run: (helpers: { pushText: (chunk: string) => void }) => Promise<string>;
}): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(async () => {
    const partial = buildStreamStart(params.model);
    stream.push({ type: "start", partial });
    let text = "";
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
      text += chunk;
      const content = partial.content[contentIndex];
      if (content?.type === "text") {
        content.text = text;
      }
      stream.push({ type: "text_delta", contentIndex, delta: chunk, partial });
    };
    try {
      const finalText = await params.run({ pushText });
      if (finalText && finalText !== text) {
        pushText(finalText.slice(text.length));
      }
      if (contentIndex !== null) {
        stream.push({ type: "text_end", contentIndex, content: text, partial });
      }
      stream.push({
        type: "done",
        reason: "stop",
        message: buildAssistantMessageWithZeroUsage({
          model: {
            api: params.model.api,
            provider: params.model.provider,
            id: params.model.id,
          },
          content: text ? [{ type: "text", text }] : [],
          stopReason: "stop",
        }),
      });
      stream.end();
    } catch (error) {
      stream.push({
        type: "error",
        reason:
          params.model && (error as { name?: string })?.name === "AbortError" ? "aborted" : "error",
        error: buildStreamErrorAssistantMessage({
          model: {
            api: params.model.api,
            provider: params.model.provider,
            id: params.model.id,
          },
          errorMessage: String(error),
        }),
      });
      stream.end();
    }
  });
  return stream;
}

function resolveOllamaChatUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  return normalized.toLowerCase().endsWith("/api")
    ? `${normalized}/chat`
    : `${normalized}/api/chat`;
}

function resolveOpenAiDeltaText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  if (typeof (payload as { text?: unknown }).text === "string") {
    return (payload as { text: string }).text;
  }
  const choices = Array.isArray((payload as { choices?: unknown[] }).choices)
    ? ((payload as { choices?: unknown[] }).choices ?? [])
    : [];
  return choices
    .map((choice) => {
      if (!choice || typeof choice !== "object") {
        return "";
      }
      return typeof (choice as { delta?: { content?: unknown } }).delta?.content === "string"
        ? ((choice as { delta: { content: string } }).delta.content ?? "")
        : "";
    })
    .join("");
}

async function streamOpenAiCompatibleSource(params: {
  model: StreamModel;
  source: Extract<AlisioDynamicProviderSource, { kind: "current-openai" | "server-openai" }>;
  context: StreamContext;
  options?: StreamOptions;
}): Promise<AssistantMessageEventStream> {
  const sourceLabel =
    params.source.kind === "current-openai"
      ? "local OpenAI-compatible runtime"
      : "remote OpenAI-compatible server";
  return beginTextStream({
    model: params.model,
    run: async ({ pushText }) => {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      const apiKey = !isSyntheticNoAuthKey(params.options?.apiKey)
        ? params.options?.apiKey?.trim()
        : params.source.apiKey?.trim();
      if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
      }
      const response = await fetchOpenAiCompatibleEndpoint({
        baseUrl: params.source.baseUrl,
        endpoint: "chat/completions",
        init: {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: params.model.id,
            messages: buildRuntimeMessages(params.context),
            stream: true,
            ...(typeof params.options?.temperature === "number"
              ? { temperature: params.options.temperature }
              : {}),
            ...(typeof params.options?.maxTokens === "number"
              ? { max_tokens: params.options.maxTokens }
              : {}),
          }),
          signal: params.options?.signal,
        },
      });
      if (!response.ok) {
        const message = await response.text().catch(() => response.statusText);
        throw new Error(
          `${sourceLabel} request failed (${response.status}): ${message || response.statusText}`,
        );
      }
      if (!response.body) {
        throw new Error(`${sourceLabel} returned no body`);
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("text/event-stream")) {
        const payload: unknown = await response.json();
        const text =
          payload &&
          typeof payload === "object" &&
          typeof (payload as { text?: unknown }).text === "string"
            ? ((payload as { text: string }).text ?? "")
            : "";
        return text.trim();
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const normalized = buffer.replace(/\r\n/g, "\n");
        const events = normalized.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const data = event
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("\n");
          if (!data || data === "[DONE]") {
            continue;
          }
          let payload: unknown;
          try {
            payload = JSON.parse(data) as unknown;
          } catch {
            payload = { raw: data };
          }
          const delta = resolveOpenAiDeltaText(payload);
          if (delta) {
            text += delta;
            pushText(delta);
          }
        }
        if (done) {
          break;
        }
      }
      return text;
    },
  });
}

async function streamOllamaSource(params: {
  model: StreamModel;
  source: Extract<AlisioDynamicProviderSource, { kind: "server-ollama" }>;
  context: StreamContext;
  options?: StreamOptions;
}): Promise<AssistantMessageEventStream> {
  return beginTextStream({
    model: params.model,
    run: async ({ pushText }) => {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      const apiKey = !isSyntheticNoAuthKey(params.options?.apiKey)
        ? params.options?.apiKey?.trim()
        : params.source.apiKey?.trim();
      if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
      }
      const response = await fetch(resolveOllamaChatUrl(params.source.baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: params.model.id,
          messages: buildRuntimeMessages(params.context),
          stream: true,
          options: {
            ...(typeof params.options?.temperature === "number"
              ? { temperature: params.options.temperature }
              : {}),
            ...(typeof params.options?.maxTokens === "number"
              ? { num_predict: params.options.maxTokens }
              : {}),
          },
        }),
        signal: params.options?.signal,
      });
      if (!response.ok) {
        const message = await response.text().catch(() => response.statusText);
        throw new Error(
          `remote Ollama server request failed (${response.status}): ${message || response.statusText}`,
        );
      }
      if (!response.body) {
        throw new Error("remote Ollama server returned no body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }
          const payload = JSON.parse(trimmed) as {
            done?: boolean;
            message?: {
              content?: string;
            };
          };
          const delta = payload.message?.content?.trim() ? payload.message.content : "";
          if (delta) {
            text += delta;
            pushText(delta);
          }
        }
        if (done) {
          break;
        }
      }
      return text;
    },
  });
}

function resolveNodeTaskText(payload: unknown): string {
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

async function streamNodeSource(params: {
  model: StreamModel;
  source: Extract<AlisioDynamicProviderSource, { kind: "node-llama" | "node-openai" }>;
  context: StreamContext;
  options?: StreamOptions;
}): Promise<AssistantMessageEventStream> {
  return beginTextStream({
    model: params.model,
    run: async ({ pushText }) => {
      const result = await params.source.runTask({
        timeoutMs: 120_000,
        input: {
          model: params.model.id,
          messages: buildRuntimeMessages(params.context),
          ...(typeof params.options?.temperature === "number"
            ? { temperature: params.options.temperature }
            : {}),
          ...(typeof params.options?.maxTokens === "number"
            ? { maxTokens: params.options.maxTokens, max_tokens: params.options.maxTokens }
            : {}),
        },
        onEvent: (event) => {
          if (event.kind !== "delta") {
            return;
          }
          const delta = resolveOpenAiDeltaText(event.payload) || resolveNodeTaskText(event.payload);
          if (delta) {
            pushText(delta);
          }
        },
      });
      if (!result.ok) {
        throw new Error(result.error?.message ?? "remote model task failed");
      }
      return resolveNodeTaskText(result.payload);
    },
  });
}

async function streamCurrentLlamaSource(params: {
  model: StreamModel;
  source: Extract<AlisioDynamicProviderSource, { kind: "current-llama" }>;
  context: StreamContext;
  options?: StreamOptions;
}): Promise<AssistantMessageEventStream> {
  void params.source;
  return beginTextStream({
    model: params.model,
    run: async ({ pushText }) => {
      const result = await chatWithInstalledAlisioLocalModel({
        modelId: params.model.id,
        messages: buildRuntimeMessages(params.context),
        signal: params.options?.signal,
        maxTokens:
          typeof params.options?.maxTokens === "number" ? params.options.maxTokens : undefined,
        temperature:
          typeof params.options?.temperature === "number" ? params.options.temperature : undefined,
        onTextChunk: async (chunk) => {
          pushText(chunk);
        },
      });
      return result.text;
    },
  });
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
  if (source.kind === "current-llama") {
    return await streamCurrentLlamaSource({
      model,
      source,
      context,
      options,
    });
  }
  if (source.kind === "current-openai") {
    return await streamOpenAiCompatibleSource({
      model,
      source,
      context,
      options,
    });
  }
  if (source.kind === "node-llama" || source.kind === "node-openai") {
    return await streamNodeSource({
      model,
      source,
      context,
      options,
    });
  }
  if (source.kind === "server-openai") {
    return await streamOpenAiCompatibleSource({
      model,
      source,
      context,
      options,
    });
  }
  if (source.kind === "server-ollama") {
    return await streamOllamaSource({
      model,
      source,
      context,
      options,
    });
  }
  return undefined;
}
