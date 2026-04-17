import { isProductChatChannelId } from "../../../../src/channels/product-surface.shared.js";
import type {
  ChannelAccountSnapshot,
  ChannelStatusIssue,
  ChannelsStatusSnapshot,
  ChannelUiMetaEntry,
} from "../types.ts";

export type ResolvedChannelRow = {
  id: string;
  meta: ChannelUiMetaEntry;
  summary: Record<string, unknown>;
  issues: ChannelStatusIssue[];
  accounts: ChannelAccountSnapshot[];
  defaultAccountId: string | null;
  defaultAccount: ChannelAccountSnapshot | null;
};

export type ChannelSnapshotSummary = {
  rows: ResolvedChannelRow[];
  totalChannels: number;
  connectedChannels: number;
  attentionChannels: number;
  activeChannels: number;
  connectedAccounts: number;
};

export type ChannelFlags = {
  configured: boolean;
  linked: boolean;
  connected: boolean;
  attention: boolean;
  dmOnboardingState: "waiting_for_first_dm" | "pending_approval" | null;
  pendingPairingRequests: number;
  setupAvailable: boolean;
  logoutAvailable: boolean;
  linkMode: string;
  setupOnly: boolean;
};

const channelRowsCache = new WeakMap<ChannelsStatusSnapshot, ResolvedChannelRow[]>();

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNullableDmOnboardingState(
  record: Record<string, unknown>,
  key: string,
): "waiting_for_first_dm" | "pending_approval" | null {
  const value = record[key];
  return value === "waiting_for_first_dm" || value === "pending_approval" ? value : null;
}

function readNullableNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNestedString(value: unknown, keys: string[]): string | null {
  let current = value;
  for (const key of keys) {
    if (!current || typeof current !== "object") {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" && current.trim() ? current.trim() : null;
}

function deriveChannelMeta(
  snapshot: ChannelsStatusSnapshot | null,
  channelId: string,
): ChannelUiMetaEntry {
  const label = snapshot?.channelLabels?.[channelId] ?? channelId;
  const detailLabel = snapshot?.channelDetailLabels?.[channelId] ?? channelId;
  const systemImage = snapshot?.channelSystemImages?.[channelId];
  return {
    id: channelId,
    label,
    detailLabel,
    ...(typeof systemImage === "string" && systemImage.trim() ? { systemImage } : {}),
  };
}

function shouldIncludeProductChannel(
  snapshot: ChannelsStatusSnapshot | null,
  channelId: string,
): boolean {
  return snapshot?.channelSurfaceMode === "all" || isProductChatChannelId(channelId);
}

export function resolveChannelRows(snapshot: ChannelsStatusSnapshot | null): ResolvedChannelRow[] {
  if (!snapshot) {
    return [];
  }
  const cached = channelRowsCache.get(snapshot);
  if (cached) {
    return cached;
  }
  const order = snapshot.channelOrder ?? [];
  const metaById = new Map<string, ChannelUiMetaEntry>();
  for (const entry of snapshot.channelMeta ?? []) {
    metaById.set(entry.id, entry);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  const pushId = (channelId: string) => {
    if (!seen.has(channelId)) {
      seen.add(channelId);
      ids.push(channelId);
    }
  };
  for (const channelId of order) {
    pushId(channelId);
  }
  for (const entry of snapshot.channelMeta ?? []) {
    pushId(entry.id);
  }
  for (const channelId of Object.keys(snapshot.channels ?? {})) {
    pushId(channelId);
  }
  const rows = ids
    .filter((channelId) => shouldIncludeProductChannel(snapshot, channelId))
    .map((channelId) => {
      const accounts = snapshot.channelAccounts[channelId] ?? [];
      const defaultAccountId = snapshot.channelDefaultAccountId[channelId] ?? null;
      const defaultAccount =
        accounts.find((entry) => entry.accountId === defaultAccountId) ?? accounts[0] ?? null;
      return {
        id: channelId,
        meta: metaById.get(channelId) ?? deriveChannelMeta(snapshot, channelId),
        summary: asRecord(snapshot.channels[channelId]),
        issues: snapshot.channelIssues?.[channelId] ?? [],
        accounts,
        defaultAccountId,
        defaultAccount,
      };
    });
  channelRowsCache.set(snapshot, rows);
  return rows;
}

export function channelAccountLooksConnected(
  account: ChannelAccountSnapshot | null | undefined,
): boolean {
  if (!account) {
    return false;
  }
  const probeOk =
    account.probe && typeof account.probe === "object" && "ok" in account.probe
      ? Boolean((account.probe as { ok?: unknown }).ok)
      : false;
  return account.connected === true || account.running === true || probeOk;
}

export function formatTimestamp(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function resolveLatestActivityAt(accounts: readonly ChannelAccountSnapshot[]): number | null {
  const values = accounts
    .flatMap((account) => [account.lastInboundAt, account.lastOutboundAt])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .toSorted((left, right) => right - left);
  return values[0] ?? null;
}

export function formatLastActivity(account: ChannelAccountSnapshot | null): string | null {
  if (!account) {
    return null;
  }
  return formatTimestamp(resolveLatestActivityAt([account]));
}

export function formatChannelLastActivity(row: ResolvedChannelRow): string | null {
  return formatTimestamp(resolveLatestActivityAt(row.accounts));
}

export function resolveChannelIssues(row: ResolvedChannelRow, accountId?: string | null) {
  if (!accountId) {
    return row.issues;
  }
  return row.issues.filter((issue) => issue.accountId === accountId);
}

export function resolveChannelFlags(row: ResolvedChannelRow): ChannelFlags {
  const summary = row.summary;
  const configured =
    readBoolean(summary, "configured") ||
    row.accounts.some((account) => account.configured === true);
  const linked =
    readBoolean(summary, "linked") || row.accounts.some((account) => account.linked === true);
  const connected =
    readBoolean(summary, "connected") ||
    readBoolean(summary, "running") ||
    row.accounts.some((account) => channelAccountLooksConnected(account));
  const attention =
    row.issues.length > 0 ||
    row.accounts.some((account) => Boolean(account.lastError?.trim())) ||
    Boolean(readString(summary, "lastError"));
  const setupAvailable = readBoolean(summary, "setupAvailable");
  const logoutAvailable = readBoolean(summary, "logoutAvailable");
  const dmOnboardingState = readNullableDmOnboardingState(summary, "dmOnboardingState");
  const pendingPairingRequests = readNullableNumber(summary, "pendingPairingRequests") ?? 0;
  return {
    configured,
    linked,
    connected,
    attention,
    dmOnboardingState,
    pendingPairingRequests,
    setupAvailable,
    logoutAvailable,
    linkMode: readString(summary, "linkMode") ?? "wizard",
    setupOnly: readBoolean(summary, "setupOnly"),
  };
}

export function resolveAccountFlags(
  row: ResolvedChannelRow,
  account: ChannelAccountSnapshot,
): ChannelFlags {
  const channelFlags = resolveChannelFlags(row);
  const isDefaultAccount = row.defaultAccountId === account.accountId;
  const summary = row.summary;
  return {
    ...channelFlags,
    configured:
      account.configured === true || (isDefaultAccount && readBoolean(summary, "configured")),
    linked: account.linked === true || (isDefaultAccount && readBoolean(summary, "linked")),
    connected:
      channelAccountLooksConnected(account) ||
      (isDefaultAccount && (readBoolean(summary, "connected") || readBoolean(summary, "running"))),
    attention:
      resolveChannelIssues(row, account.accountId).length > 0 ||
      Boolean(account.lastError?.trim()) ||
      (isDefaultAccount && Boolean(readString(summary, "lastError"))),
    dmOnboardingState:
      account.dmOnboardingState ?? (isDefaultAccount ? channelFlags.dmOnboardingState : null),
    pendingPairingRequests:
      account.pendingPairingRequests ??
      (isDefaultAccount ? channelFlags.pendingPairingRequests : 0),
  };
}

export function resolveChannelIdentifier(row: ResolvedChannelRow): string | null {
  const summary = row.summary;
  const account = row.defaultAccount;
  const probe = asRecord(account?.probe);
  const summarySelf = asRecord(summary.self);

  if (row.id === "telegram") {
    const username = readNestedString(probe, ["bot", "username"]);
    return username ? `@${username.replace(/^@+/, "")}` : null;
  }
  if (row.id === "discord") {
    const username = readNestedString(probe, ["bot", "username"]);
    return username ? `@${username.replace(/^@+/, "")}` : null;
  }
  if (row.id === "whatsapp") {
    return (
      readString(summarySelf, "e164") ??
      readString(summarySelf, "jid") ??
      account?.name?.trim() ??
      null
    );
  }
  return account?.name?.trim() ?? null;
}

export function resolveAccountIdentifier(
  row: ResolvedChannelRow,
  account: ChannelAccountSnapshot,
): string | null {
  const probe = asRecord(account.probe);
  if (row.id === "telegram") {
    const username = readNestedString(probe, ["bot", "username"]);
    return username ? `@${username.replace(/^@+/, "")}` : null;
  }
  if (row.id === "discord") {
    const username = readNestedString(probe, ["bot", "username"]);
    return username ? `@${username.replace(/^@+/, "")}` : null;
  }
  if (row.id === "whatsapp") {
    return (
      readNestedString(account, ["self", "e164"]) ??
      readNestedString(account, ["self", "jid"]) ??
      (row.defaultAccountId === account.accountId ? resolveChannelIdentifier(row) : null)
    );
  }
  return account.name?.trim() ?? null;
}

export function countConnectedChannelAccounts(snapshot: ChannelsStatusSnapshot | null): number {
  return resolveChannelRows(snapshot)
    .flatMap((row) => row.accounts)
    .filter((account) => channelAccountLooksConnected(account)).length;
}

export function summarizeChannelsSnapshot(
  snapshot: ChannelsStatusSnapshot | null,
): ChannelSnapshotSummary {
  const rows = resolveChannelRows(snapshot);
  return {
    rows,
    totalChannels: rows.length,
    connectedChannels: rows.filter((row) => resolveChannelFlags(row).connected).length,
    attentionChannels: rows.filter((row) => resolveChannelFlags(row).attention).length,
    activeChannels: rows.filter((row) => {
      const flags = resolveChannelFlags(row);
      return flags.connected || flags.linked || flags.configured || flags.attention;
    }).length,
    connectedAccounts: countConnectedChannelAccounts(snapshot),
  };
}
