import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeJsonFileAtomically } from "openclaw/plugin-sdk/json-store";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/setup";
import { resolveStateDir } from "openclaw/plugin-sdk/state-paths";

const STORE_VERSION = 1;
const DEFAULT_OWNER_ONBOARDING_TTL_MS = 10 * 60 * 1000;
const TOKEN_LENGTH = 12;
const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type TelegramOwnerOnboardingState = {
  version: 1;
  token: string;
  createdAt: string;
  expiresAt: string;
  botUsername: string | null;
};

export type TelegramOwnerOnboardingSession = {
  token: string;
  botUsername: string | null;
  createdAtMs: number;
  expiresAtMs: number;
  deepLink: string | null;
  startCommand: string;
};

function normalizeAccountId(accountId?: string): string {
  return accountId?.trim() || DEFAULT_ACCOUNT_ID;
}

function safeAccountKey(accountId: string): string {
  return normalizeAccountId(accountId).replace(/[^a-z0-9._-]+/gi, "_");
}

function resolveTelegramOwnerOnboardingPath(
  accountId?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const stateDir = resolveStateDir(env, os.homedir);
  return path.join(
    stateDir,
    "telegram",
    `owner-onboarding-${safeAccountKey(normalizeAccountId(accountId))}.json`,
  );
}

function randomToken(): string {
  let out = "";
  for (let index = 0; index < TOKEN_LENGTH; index += 1) {
    const alphabetIndex = crypto.randomInt(0, TOKEN_ALPHABET.length);
    out += TOKEN_ALPHABET[alphabetIndex];
  }
  return out;
}

function normalizeBotUsername(botUsername?: string | null): string | null {
  const trimmed = botUsername?.trim().replace(/^@+/, "") || "";
  return trimmed || null;
}

export function buildTelegramOwnerOnboardingDeepLink(
  botUsername?: string | null,
  token?: string | null,
): string | null {
  const normalizedUsername = normalizeBotUsername(botUsername);
  const normalizedToken = token?.trim() || "";
  if (!normalizedUsername || !normalizedToken) {
    return null;
  }
  return `https://t.me/${normalizedUsername}?start=${normalizedToken}`;
}

export function buildTelegramOwnerOnboardingStartCommand(token: string): string {
  return `/start ${token.trim()}`;
}

function safeParseTelegramOwnerOnboardingState(raw: string): TelegramOwnerOnboardingState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TelegramOwnerOnboardingState>;
    if (parsed.version !== STORE_VERSION) {
      return null;
    }
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt.trim() : "";
    const expiresAt = typeof parsed.expiresAt === "string" ? parsed.expiresAt.trim() : "";
    if (!token || !createdAt || !expiresAt) {
      return null;
    }
    const createdAtMs = Date.parse(createdAt);
    const expiresAtMs = Date.parse(expiresAt);
    if (
      !Number.isFinite(createdAtMs) ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= createdAtMs
    ) {
      return null;
    }
    return {
      version: STORE_VERSION,
      token,
      createdAt,
      expiresAt,
      botUsername: normalizeBotUsername(parsed.botUsername),
    };
  } catch {
    return null;
  }
}

function toSession(state: TelegramOwnerOnboardingState): TelegramOwnerOnboardingSession {
  const createdAtMs = Date.parse(state.createdAt);
  const expiresAtMs = Date.parse(state.expiresAt);
  return {
    token: state.token,
    botUsername: state.botUsername,
    createdAtMs,
    expiresAtMs,
    deepLink: buildTelegramOwnerOnboardingDeepLink(state.botUsername, state.token),
    startCommand: buildTelegramOwnerOnboardingStartCommand(state.token),
  };
}

async function readTelegramOwnerOnboardingState(params: {
  accountId?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<TelegramOwnerOnboardingState | null> {
  const filePath = resolveTelegramOwnerOnboardingPath(params.accountId, params.env);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return safeParseTelegramOwnerOnboardingState(raw);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") {
      return null;
    }
    return null;
  }
}

export async function clearTelegramOwnerOnboarding(params: {
  accountId?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const filePath = resolveTelegramOwnerOnboardingPath(params.accountId, params.env);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") {
      return;
    }
    throw err;
  }
}

async function readActiveTelegramOwnerOnboarding(params: {
  accountId?: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
}): Promise<TelegramOwnerOnboardingSession | null> {
  const nowMs = params.nowMs ?? Date.now();
  const state = await readTelegramOwnerOnboardingState(params);
  if (!state) {
    return null;
  }
  const session = toSession(state);
  if (session.expiresAtMs <= nowMs) {
    await clearTelegramOwnerOnboarding(params).catch(() => {});
    return null;
  }
  return session;
}

export async function readTelegramOwnerOnboarding(params: {
  accountId?: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
}): Promise<TelegramOwnerOnboardingSession | null> {
  return await readActiveTelegramOwnerOnboarding(params);
}

export async function beginTelegramOwnerOnboarding(params: {
  accountId?: string;
  botUsername?: string | null;
  ttlMs?: number;
  nowMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<TelegramOwnerOnboardingSession> {
  const nowMs = params.nowMs ?? Date.now();
  const ttlMs = Math.max(1, params.ttlMs ?? DEFAULT_OWNER_ONBOARDING_TTL_MS);
  const state: TelegramOwnerOnboardingState = {
    version: STORE_VERSION,
    token: randomToken(),
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    botUsername: normalizeBotUsername(params.botUsername),
  };
  await writeJsonFileAtomically(
    resolveTelegramOwnerOnboardingPath(params.accountId, params.env),
    state,
  );
  return toSession(state);
}
