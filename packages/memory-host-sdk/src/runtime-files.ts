// Focused runtime contract for memory file/backend access.

export { listMemoryFiles, normalizeExtraMemoryPaths } from "./host/internal.js";
export { readAgentMemoryFile } from "./host/read-file.js";
export { resolveMemoryBackendConfig } from "./host/backend-config.js";
export {
  buildObsidianDailyNoteSeed,
  resolveObsidianDisplayPath,
  resolveObsidianMemoryLayout,
  resolveObsidianReadPath,
  resolveObsidianToolPathForDate,
  resolveObsidianWritePathForDate,
  syncObsidianLongTermMemoryRollup,
} from "./host/obsidian-layout.js";
export {
  OBSIDIAN_READONLY_TOOL_PREFIX,
  resolveObsidianReadOnlyDisplayPath,
  resolveObsidianReadOnlyReadPath,
  resolveObsidianReadOnlyVault,
  scanObsidianReadOnlyVault,
} from "./host/obsidian-readonly.js";
export type { MemorySearchResult } from "./host/types.js";
export type { ResolvedObsidianMemoryLayout } from "./host/obsidian-layout.js";
export type {
  ObsidianReadOnlyVaultFile,
  ObsidianReadOnlyVaultScanResult,
  ResolvedObsidianReadOnlyVault,
} from "./host/obsidian-readonly.js";
