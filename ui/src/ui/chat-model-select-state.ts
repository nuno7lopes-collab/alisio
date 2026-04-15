import type { AppViewState } from "./app-view-state.ts";
import {
  buildChatModelOption,
  formatChatModelDisplay,
  normalizeChatModelOverrideValue,
  resolvePreferredServerChatModelValue,
} from "./chat-model-ref.ts";
import type { ModelCatalogEntry } from "./types.ts";

type ChatModelSelectStateInput = Pick<
  AppViewState,
  "sessionKey" | "chatModelOverrides" | "chatModelCatalog" | "sessionsResult"
>;

export type ChatModelSelectOption = {
  value: string;
  label: string;
};

export type ChatModelSelectState = {
  currentOverride: string;
  defaultModel: string;
  defaultDisplay: string;
  defaultLabel: string;
  options: ChatModelSelectOption[];
};

function resolveCatalogModelLabel(catalog: ModelCatalogEntry[], value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  for (const entry of catalog) {
    const option = buildChatModelOption(entry);
    if (option.value.trim().toLowerCase() === trimmed) {
      return option.label;
    }
  }
  return null;
}

function resolveActiveSessionRow(state: ChatModelSelectStateInput) {
  return state.sessionsResult?.sessions?.find((row) => row.key === state.sessionKey);
}

export function resolveChatModelOverrideValue(state: ChatModelSelectStateInput): string {
  const catalog = state.chatModelCatalog ?? [];

  // Prefer the local cache — it reflects in-flight patches before sessionsResult refreshes.
  const cached = state.chatModelOverrides[state.sessionKey];
  if (cached) {
    return normalizeChatModelOverrideValue(cached, catalog);
  }
  if (cached === null) {
    return "";
  }

  const activeRow = resolveActiveSessionRow(state);
  return resolvePreferredServerChatModelValue(
    activeRow?.modelOverride,
    activeRow?.providerOverride,
    catalog,
  );
}

function resolveDefaultModelValue(state: ChatModelSelectStateInput): string {
  return resolvePreferredServerChatModelValue(
    state.sessionsResult?.defaults?.model,
    state.sessionsResult?.defaults?.modelProvider,
    state.chatModelCatalog ?? [],
  );
}

export function buildChatModelOptions(
  catalog: ModelCatalogEntry[],
  extraValues: string[] = [],
  excludeValues: string[] = [],
): ChatModelSelectOption[] {
  const seen = new Set<string>();
  const excluded = new Set(
    excludeValues.map((value) => value.trim().toLowerCase()).filter((value) => value.length > 0),
  );
  const options: ChatModelSelectOption[] = [];

  const addOption = (value: string, label?: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const key = trimmed.toLowerCase();
    if (excluded.has(key)) {
      return;
    }
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    options.push({ value: trimmed, label: label ?? trimmed });
  };

  for (const entry of catalog) {
    const option = buildChatModelOption(entry);
    addOption(option.value, option.label);
  }

  for (const value of extraValues) {
    addOption(value);
  }
  return options;
}

export function resolveChatModelSelectState(
  state: ChatModelSelectStateInput,
): ChatModelSelectState {
  const currentOverride = resolveChatModelOverrideValue(state);
  const defaultModel = resolveDefaultModelValue(state);
  const catalog = state.chatModelCatalog ?? [];
  const defaultDisplay =
    resolveCatalogModelLabel(catalog, defaultModel) ?? formatChatModelDisplay(defaultModel);

  return {
    currentOverride,
    defaultModel,
    defaultDisplay,
    defaultLabel: defaultModel ? `Default (${defaultDisplay})` : "Default model",
    options: buildChatModelOptions(catalog, [currentOverride], [defaultModel]),
  };
}
