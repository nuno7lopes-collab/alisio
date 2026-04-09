import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export type AlisioMemoryOwnerProfile = {
  profileId: string;
  source: "cloud-user" | "local-profile" | "state-dir";
  userId?: string;
  username?: string;
  displayName?: string;
  emailHash?: string;
};

type StoredAlisioProfileSnapshot = {
  account?: {
    profile?: {
      userId?: string;
      username?: string;
      displayName?: string;
      email?: string;
    };
  };
};

type StoredAlisioProfile = NonNullable<StoredAlisioProfileSnapshot["account"]>["profile"];

const ALISIO_STORE_RELATIVE_PATH = path.join("alisio", "state.json");

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeProfileSegment(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function readStoredProfile(env: NodeJS.ProcessEnv): StoredAlisioProfile {
  const statePath = path.join(resolveStateDir(env), ALISIO_STORE_RELATIVE_PATH);
  try {
    const raw = fs.readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw) as StoredAlisioProfileSnapshot;
    return parsed.account?.profile;
  } catch {
    return undefined;
  }
}

export function resolveAlisioMemoryOwnerProfile(
  env: NodeJS.ProcessEnv = process.env,
): AlisioMemoryOwnerProfile {
  const stored = readStoredProfile(env);
  const userId = normalizeText(stored?.userId);
  const username = normalizeText(stored?.username);
  const displayName = normalizeText(stored?.displayName);
  const email = normalizeText(stored?.email)?.toLowerCase();
  const emailHash = email ? shortHash(email) : undefined;

  if (userId) {
    return {
      profileId: `user-${sanitizeProfileSegment(userId, shortHash(userId))}`,
      source: "cloud-user",
      userId,
      username,
      displayName,
      emailHash,
    };
  }

  if (username || emailHash || displayName) {
    const localSeed = username ?? emailHash ?? displayName ?? "local";
    return {
      profileId: `local-${sanitizeProfileSegment(localSeed, shortHash(localSeed))}`,
      source: "local-profile",
      username,
      displayName,
      emailHash,
    };
  }

  const stateDir = resolveStateDir(env);
  return {
    profileId: `state-${shortHash(path.resolve(stateDir))}`,
    source: "state-dir",
  };
}

export function resolveAlisioCanonicalMemoryStorePath(params?: {
  env?: NodeJS.ProcessEnv;
  profileId?: string;
}): string {
  const env = params?.env ?? process.env;
  const profileId = params?.profileId ?? resolveAlisioMemoryOwnerProfile(env).profileId;
  return path.join(resolveStateDir(env), "memory", "profiles", profileId, "canonical.sqlite");
}
