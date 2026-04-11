// Real workspace contract for memory engine foundation concerns.

export {
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  resolveSessionAgentId,
} from "../../../src/agents/agent-scope.js";
export {
  resolveMemorySearchConfig,
  type ResolvedMemorySearchConfig,
} from "../../../src/agents/memory-search.js";
export { parseDurationMs } from "../../../src/cli/parse-duration.js";
export { loadConfig } from "../../../src/config/config.js";
export { resolveStateDir } from "../../../src/config/paths.js";
export { resolveSessionTranscriptsDirForAgent } from "../../../src/config/sessions/paths.js";
export {
  resolveAlisioCanonicalMemoryStorePath,
  resolveAlisioMemoryOwnerProfile,
} from "../../../src/infra/alisio-memory-profile.js";
export { getAlisioActiveCloudAccessSession } from "../../../src/infra/alisio-store.js";
export { loadOrCreateDeviceIdentity } from "../../../src/infra/device-identity.js";
export {
  hasConfiguredSecretInput,
  normalizeResolvedSecretInputString,
} from "../../../src/config/types.secrets.js";
export { writeFileWithinRoot } from "../../../src/infra/fs-safe.js";
export { createSubsystemLogger } from "../../../src/logging/subsystem.js";
export { detectMime } from "../../../src/media/mime.js";
export { resolveGlobalSingleton } from "../../../src/shared/global-singleton.js";
export { onSessionTranscriptUpdate } from "../../../src/sessions/transcript-events.js";
export { splitShellArgs } from "../../../src/utils/shell-argv.js";
export { runTasksWithConcurrency } from "../../../src/utils/run-with-concurrency.js";
export {
  shortenHomeInString,
  shortenHomePath,
  resolveUserPath,
  truncateUtf16Safe,
} from "../../../src/utils.js";
export type { AlisioConfig } from "../../../src/config/config.js";
export type { SessionSendPolicyConfig } from "../../../src/config/types.base.js";
export type { SecretInput } from "../../../src/config/types.secrets.js";
export type { AlisioMemoryOwnerProfile } from "../../../src/infra/alisio-memory-profile.js";
export type { AlisioCloudAccessSession } from "../../../src/infra/alisio-store.js";
export type { DeviceIdentity } from "../../../src/infra/device-identity.js";
export type {
  MemoryBackend,
  MemoryCitationsMode,
  MemoryQmdConfig,
  MemoryQmdIndexPath,
  MemoryQmdMcporterConfig,
  MemoryQmdSearchMode,
} from "../../../src/config/types.memory.js";
export type { MemorySearchConfig } from "../../../src/config/types.tools.js";
