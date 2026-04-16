import {
  buildModelAliasIndex,
  type ModelAliasIndex,
  resolveDefaultModelForSession,
} from "../../agents/model-selection.js";
import type { AlisioConfig } from "../../config/config.js";

export function resolveDefaultModel(params: {
  cfg: AlisioConfig;
  agentId?: string;
  sessionKey?: string;
}): {
  defaultProvider: string;
  defaultModel: string;
  aliasIndex: ModelAliasIndex;
} {
  const mainModel = resolveDefaultModelForSession({
    cfg: params.cfg,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });
  const defaultProvider = mainModel.provider;
  const defaultModel = mainModel.model;
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider,
  });
  return { defaultProvider, defaultModel, aliasIndex };
}
