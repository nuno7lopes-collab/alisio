import { html } from "lit";
import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  AgentFileEntry,
  AlisioAiState,
  AgentsFilesListResult,
  AgentsListResult,
  ConfigUiHints,
  MemoryGraphState,
  MemoryStatusState,
} from "../types.ts";
import { renderLegacyMemoryEditor } from "./memory-legacy.ts";
import "./memory-native-hub.ts";

export type MemoryHubProps = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  aiState: AlisioAiState | null;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  memoryLoading: boolean;
  memoryError: string | null;
  memoryList: AgentsFilesListResult | null;
  memoryActive: string | null;
  memoryContents: Record<string, string>;
  memoryDrafts: Record<string, string>;
  memorySaving: boolean;
  memoryDeleting: boolean;
  memoryStatusLoading: boolean;
  memoryStatusError: string | null;
  memoryStatus: MemoryStatusState | null;
  memorySyncing: boolean;
  memorySyncAvailable: boolean;
  memoryGraphLoading: boolean;
  memoryGraphError: string | null;
  memoryGraph: MemoryGraphState | null;
  memoryGraphQuery: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  configSchema: unknown;
  configUiHints: ConfigUiHints;
  configForm: Record<string, unknown> | null;
  searchQuery: string;
  composerOpen: boolean;
  composerDate: string;
  composerTitle: string;
  onSelectAgent: (agentId: string) => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onSelectFile: (name: string) => void;
  onDraftChange: (name: string, content: string) => void;
  onResetFile: (name: string) => void;
  onSaveFile: (name: string) => void;
  onDeleteFile: (name: string) => void;
  onComposerOpenChange: (open: boolean) => void;
  onComposerDateChange: (value: string) => void;
  onComposerTitleChange: (value: string) => void;
  onCreateNote: () => void;
  onSync: () => void;
  onConfigPatch: (path: Array<string | number>, value: unknown) => void;
  onSaveSettings: () => void;
  onUseLocalEmbeddings: () => void;
};

function readNestedValue(
  record: Record<string, unknown> | null | undefined,
  path: readonly string[],
): unknown {
  let current: unknown = record;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function readMemoryUiFlag(
  record: Record<string, unknown> | null | undefined,
  path: readonly string[],
  fallback: boolean,
) {
  const value = readNestedValue(record, path);
  return typeof value === "boolean" ? value : fallback;
}

export function renderMemoryHub(props: MemoryHubProps) {
  const newViewsEnabled = readMemoryUiFlag(
    props.configForm,
    ["ui", "memory", "newViews", "enabled"],
    true,
  );
  if (!newViewsEnabled) {
    return renderLegacyMemoryEditor(props);
  }
  return html`<alisio-memory-native-hub .props=${props}></alisio-memory-native-hub>`;
}

export type { AgentFileEntry };
