import { html } from "lit";
import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  AlisioAiState,
  AgentsListResult,
  MemoryGraphState,
  MemoryStatusState,
} from "../types.ts";
import "./memory-native-hub.ts";

export type MemoryHubProps = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  aiState: AlisioAiState | null;
  agentsLoading: boolean;
  agentsError: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  memoryStatusLoading: boolean;
  memoryStatusError: string | null;
  memoryStatus: MemoryStatusState | null;
  memoryGraphLoading: boolean;
  memoryGraphError: string | null;
  memoryGraph: MemoryGraphState | null;
  searchQuery: string;
  onSelectAgent: (agentId: string) => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
};

export function renderMemoryHub(props: MemoryHubProps) {
  return html`<alisio-memory-native-hub .props=${props}></alisio-memory-native-hub>`;
}
