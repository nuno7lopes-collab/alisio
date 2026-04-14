import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export type DeviceIdentity = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
};

type StoredIdentity = {
  version: 1;
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAtMs: number;
};

type LegacyStoredIdentity = {
  version?: 1;
  deviceId: string;
  publicKey: string;
  privateKey: string;
  createdAtMs: number;
};

type NormalizedStoredIdentity = {
  identity: DeviceIdentity;
  stored: StoredIdentity;
  needsRewrite: boolean;
};

function resolveDefaultIdentityPath(): string {
  return path.join(resolveStateDir(), "identity", "device.json");
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem: string): string {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function formatPem(label: "PUBLIC KEY" | "PRIVATE KEY", der: Buffer): string {
  const body = der
    .toString("base64")
    .match(/.{1,64}/g)
    ?.join("\n");
  return `-----BEGIN ${label}-----\n${body ?? ""}\n-----END ${label}-----\n`;
}

function isStoredIdentity(value: unknown): value is StoredIdentity {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as StoredIdentity).version === 1 &&
    typeof (value as StoredIdentity).deviceId === "string" &&
    typeof (value as StoredIdentity).publicKeyPem === "string" &&
    typeof (value as StoredIdentity).privateKeyPem === "string" &&
    typeof (value as StoredIdentity).createdAtMs === "number"
  );
}

function isLegacyStoredIdentity(value: unknown): value is LegacyStoredIdentity {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as LegacyStoredIdentity).deviceId === "string" &&
    typeof (value as LegacyStoredIdentity).publicKey === "string" &&
    typeof (value as LegacyStoredIdentity).privateKey === "string" &&
    typeof (value as LegacyStoredIdentity).createdAtMs === "number"
  );
}

function normalizeStoredIdentity(raw: string): NormalizedStoredIdentity | null {
  const parsed = JSON.parse(raw) as unknown;
  if (isStoredIdentity(parsed)) {
    const stored = canonicalizeStoredIdentity({
      privateKeyPem: parsed.privateKeyPem,
      createdAtMs: parsed.createdAtMs,
    });
    if (!stored) {
      return null;
    }
    return {
      identity: {
        deviceId: stored.deviceId,
        publicKeyPem: stored.publicKeyPem,
        privateKeyPem: stored.privateKeyPem,
      },
      stored,
      needsRewrite:
        stored.deviceId !== parsed.deviceId ||
        stored.publicKeyPem !== parsed.publicKeyPem ||
        stored.privateKeyPem !== parsed.privateKeyPem,
    };
  }
  if (isLegacyStoredIdentity(parsed)) {
    const privateKeyRaw = base64UrlDecode(parsed.privateKey);
    if (privateKeyRaw.length !== 32) {
      return null;
    }
    const legacyPrivateKeyPem = formatPem(
      "PRIVATE KEY",
      Buffer.concat([ED25519_PKCS8_PREFIX, privateKeyRaw]),
    );
    const stored = canonicalizeStoredIdentity({
      privateKeyPem: legacyPrivateKeyPem,
      createdAtMs: parsed.createdAtMs,
    });
    if (!stored) {
      return null;
    }
    return {
      identity: {
        deviceId: stored.deviceId,
        publicKeyPem: stored.publicKeyPem,
        privateKeyPem: stored.privateKeyPem,
      },
      stored,
      needsRewrite: true,
    };
  }
  return null;
}

function canonicalizeStoredIdentity(params: {
  privateKeyPem: string;
  createdAtMs: number;
}): StoredIdentity | null {
  try {
    const privateKey = crypto.createPrivateKey(params.privateKeyPem);
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = crypto.createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
    return {
      version: 1,
      deviceId: fingerprintPublicKey(publicKeyPem),
      publicKeyPem,
      privateKeyPem,
      createdAtMs: params.createdAtMs,
    };
  } catch {
    return null;
  }
}

function generateIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);
  return { deviceId, publicKeyPem, privateKeyPem };
}

function writeStoredIdentity(filePath: string, stored: StoredIdentity) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

export function loadOrCreateDeviceIdentity(
  filePath: string = resolveDefaultIdentityPath(),
): DeviceIdentity {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      const normalized = normalizeStoredIdentity(raw);
      if (normalized) {
        if (normalized.needsRewrite) {
          writeStoredIdentity(filePath, normalized.stored);
        }
        return normalized.identity;
      }
    }
  } catch {
    // fall through to regenerate
  }

  const identity = generateIdentity();
  ensureDir(filePath);
  const stored: StoredIdentity = {
    version: 1,
    deviceId: identity.deviceId,
    publicKeyPem: identity.publicKeyPem,
    privateKeyPem: identity.privateKeyPem,
    createdAtMs: Date.now(),
  };
  writeStoredIdentity(filePath, stored);
  return identity;
}

export function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key);
  return base64UrlEncode(sig);
}

export function normalizeDevicePublicKeyBase64Url(publicKey: string): string | null {
  try {
    if (publicKey.includes("BEGIN")) {
      return base64UrlEncode(derivePublicKeyRaw(publicKey));
    }
    const raw = base64UrlDecode(publicKey);
    if (raw.length === 0) {
      return null;
    }
    return base64UrlEncode(raw);
  } catch {
    return null;
  }
}

export function deriveDeviceIdFromPublicKey(publicKey: string): string | null {
  try {
    const raw = publicKey.includes("BEGIN")
      ? derivePublicKeyRaw(publicKey)
      : base64UrlDecode(publicKey);
    if (raw.length === 0) {
      return null;
    }
    return crypto.createHash("sha256").update(raw).digest("hex");
  } catch {
    return null;
  }
}

export function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

export function verifyDeviceSignature(
  publicKey: string,
  payload: string,
  signatureBase64Url: string,
): boolean {
  try {
    const key = publicKey.includes("BEGIN")
      ? crypto.createPublicKey(publicKey)
      : crypto.createPublicKey({
          key: Buffer.concat([ED25519_SPKI_PREFIX, base64UrlDecode(publicKey)]),
          type: "spki",
          format: "der",
        });
    const sig = (() => {
      try {
        return base64UrlDecode(signatureBase64Url);
      } catch {
        return Buffer.from(signatureBase64Url, "base64");
      }
    })();
    return crypto.verify(null, Buffer.from(payload, "utf8"), key, sig);
  } catch {
    return false;
  }
}
