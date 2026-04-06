import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/setup";

const DEFAULT_OWNER_AUTO_APPROVAL_TTL_MS = 10 * 60 * 1000;

const armedByAccountId = new Map<string, number>();

function normalizeAccountId(accountId?: string): string {
  return accountId?.trim() || DEFAULT_ACCOUNT_ID;
}

function pruneExpiredOwnerAutoApprovals(nowMs: number) {
  for (const [accountId, expiresAtMs] of armedByAccountId) {
    if (expiresAtMs <= nowMs) {
      armedByAccountId.delete(accountId);
    }
  }
}

export function armTelegramOwnerAutoApproval(params: {
  accountId?: string;
  ttlMs?: number;
  nowMs?: number;
}) {
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = params.ttlMs ?? DEFAULT_OWNER_AUTO_APPROVAL_TTL_MS;
  pruneExpiredOwnerAutoApprovals(nowMs);
  armedByAccountId.set(normalizeAccountId(params.accountId), nowMs + Math.max(1, ttlMs));
}

export function isTelegramOwnerAutoApprovalArmed(params: {
  accountId?: string;
  nowMs?: number;
}): boolean {
  const nowMs = params.nowMs ?? Date.now();
  pruneExpiredOwnerAutoApprovals(nowMs);
  const expiresAtMs = armedByAccountId.get(normalizeAccountId(params.accountId));
  return typeof expiresAtMs === "number" && expiresAtMs > nowMs;
}

export function disarmTelegramOwnerAutoApproval(accountId?: string) {
  armedByAccountId.delete(normalizeAccountId(accountId));
}

export function clearTelegramOwnerAutoApprovalStateForTest() {
  armedByAccountId.clear();
}
