import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  decodeBase64,
  decryptBytes,
  deriveProfileRootKey,
  encodeBase64,
  encryptBytes,
  serializeStoredCipher,
  toUint8Array,
} from "./crypto.js";
import type {
  LoadDeviceKeyParams,
  LoadProfileRootKeyParams,
  MemoryCryptoTelemetry,
  StoreDeviceKeyParams,
  StoreProfileRootKeyParams,
  StoreProfileRootKeyResult,
  StoredDeviceKeyResult,
} from "./types.js";

const MEMORY_DEVICE_KEYCHAIN_SERVICE = "Alisio Memory Device Key";
const STORAGE_SCHEMA_VERSION = 1;

type StoredRootKeyFile = {
  schemaVersion: 1;
  purpose: "profile-root-key";
  storedWith: "keychain" | "file";
  cipher: ReturnType<typeof serializeStoredCipher>;
};

type StoredDeviceKeyFile = {
  schemaVersion: 1;
  purpose: "device-key";
  cipher: ReturnType<typeof serializeStoredCipher>;
};

function resolveHomeDir(env: NodeJS.ProcessEnv) {
  return env.ALISIO_HOME?.trim() || env.HOME?.trim() || env.USERPROFILE?.trim() || os.homedir();
}

function expandUserPath(value: string, env: NodeJS.ProcessEnv) {
  if (value === "~") {
    return resolveHomeDir(env);
  }
  if (value.startsWith("~/")) {
    return path.join(resolveHomeDir(env), value.slice(2));
  }
  return value;
}

export function resolveMemoryStateDir(env: NodeJS.ProcessEnv = process.env) {
  return expandUserPath(
    env.ALISIO_STATE_DIR?.trim() || path.join(resolveHomeDir(env), ".alisio"),
    env,
  );
}

function hashSegment(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function buildKeychainAccount(profileId: string, stateDir: string) {
  return `memory|${hashSegment(path.resolve(stateDir))}|${hashSegment(profileId)}`;
}

function buildProfileDir(profileId: string, stateDir: string) {
  return path.join(stateDir, "memory", "e2ee", hashSegment(profileId));
}

export function resolveWrappedProfileRootKeyPath(
  profileId: string,
  stateDir = resolveMemoryStateDir(process.env),
) {
  return path.join(buildProfileDir(profileId, stateDir), "profile-root-key.json");
}

export function resolveStoredDeviceKeyPath(
  profileId: string,
  stateDir = resolveMemoryStateDir(process.env),
) {
  return path.join(buildProfileDir(profileId, stateDir), "device-key.json");
}

function buildDeviceKeyAad(profileId: string) {
  return ["alisio-memory:device-key", "v1", profileId].join("\0");
}

function buildProfileRootAad(profileId: string) {
  return ["alisio-memory:profile-root", "v1", profileId].join("\0");
}

export function hasUsableDeviceKeyKeychain(
  env: NodeJS.ProcessEnv = process.env,
  execFileSyncImpl: typeof execFileSync = execFileSync,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "darwin" || "VITEST" in env) {
    return false;
  }
  try {
    const result = execFileSyncImpl("security", ["default-keychain", "-d", "user"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

function readDeviceKeyFromKeychain(
  profileId: string,
  stateDir: string,
  env: NodeJS.ProcessEnv,
  execFileSyncImpl: typeof execFileSync = execFileSync,
) {
  if (!hasUsableDeviceKeyKeychain(env, execFileSyncImpl)) {
    return null;
  }
  try {
    const secret = execFileSyncImpl(
      "security",
      [
        "find-generic-password",
        "-s",
        MEMORY_DEVICE_KEYCHAIN_SERVICE,
        "-a",
        buildKeychainAccount(profileId, stateDir),
        "-w",
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
    return secret ? decodeBase64(secret) : null;
  } catch {
    return null;
  }
}

function writeDeviceKeyToKeychain(
  profileId: string,
  deviceKey: Uint8Array,
  stateDir: string,
  env: NodeJS.ProcessEnv,
  execFileSyncImpl: typeof execFileSync = execFileSync,
) {
  if (!hasUsableDeviceKeyKeychain(env, execFileSyncImpl)) {
    return false;
  }
  try {
    execFileSyncImpl(
      "security",
      [
        "add-generic-password",
        "-U",
        "-s",
        MEMORY_DEVICE_KEYCHAIN_SERVICE,
        "-a",
        buildKeychainAccount(profileId, stateDir),
        "-w",
        encodeBase64(deviceKey),
      ],
      {
        encoding: "utf8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return true;
  } catch {
    return false;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function writeStoredDeviceKeyFile(
  profileId: string,
  deviceKey: Uint8Array,
  profileRootKey: Uint8Array,
  stateDir: string,
) {
  const cipher = await encryptBytes(profileRootKey, deviceKey, buildDeviceKeyAad(profileId));
  const record: StoredDeviceKeyFile = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    purpose: "device-key",
    cipher: serializeStoredCipher(cipher),
  };
  await writeJsonFile(resolveStoredDeviceKeyPath(profileId, stateDir), record);
}

async function readStoredDeviceKeyFile(
  profileId: string,
  profileRootKey: Uint8Array,
  stateDir: string,
  telemetry?: MemoryCryptoTelemetry,
) {
  const record = await readJsonFile<StoredDeviceKeyFile>(
    resolveStoredDeviceKeyPath(profileId, stateDir),
  );
  if (!record) {
    return null;
  }
  return await decryptBytes(
    profileRootKey,
    decodeBase64(record.cipher.ciphertextBase64),
    decodeBase64(record.cipher.nonceBase64),
    buildDeviceKeyAad(profileId),
    telemetry,
  );
}

export async function storeDeviceKey(params: StoreDeviceKeyParams): Promise<StoredDeviceKeyResult> {
  const env = params.env ?? process.env;
  const stateDir = params.stateDir ?? resolveMemoryStateDir(env);
  const profileRootKey = toUint8Array(params.profileRootKey);
  const deviceKey = params.deviceKey
    ? toUint8Array(params.deviceKey)
    : new Uint8Array(randomBytes(32));

  if (writeDeviceKeyToKeychain(params.profileId, deviceKey, stateDir, env)) {
    return { deviceKey, storedIn: "keychain" };
  }

  await writeStoredDeviceKeyFile(params.profileId, deviceKey, profileRootKey, stateDir);
  return { deviceKey, storedIn: "file" };
}

export async function loadDeviceKey(
  params: LoadDeviceKeyParams,
): Promise<StoredDeviceKeyResult | null> {
  const env = params.env ?? process.env;
  const stateDir = params.stateDir ?? resolveMemoryStateDir(env);
  const keychain = readDeviceKeyFromKeychain(params.profileId, stateDir, env);
  if (keychain) {
    return { deviceKey: keychain, storedIn: "keychain" };
  }

  let profileRootKey = params.profileRootKey ? toUint8Array(params.profileRootKey) : undefined;
  if (!profileRootKey && params.passphrase) {
    profileRootKey = await deriveProfileRootKey({
      profileId: params.profileId,
      passphrase: params.passphrase,
    });
  }
  if (!profileRootKey) {
    return null;
  }

  const stored = await readStoredDeviceKeyFile(
    params.profileId,
    profileRootKey,
    stateDir,
    params.telemetry,
  );
  if (!stored) {
    return null;
  }
  return { deviceKey: stored, storedIn: "file" };
}

export async function storeProfileRootKey(
  params: StoreProfileRootKeyParams,
): Promise<StoreProfileRootKeyResult> {
  const env = params.env ?? process.env;
  const stateDir = params.stateDir ?? resolveMemoryStateDir(env);
  const profileRootKey = toUint8Array(params.profileRootKey);
  const { deviceKey, storedIn } = await storeDeviceKey({
    profileId: params.profileId,
    profileRootKey,
    deviceKey: params.deviceKey,
    stateDir,
    env,
  });
  const cipher = await encryptBytes(
    deviceKey,
    profileRootKey,
    buildProfileRootAad(params.profileId),
  );
  const record: StoredRootKeyFile = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    purpose: "profile-root-key",
    storedWith: storedIn,
    cipher: serializeStoredCipher(cipher),
  };
  const filePath = resolveWrappedProfileRootKeyPath(params.profileId, stateDir);
  await writeJsonFile(filePath, record);
  return {
    path: filePath,
    status: storedIn,
    deviceKeyStoredIn: storedIn,
  };
}

export async function loadProfileRootKey(params: LoadProfileRootKeyParams) {
  const env = params.env ?? process.env;
  const stateDir = params.stateDir ?? resolveMemoryStateDir(env);
  const wrapped = await readJsonFile<StoredRootKeyFile>(
    resolveWrappedProfileRootKeyPath(params.profileId, stateDir),
  );
  const storedDeviceKey = await loadDeviceKey({
    profileId: params.profileId,
    passphrase: params.passphrase,
    stateDir,
    env,
    telemetry: params.telemetry,
  });

  if (wrapped && storedDeviceKey) {
    return await decryptBytes(
      storedDeviceKey.deviceKey,
      decodeBase64(wrapped.cipher.ciphertextBase64),
      decodeBase64(wrapped.cipher.nonceBase64),
      buildProfileRootAad(params.profileId),
      params.telemetry,
    );
  }

  if (!params.passphrase) {
    return null;
  }

  return await deriveProfileRootKey({
    profileId: params.profileId,
    passphrase: params.passphrase,
  });
}

export const __testing = {
  resolveMemoryStateDir,
  resolveWrappedProfileRootKeyPath,
  resolveStoredDeviceKeyPath,
};
