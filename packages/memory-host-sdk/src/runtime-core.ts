// Focused runtime contract for memory plugin config/state/helpers.

export type { AnyAgentTool } from "../../../src/agents/tools/common.js";
import { resolveCronStyleNow as resolveCronStyleNowInternal } from "../../../src/agents/current-time.js";
import type { AlisioConfig as CoreAlisioConfig } from "../../../src/config/config.js";
import {
  buildCanonicalMemoryNotePath,
  slugifyMemoryNotePathComponent,
} from "../../../src/shared/memory-file-paths.js";
export { resolveCronStyleNowInternal as resolveCronStyleNow };
export { DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR } from "../../../src/agents/pi-settings.js";
export { resolveDefaultAgentId, resolveSessionAgentId } from "../../../src/agents/agent-scope.js";
export { resolveMemorySearchConfig } from "../../../src/agents/memory-search.js";
export { jsonResult, readNumberParam, readStringParam } from "../../../src/agents/tools/common.js";
export { SILENT_REPLY_TOKEN } from "../../../src/auto-reply/tokens.js";
export { parseNonNegativeByteSize } from "../../../src/config/byte-size.js";
export { loadConfig } from "../../../src/config/config.js";
export { resolveStateDir } from "../../../src/config/paths.js";
export { resolveSessionTranscriptsDirForAgent } from "../../../src/config/sessions/paths.js";
export {
  createMemoryCrypto,
  decodeBase64,
  encodeBase64,
  exportPairingCode,
  importProfileKeyFromPairingCode,
  loadProfileRootKey,
  storeProfileRootKey,
} from "../../memory-crypto/src/index.js";
export {
  MemorySyncBlockedError,
  MemorySyncHttpError,
  createCloudRelayMemoryTransport,
  createDirectMemoryTransportStub,
  resolveMemorySyncAvailability,
} from "../../memory-sync/src/index.js";
export {
  resolveAlisioCanonicalMemoryStorePath,
  resolveAlisioMemoryOwnerProfile,
} from "../../../src/infra/alisio-memory-profile.js";
export { getAlisioActiveCloudAccessSession } from "../../../src/infra/alisio-store.js";
export { loadOrCreateDeviceIdentity } from "../../../src/infra/device-identity.js";
export { emptyPluginConfigSchema } from "../../../src/plugins/config-schema.js";
export { parseAgentSessionKey } from "../../../src/routing/session-key.js";
export type { AlisioConfig } from "../../../src/config/config.js";
export type { MemoryCitationsMode } from "../../../src/config/types.memory.js";
export type { AlisioMemoryOwnerProfile } from "../../../src/infra/alisio-memory-profile.js";
export type { AlisioCloudAccessSession } from "../../../src/infra/alisio-store.js";
export type { DeviceIdentity } from "../../../src/infra/device-identity.js";
export type {
  ImportPairingCodeParams,
  ImportedProfileKey,
  LoadProfileRootKeyParams,
  MemoryCipherBytes,
  MemoryCryptoTelemetry,
  MemoryEventCryptoMeta,
  StoreProfileRootKeyParams,
  StoreProfileRootKeyResult,
} from "../../memory-crypto/src/index.js";
export type {
  MemoryFlushPlan,
  MemoryFlushPlanResolver,
  MemoryPluginRuntime,
  MemoryPromptSectionBuilder,
} from "../../../src/plugins/memory-state.js";
export type { AlisioPluginApi } from "../../../src/plugins/types.js";
export type {
  EncryptedMemoryEvent,
  MemoryBlobMeta,
  MemorySyncAckVector,
  MemorySyncAvailability,
  MemorySyncMode,
  MemorySyncTransport,
  PulledMemoryBlob,
  ResolveSyncAvailabilityParams,
} from "../../memory-sync/src/index.js";

export type CanonicalMemoryDailyNoteTarget = {
  nowMs: number;
  dateStamp: string;
  relativePath: string;
  userTimezone: string;
  timeLine: string;
};

export type { MemoryNoteRole } from "../../../src/shared/memory-file-paths.js";
export {
  buildCanonicalMemoryNotePath,
  isDailyMemoryNoteFileName,
  normalizeMemoryNoteRole,
  resolveMemoryNoteRole,
  slugifyMemoryNotePathComponent,
} from "../../../src/shared/memory-file-paths.js";

function formatDateStampInTimezone(nowMs: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (year && month && day) {
    return `${year}-${month}-${day}`;
  }
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function resolveCanonicalMemoryDailyNoteTarget(
  params: {
    cfg?: CoreAlisioConfig;
    nowMs?: number;
  } = {},
): CanonicalMemoryDailyNoteTarget {
  const nowMs = Number.isFinite(params.nowMs) ? (params.nowMs as number) : Date.now();
  const { timeLine, userTimezone } = resolveCronStyleNowInternal(params.cfg ?? {}, nowMs);
  const dateStamp = formatDateStampInTimezone(nowMs, userTimezone);
  return {
    nowMs,
    dateStamp,
    relativePath: buildCanonicalMemoryNotePath({
      role: "daily",
      dateStamp,
    }),
    userTimezone,
    timeLine,
  };
}

export type CanonicalMemoryBacklogNoteTarget = CanonicalMemoryDailyNoteTarget & {
  slug: string;
};

export function resolveCanonicalMemoryBacklogNoteTarget(
  params: {
    cfg?: CoreAlisioConfig;
    nowMs?: number;
    slug?: string | null;
    title?: string | null;
  } = {},
): CanonicalMemoryBacklogNoteTarget {
  const dailyTarget = resolveCanonicalMemoryDailyNoteTarget(params);
  const slug = slugifyMemoryNotePathComponent(
    params.slug?.trim() || params.title?.trim() || dailyTarget.timeLine || "backlog",
  );
  return {
    ...dailyTarget,
    slug,
    relativePath: buildCanonicalMemoryNotePath({
      role: "backlog",
      dateStamp: dailyTarget.dateStamp,
      slug,
      title: params.title,
    }),
  };
}
