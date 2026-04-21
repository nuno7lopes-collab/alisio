import { resolveHeartbeatPrompt as resolveHeartbeatPromptText } from "../auto-reply/heartbeat.js";
import type { AlisioConfig } from "../config/config.js";
import type { AgentDefaultsConfig } from "../config/types.agent-defaults.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveAgentConfig, resolveDefaultAgentId } from "./agent-scope.js";

type HeartbeatConfig = AgentDefaultsConfig["heartbeat"];

export function hasExplicitHeartbeatAgents(cfg: AlisioConfig): boolean {
  const list = cfg.agents?.list ?? [];
  return list.some((entry) => Boolean(entry?.heartbeat));
}

export function resolveHeartbeatConfigForAgent(params: {
  cfg: AlisioConfig;
  agentId?: string;
}): HeartbeatConfig | undefined {
  const defaults = params.cfg.agents?.defaults?.heartbeat;
  const resolvedAgentId = normalizeAgentId(params.agentId ?? resolveDefaultAgentId(params.cfg));
  const overrides = resolveAgentConfig(params.cfg, resolvedAgentId)?.heartbeat;
  if (!defaults && !overrides) {
    return undefined;
  }
  return {
    ...defaults,
    ...overrides,
  };
}

export function isHeartbeatEnabledForAgent(params: {
  cfg: AlisioConfig;
  agentId?: string;
}): boolean {
  const resolvedAgentId = normalizeAgentId(params.agentId ?? resolveDefaultAgentId(params.cfg));
  const list = params.cfg.agents?.list ?? [];
  if (hasExplicitHeartbeatAgents(params.cfg)) {
    return list.some(
      (entry) => Boolean(entry?.heartbeat) && normalizeAgentId(entry?.id) === resolvedAgentId,
    );
  }
  return resolvedAgentId === resolveDefaultAgentId(params.cfg);
}

export function resolveHeartbeatPromptForAgent(params: {
  cfg: AlisioConfig;
  agentId?: string;
}): string {
  const heartbeat = resolveHeartbeatConfigForAgent(params);
  return resolveHeartbeatPromptText(heartbeat?.prompt);
}
