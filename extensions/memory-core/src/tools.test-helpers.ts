import { expect } from "vitest";
import type { AlisioConfig } from "../api.js";
import { createMemoryGetTool, createMemoryGraphTool, createMemorySearchTool } from "./tools.js";

export function asAlisioConfig(config: unknown): AlisioConfig {
  return config as AlisioConfig;
}

export function createDefaultMemoryToolConfig(): AlisioConfig {
  return asAlisioConfig({
    memory: { retrieval: { tracing: { enabled: false } } },
    agents: { list: [{ id: "main", default: true }] },
  });
}

export function createMemorySearchToolOrThrow(params?: {
  config?: AlisioConfig;
  agentSessionKey?: string;
}) {
  const tool = createMemorySearchTool({
    config: params?.config ?? createDefaultMemoryToolConfig(),
    ...(params?.agentSessionKey ? { agentSessionKey: params.agentSessionKey } : {}),
  });
  if (!tool) {
    throw new Error("tool missing");
  }
  return tool;
}

export function createMemoryGetToolOrThrow(config: AlisioConfig = createDefaultMemoryToolConfig()) {
  const tool = createMemoryGetTool({ config });
  if (!tool) {
    throw new Error("tool missing");
  }
  return tool;
}

export function createMemoryGraphToolOrThrow(
  config: AlisioConfig = createDefaultMemoryToolConfig(),
) {
  const tool = createMemoryGraphTool({ config });
  if (!tool) {
    throw new Error("tool missing");
  }
  return tool;
}

export function createAutoCitationsMemorySearchTool(agentSessionKey: string) {
  return createMemorySearchToolOrThrow({
    config: asAlisioConfig({
      memory: { citations: "auto", retrieval: { tracing: { enabled: false } } },
      agents: { list: [{ id: "main", default: true }] },
    }),
    agentSessionKey,
  });
}

export function expectUnavailableMemorySearchDetails(
  details: unknown,
  params: {
    error: string;
    warning: string;
    action: string;
  },
) {
  expect(details).toEqual({
    results: [],
    disabled: true,
    unavailable: true,
    error: params.error,
    warning: params.warning,
    action: params.action,
  });
}
