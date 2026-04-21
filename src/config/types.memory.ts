import type { SessionSendPolicyConfig } from "./types.base.js";

export type MemoryBackend = "builtin" | "qmd";
export type MemoryCitationsMode = "auto" | "on" | "off";
export type MemoryQmdSearchMode = "query" | "search" | "vsearch";

export type MemoryMarkdownProjectionConfig = {
  /** Keep canonical Markdown projections materialized in the active workspace directory. */
  enabled?: boolean;
};

export type MemoryCrdtPagesConfig = {
  /** Store page bodies as CRDT/Yjs state in the derived store. */
  enabled?: boolean;
};

export type MemoryCrdtConfig = {
  pages?: MemoryCrdtPagesConfig;
};

export type MemoryE2eeConfig = {
  /**
   * Canonical memory E2EE is a hard requirement for sync and relay transport.
   * Only `true` is currently supported.
   */
  required?: true;
};

export type MemorySyncUiConfig = {
  /** Enable the memory sync UI entrypoint (default: true). */
  enabled?: boolean;
};

export type MemorySyncConfig = {
  /** Memory sync transport mode (default: off). */
  mode?: "cloud" | "direct" | "off";
  /** Base URL for the ciphertext-only relay transport. */
  relayBaseUrl?: string;
  /** UI rollout guard for sync setup surfaces. */
  ui?: MemorySyncUiConfig;
};

export type MemoryJobsAutoSleepConfig = {
  /** Run cooperative background memory maintenance while the agent is idle. */
  enabled?: boolean;
};

export type MemoryJobsConfig = {
  /** Enable the cooperative background memory maintenance runtime. */
  enabled?: boolean;
  /** Maximum wall-clock slice budget per background run, in milliseconds. */
  maxSliceMs?: number;
  /** Auto-sleep controls for background memory maintenance. */
  autoSleep?: MemoryJobsAutoSleepConfig;
};

export type MemoryConfig = {
  backend?: MemoryBackend;
  citations?: MemoryCitationsMode;
  markdownProjection?: MemoryMarkdownProjectionConfig;
  crdt?: MemoryCrdtConfig;
  e2ee?: MemoryE2eeConfig;
  sync?: MemorySyncConfig;
  jobs?: MemoryJobsConfig;
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
