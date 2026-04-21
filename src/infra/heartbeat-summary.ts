import {
  isHeartbeatEnabledForAgent as isHeartbeatEnabledForAgentImpl,
  resolveHeartbeatConfigForAgent,
} from "../agents/heartbeat-config.js";
import {
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_EVERY,
  resolveHeartbeatPrompt as resolveHeartbeatPromptText,
} from "../auto-reply/heartbeat.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import type { AlisioConfig } from "../config/config.js";
import type { AgentDefaultsConfig } from "../config/types.agent-defaults.js";

type HeartbeatConfig = AgentDefaultsConfig["heartbeat"];

export function isHeartbeatEnabledForAgent(cfg: AlisioConfig, agentId?: string): boolean {
  return isHeartbeatEnabledForAgentImpl({ cfg, agentId });
}

export type HeartbeatSummary = {
  enabled: boolean;
  every: string;
  everyMs: number | null;
  prompt: string;
  target: string;
  model?: string;
  ackMaxChars: number;
};

const DEFAULT_HEARTBEAT_TARGET = "none";

export function resolveHeartbeatIntervalMs(
  cfg: AlisioConfig,
  overrideEvery?: string,
  heartbeat?: HeartbeatConfig,
) {
  const raw =
    overrideEvery ??
    heartbeat?.every ??
    cfg.agents?.defaults?.heartbeat?.every ??
    DEFAULT_HEARTBEAT_EVERY;
  if (!raw) {
    return null;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return null;
  }
  let ms: number;
  try {
    ms = parseDurationMs(trimmed, { defaultUnit: "m" });
  } catch {
    return null;
  }
  if (ms <= 0) {
    return null;
  }
  return ms;
}

export function resolveHeartbeatSummaryForAgent(
  cfg: AlisioConfig,
  agentId?: string,
): HeartbeatSummary {
  const defaults = cfg.agents?.defaults?.heartbeat;
  const merged = resolveHeartbeatConfigForAgent({ cfg, agentId });
  const enabled = isHeartbeatEnabledForAgent(cfg, agentId);

  if (!enabled) {
    return {
      enabled: false,
      every: "disabled",
      everyMs: null,
      prompt: resolveHeartbeatPromptText(merged?.prompt ?? defaults?.prompt),
      target: defaults?.target ?? DEFAULT_HEARTBEAT_TARGET,
      model: defaults?.model,
      ackMaxChars: Math.max(0, defaults?.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS),
    };
  }

  const every = merged?.every ?? DEFAULT_HEARTBEAT_EVERY;
  const everyMs = resolveHeartbeatIntervalMs(cfg, undefined, merged);
  const prompt = resolveHeartbeatPromptText(merged?.prompt);
  const target = merged?.target ?? DEFAULT_HEARTBEAT_TARGET;
  const model = merged?.model;
  const ackMaxChars = Math.max(0, merged?.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS);

  return {
    enabled: true,
    every,
    everyMs,
    prompt,
    target,
    model,
    ackMaxChars,
  };
}
