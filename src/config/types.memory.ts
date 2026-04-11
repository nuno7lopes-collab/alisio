import type { SessionSendPolicyConfig } from "./types.base.js";

export type MemoryBackend = "builtin" | "qmd";
export type MemoryCitationsMode = "auto" | "on" | "off";
export type MemoryQmdSearchMode = "query" | "search" | "vsearch";
export type MemorySyncMode = "cloud" | "direct" | "off";

export type MemorySyncDirectConfig = {
  /** Optional direct transport flag. Defaults to false. */
  enabled?: boolean;
};

export type MemorySyncConfig = {
  /** Explicit sync gate for local-first memory replication. */
  enabled?: boolean;
  /** Sync transport mode. */
  mode?: MemorySyncMode;
  /** Maximum ciphertext events per push batch. */
  batchSize?: number;
  /** Pull cadence in milliseconds. */
  pullIntervalMs?: number;
  /** Maximum concurrent inflight ciphertext batches. */
  maxInflightBatches?: number;
  /** Optional direct transport flag. */
  direct?: MemorySyncDirectConfig;
};

export type MemoryE2eeConfig = {
  /** Informational config only. E2EE is always enforced when sync is on. */
  required?: true;
};

export type MemoryObsidianReadOnlyConfig = {
  enabled?: boolean;
  vaultPath?: string;
};

export type MemoryConfig = {
  backend?: MemoryBackend;
  citations?: MemoryCitationsMode;
  sync?: MemorySyncConfig;
  e2ee?: MemoryE2eeConfig;
  vaultPath?: string;
  memoryPath?: string;
  obsidianReadOnly?: MemoryObsidianReadOnlyConfig;
  qmd?: MemoryQmdConfig;
};

export type MemoryQmdConfig = {
  command?: string;
  mcporter?: MemoryQmdMcporterConfig;
  searchMode?: MemoryQmdSearchMode;
  searchTool?: string;
  includeDefaultMemory?: boolean;
  paths?: MemoryQmdIndexPath[];
  sessions?: MemoryQmdSessionConfig;
  update?: MemoryQmdUpdateConfig;
  limits?: MemoryQmdLimitsConfig;
  scope?: SessionSendPolicyConfig;
};

export type MemoryQmdMcporterConfig = {
  /**
   * Route QMD searches through mcporter (MCP runtime) instead of spawning `qmd` per query.
   * Requires:
   * - `mcporter` installed and on PATH
   * - A configured mcporter server that runs `qmd mcp` with `lifecycle: keep-alive`
   */
  enabled?: boolean;
  /** mcporter server name (defaults to "qmd") */
  serverName?: string;
  /** Start the mcporter daemon automatically (defaults to true when enabled). */
  startDaemon?: boolean;
};

export type MemoryQmdIndexPath = {
  path: string;
  name?: string;
  pattern?: string;
};

export type MemoryQmdSessionConfig = {
  enabled?: boolean;
  exportDir?: string;
  retentionDays?: number;
};

export type MemoryQmdUpdateConfig = {
  interval?: string;
  debounceMs?: number;
  onBoot?: boolean;
  waitForBootSync?: boolean;
  embedInterval?: string;
  commandTimeoutMs?: number;
  updateTimeoutMs?: number;
  embedTimeoutMs?: number;
};

export type MemoryQmdLimitsConfig = {
  maxResults?: number;
  maxSnippetChars?: number;
  maxInjectedChars?: number;
  timeoutMs?: number;
};
