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

export function resolveChannelRows(snapshot: ChannelsStatusSnapshot | null): ResolvedChannelRow[] {
  if (!snapshot) {
    return [];
  }
  const order = snapshot.channelOrder ?? [];
  const metaById = new Map<string, ChannelUiMetaEntry>();
  for (const entry of snapshot.channelMeta ?? []) {
    metaById.set(entry.id, entry);
  }
  const ids = [...order];
  for (const entry of snapshot.channelMeta ?? []) {
    if (!ids.includes(entry.id)) {
      ids.push(entry.id);
    }
  }
  for (const channelId of Object.keys(snapshot.channels ?? {})) {
    if (!ids.includes(channelId)) {
      ids.push(channelId);
    }
  }
  return ids.map((channelId) => {
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

function rowLooksConnected(row: ResolvedChannelRow): boolean {
  const summary = row.summary;
  return (
    readBoolean(summary, "connected") ||
    readBoolean(summary, "running") ||
    row.accounts.some((account) => channelAccountLooksConnected(account))
  );
}

function rowNeedsAttention(row: ResolvedChannelRow): boolean {
  return (
    row.issues.length > 0 ||
    row.accounts.some((account) => Boolean(account.lastError?.trim())) ||
    Boolean(readString(row.summary, "lastError"))
  );
}

function rowIsActive(row: ResolvedChannelRow): boolean {
  return (
    rowLooksConnected(row) ||
    readBoolean(row.summary, "linked") ||
    readBoolean(row.summary, "configured") ||
    row.accounts.some((account) => account.linked === true || account.configured === true) ||
    rowNeedsAttention(row)
  );
}

export function countConnectedChannelAccounts(snapshot: ChannelsStatusSnapshot | null): number {
  if (!snapshot) {
    return 0;
  }
  return Object.values(snapshot.channelAccounts ?? {})
    .flat()
    .filter((account) => channelAccountLooksConnected(account)).length;
}

export function summarizeChannelsSnapshot(
  snapshot: ChannelsStatusSnapshot | null,
): ChannelSnapshotSummary {
  const rows = resolveChannelRows(snapshot);
  return {
    rows,
    totalChannels: rows.length,
    connectedChannels: rows.filter((row) => rowLooksConnected(row)).length,
    attentionChannels: rows.filter((row) => rowNeedsAttention(row)).length,
    activeChannels: rows.filter((row) => rowIsActive(row)).length,
    connectedAccounts: countConnectedChannelAccounts(snapshot),
  };
}
