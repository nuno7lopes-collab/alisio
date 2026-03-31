import {
  complete,
  getModel,
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
} from "@mariozechner/pi-ai";
import { getOAuthApiKey } from "@mariozechner/pi-ai/oauth";
import { Type } from "@sinclair/typebox";
import {
  listProfilesForProvider,
  loadAuthProfileStoreForRuntime,
  resolveApiKeyForProfile,
} from "../../../src/agents/auth-profiles.ts";
import { invokeToolAlias } from "./tool-aliases.js";
import { OPENAI_CODEX_PROVIDER } from "./types.js";
import type {
  ChatTurnParams,
  ChatTurnResult,
  ToolAlias,
  ToolAliasResult,
  TranscriptMessage,
} from "./types.js";

const MAX_TOOL_ROUNDS = 3;
const MODEL_TOOL_NAME = "system_whoami";

const DESKTOP_SYSTEM_PROMPT = [
  "És o assistente local da app Lume.",
  "Responde sempre em português de Portugal, de forma direta.",
  "Tens acesso a um único alias local seguro: system.whoami.",
  "Usa esse alias apenas quando o utilizador pede explicitamente para saber que utilizador de sistema está ativo neste computador.",
  "Se não precisares da ferramenta, responde normalmente.",
].join(" ");

export type ChatEngineDeps = {
  complete?: typeof complete;
  prepareModel?: (params: {
    provider: string;
    modelId: string;
    apiKey?: string;
    openAiCodexAuthProfileId?: string;
  }) => Promise<PreparedChatModel>;
  invokeToolAlias?: (params: { alias: ToolAlias }) => Promise<ToolAliasResult>;
  now?: () => number;
};

export type PreparedChatModel =
  | {
      model: Model<Api>;
      auth: {
        apiKey: string;
        source: string;
        mode: "api-key";
      };
    }
  | {
      error: string;
    };

async function prepareChatModel(params: {
  provider: string;
  modelId: string;
  apiKey?: string;
  openAiCodexAuthProfileId?: string;
}): Promise<PreparedChatModel> {
  if (params.provider === OPENAI_CODEX_PROVIDER) {
    const store = loadAuthProfileStoreForRuntime();
    const profileId =
      params.openAiCodexAuthProfileId ??
      listProfilesForProvider(store, OPENAI_CODEX_PROVIDER).at(0);
    if (!profileId) {
      return {
        error: "OpenAI OAuth ainda não está ligado. Usa o botão de ligação em Settings.",
      };
    }

    const resolvedAuth = await resolveApiKeyForProfile({
      store,
      profileId,
    });
    if (!resolvedAuth?.apiKey) {
      const oauthCred = store.profiles[profileId];
      if (oauthCred?.type !== "oauth") {
        return {
          error: "O perfil OAuth do OpenAI Codex é inválido ou já não existe.",
        };
      }
      const fallback = await getOAuthApiKey(OPENAI_CODEX_PROVIDER, {
        [OPENAI_CODEX_PROVIDER]: oauthCred,
      });
      if (!fallback?.apiKey) {
        return {
          error: "Não foi possível obter um token OAuth válido para OpenAI Codex.",
        };
      }
      const model = getModel(OPENAI_CODEX_PROVIDER, params.modelId as never);
      if (!model) {
        return {
          error: `Modelo OpenAI Codex desconhecido: ${params.modelId}.`,
        };
      }
      return {
        model,
        auth: {
          apiKey: fallback.apiKey,
          source: `auth-profile:${profileId}`,
          mode: "api-key",
        },
      };
    }

    const model = getModel(OPENAI_CODEX_PROVIDER, params.modelId as never);
    if (!model) {
      return {
        error: `Modelo OpenAI Codex desconhecido: ${params.modelId}.`,
      };
    }

    return {
      model,
      auth: {
        apiKey: resolvedAuth.apiKey,
        source: `auth-profile:${profileId}`,
        mode: "api-key",
      },
    };
  }

  if (params.provider !== "openai") {
    return {
      error: `Provider não suportado neste preview: ${params.provider}.`,
    };
  }

  const apiKey = params.apiKey?.trim();
  if (!apiKey) {
    return {
      error: 'No API key resolved for provider "openai" (auth mode: api-key).',
    };
  }

  const model = getModel("openai", params.modelId as never);
  if (!model) {
    return {
      error: `Modelo OpenAI desconhecido: ${params.modelId}.`,
    };
  }

  return {
    model,
    auth: {
      apiKey,
      source: "local-settings",
      mode: "api-key",
    },
  };
}

function createAssistantErrorMessage(message: string, now: number): AssistantMessage {
  return {
    role: "assistant",
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5.4",
    stopReason: "error",
    errorMessage: message,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    timestamp: now,
    content: [
      {
        type: "text",
        text: message,
      },
    ],
  };
}

function withOpenAiApiKey<T>(apiKey: string | undefined, run: () => Promise<T>): Promise<T> {
  const previous = process.env.OPENAI_API_KEY;
  if (apiKey?.trim()) {
    process.env.OPENAI_API_KEY = apiKey.trim();
  } else {
    delete process.env.OPENAI_API_KEY;
  }
  return run().finally(() => {
    if (previous === undefined) {
      delete process.env.OPENAI_API_KEY;
      return;
    }
    process.env.OPENAI_API_KEY = previous;
  });
}

function createToolContext(messages: Message[]): Context {
  return {
    systemPrompt: DESKTOP_SYSTEM_PROMPT,
    messages,
    tools: [
      {
        name: MODEL_TOOL_NAME,
        description:
          "Devolve o utilizador de sistema atual deste computador local. Alias real: system.whoami.",
        parameters: Type.Object({}, { additionalProperties: false }),
      },
    ],
  };
}

function mapToolNameToAlias(name: string): ToolAlias | null {
  if (name === MODEL_TOOL_NAME) {
    return "system.whoami";
  }
  return null;
}

function collectMessageText(message: Message): string {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return message.content.trim();
    }
    return message.content
      .filter((item) => item.type === "text")
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join("\n");
  }

  if (message.role === "toolResult") {
    return message.content
      .filter((item) => item.type === "text")
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join("\n");
  }

  return message.content
    .filter((item) => item.type === "text")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n");
}

export function buildTranscript(messages: Message[]): TranscriptMessage[] {
  const transcript: TranscriptMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text = collectMessageText(message);
      if (!text) {
        continue;
      }
      transcript.push({
        id: `user-${message.timestamp}`,
        role: "user",
        text,
        createdAt: message.timestamp,
      });
      continue;
    }

    if (message.role === "assistant") {
      const text = collectMessageText(message);
      if (text) {
        transcript.push({
          id: `assistant-${message.timestamp}`,
          role: "assistant",
          text,
          createdAt: message.timestamp,
          isError: message.stopReason === "error",
        });
      }
      for (const block of message.content) {
        if (block.type !== "toolCall") {
          continue;
        }
        const alias = mapToolNameToAlias(block.name);
        transcript.push({
          id: `toolcall-${block.id}`,
          role: "system",
          text: alias ? `A executar ${alias}` : `A executar ${block.name}`,
          createdAt: message.timestamp,
          toolAlias: alias ?? undefined,
        });
      }
      continue;
    }

    const text = collectMessageText(message);
    if (!text) {
      continue;
    }
    transcript.push({
      id: `tool-${message.toolCallId}-${message.timestamp}`,
      role: "tool",
      text,
      createdAt: message.timestamp,
      toolAlias: message.toolName === MODEL_TOOL_NAME ? "system.whoami" : undefined,
      isError: message.isError,
    });
  }
  return transcript;
}

export async function runChatTurn(
  params: ChatTurnParams,
  deps: ChatEngineDeps = {},
): Promise<ChatTurnResult> {
  const completeFn = deps.complete ?? complete;
  const prepareModel = deps.prepareModel ?? ((modelParams) => prepareChatModel(modelParams));
  const invokeAlias = deps.invokeToolAlias ?? ((toolParams) => invokeToolAlias(toolParams));
  const now = deps.now ?? Date.now;
  const messageText = params.content.trim();
  const baseMessages = [...params.conversation.messages];
  const userMessage: Message = {
    role: "user",
    content: messageText,
    timestamp: now(),
  };
  baseMessages.push(userMessage);

  const prepared = await withOpenAiApiKey(params.settings.openAiApiKey, async () =>
    prepareModel({
      provider: params.settings.provider,
      modelId: params.settings.model,
      apiKey: params.settings.openAiApiKey,
      openAiCodexAuthProfileId: params.settings.openAiCodexAuthProfileId,
    }),
  );

  if ("error" in prepared) {
    const failure = createAssistantErrorMessage(prepared.error, now());
    const nextMessages = [...baseMessages, failure];
    return {
      conversation: { messages: nextMessages },
      transcript: buildTranscript(nextMessages),
    };
  }

  let workingMessages = [...baseMessages];
  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    const completeOptions =
      params.settings.provider === OPENAI_CODEX_PROVIDER
        ? {
            apiKey: prepared.auth.apiKey,
            maxTokens: 900,
          }
        : {
            apiKey: prepared.auth.apiKey,
            temperature: 0.2,
            maxTokens: 900,
          };
    const assistantReply = await withOpenAiApiKey(params.settings.openAiApiKey, async () =>
      completeFn(prepared.model, createToolContext(workingMessages), completeOptions),
    );
    workingMessages.push(assistantReply);

    const toolCalls = assistantReply.content.filter((block) => block.type === "toolCall");
    if (toolCalls.length === 0) {
      return {
        conversation: { messages: workingMessages },
        transcript: buildTranscript(workingMessages),
      };
    }

    for (const toolCall of toolCalls) {
      const alias = mapToolNameToAlias(toolCall.name);
      const toolResult = alias
        ? await invokeAlias({ alias })
        : {
            alias: "system.whoami",
            output: `Ferramenta não suportada: ${toolCall.name}`,
            exitCode: 1,
            isError: true,
          };
      workingMessages.push({
        role: "toolResult",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [
          {
            type: "text",
            text: toolResult.output,
          },
        ],
        isError: toolResult.isError,
        timestamp: now(),
        details: {
          alias: toolResult.alias,
          exitCode: toolResult.exitCode,
        },
      });
    }

    rounds += 1;
  }

  const exhausted = createAssistantErrorMessage(
    "A conversa excedeu o limite de iterações locais.",
    now(),
  );
  workingMessages.push(exhausted);
  return {
    conversation: { messages: workingMessages },
    transcript: buildTranscript(workingMessages),
  };
}
