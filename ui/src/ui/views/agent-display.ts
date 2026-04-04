import { DEFAULT_AGENT_ID } from "../../../../src/routing/session-key.js";

export type AgentDisplayOptions = {
  assistantName?: string | null;
  assistantAgentId?: string | null;
  primaryAgentId?: string | null;
};

type AgentDisplayInput = {
  id: string;
  name?: string;
};

export function resolvePrimaryAssistantAgentId(options: AgentDisplayOptions): string {
  const explicitPrimaryId = options.primaryAgentId?.trim();
  if (explicitPrimaryId) {
    return explicitPrimaryId;
  }
  const explicitId = options.assistantAgentId?.trim();
  return explicitId || DEFAULT_AGENT_ID;
}

export function resolveAgentDisplayLabel(
  agent: AgentDisplayInput,
  options: AgentDisplayOptions,
): string {
  const agentId = agent.id.trim();
  const explicitName = agent.name?.trim() || "";
  if (agentId === resolvePrimaryAssistantAgentId(options)) {
    return options.assistantName?.trim() || explicitName || agentId;
  }
  if (explicitName && explicitName !== agentId) {
    return `${explicitName} (${agentId})`;
  }
  return explicitName || agentId;
}

export function resolveAgentIdDisplayLabel(
  agentId: string | null | undefined,
  options: AgentDisplayOptions,
): string | null {
  const normalized = typeof agentId === "string" ? agentId.trim() : "";
  if (!normalized) {
    return null;
  }
  return resolveAgentDisplayLabel({ id: normalized }, options);
}
