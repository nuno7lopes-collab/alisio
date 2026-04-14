import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { getHostDeviceIdentity, hasAlisioHostBridge, signHostDevicePayload } from "./alisio-host.ts";
import { getSafeLocalStorage } from "../local-storage.ts";

type StoredIdentity = {
  version: 1;
  deviceId: string;
  publicKey: string;
  privateKey: string;
  createdAtMs: number;
};

export type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
  privateKey?: string;
  source?: "browser" | "host";
};

type BrowserDeviceIdentity = DeviceIdentity & {
  privateKey: string;
  source: "browser";
};

const STORAGE_KEY = "alisio-device-identity-v2";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fingerprintPublicKey(publicKey: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", publicKey.slice().buffer);
  return bytesToHex(new Uint8Array(hash));
}

async function generateIdentity(): Promise<BrowserDeviceIdentity> {
  const privateKey = utils.randomSecretKey();
  const publicKey = await getPublicKeyAsync(privateKey);
  const deviceId = await fingerprintPublicKey(publicKey);
  return {
    deviceId,
    publicKey: base64UrlEncode(publicKey),
    privateKey: base64UrlEncode(privateKey),
    source: "browser",
  };
}

async function loadHostIdentity(): Promise<DeviceIdentity | null> {
  if (!hasAlisioHostBridge()) {
    return null;
  }
  const identity = await getHostDeviceIdentity();
  if (!identity.deviceId?.trim() || !identity.publicKey?.trim()) {
    throw new Error("Native host bridge returned an invalid device identity");
  }
  return {
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    source: "host",
  };
}

export async function loadManagedDeviceIdentity(): Promise<DeviceIdentity | null> {
  return await loadHostIdentity().catch(() => null);
}

export async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const hostIdentity = await loadManagedDeviceIdentity();
  if (hostIdentity) {
    return hostIdentity;
  }
  const storage = getSafeLocalStorage();
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as StoredIdentity;
      if (
        parsed?.version === 1 &&
        typeof parsed.deviceId === "string" &&
        typeof parsed.publicKey === "string" &&
        typeof parsed.privateKey === "string"
      ) {
        const derivedId = await fingerprintPublicKey(base64UrlDecode(parsed.publicKey));
        if (derivedId !== parsed.deviceId) {
          const updated: StoredIdentity = {
            ...parsed,
            deviceId: derivedId,
          };
          storage?.setItem(STORAGE_KEY, JSON.stringify(updated));
          return {
            deviceId: derivedId,
            publicKey: parsed.publicKey,
            privateKey: parsed.privateKey,
          };
        }
        return {
          deviceId: parsed.deviceId,
          publicKey: parsed.publicKey,
          privateKey: parsed.privateKey,
          source: "browser",
        };
      }
    }
  } catch {
    // fall through to regenerate
  }

  const identity = await generateIdentity();
  const stored: StoredIdentity = {
    version: 1,
    deviceId: identity.deviceId,
    publicKey: identity.publicKey,
    privateKey: identity.privateKey,
    createdAtMs: Date.now(),
  };
  storage?.setItem(STORAGE_KEY, JSON.stringify(stored));
  return identity;
}

export async function signDevicePayload(privateKeyBase64Url: string, payload: string) {
  const key = base64UrlDecode(privateKeyBase64Url);
  const data = new TextEncoder().encode(payload);
  const sig = await signAsync(data, key);
  return base64UrlEncode(sig);
}

export async function signDevicePayloadWithIdentity(identity: DeviceIdentity, payload: string) {
  if (identity.privateKey) {
    return await signDevicePayload(identity.privateKey, payload);
  }
  return await signHostDevicePayload(payload);
}
