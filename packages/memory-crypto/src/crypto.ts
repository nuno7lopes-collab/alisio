import { createHash, createHmac, randomBytes, scrypt, webcrypto } from "node:crypto";
import { incrementCryptoCounter } from "./telemetry.js";
import type {
  BytesLike,
  DeriveProfileRootKeyParams,
  MemoryCipherBytes,
  MemoryCryptoTelemetry,
  MemoryEventCryptoMeta,
  MemoryStoredCipher,
} from "./types.js";

const subtle = globalThis.crypto?.subtle ?? webcrypto.subtle;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const DEFAULT_SCRYPT_COST_FACTOR = 16_384;
const DEFAULT_SCRYPT_BLOCK_SIZE = 8;
const DEFAULT_SCRYPT_PARALLELIZATION = 1;
const DEFAULT_SCRYPT_MAX_MEMORY_BYTES = 64 * 1024 * 1024;
const NONCE_BYTES = 12;

export function toUint8Array(value: BytesLike): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  }
  return new Uint8Array(value.slice(0));
}

function toArrayBufferView(value: BytesLike) {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value;
  }
  return new Uint8Array(value);
}

function toWebCryptoBytes(value: BytesLike) {
  return Uint8Array.from(toUint8Array(value));
}

function requireNonEmpty(value: string, label: string) {
  if (!value.trim()) {
    throw new Error(`${label} must not be empty`);
  }
  return value.trim();
}

function require32ByteKey(key: BytesLike, label: string) {
  const normalized = toUint8Array(key);
  if (normalized.byteLength !== 32) {
    throw new Error(`${label} must be 32 bytes`);
  }
  return normalized;
}

function toUtf8Bytes(value: string) {
  return textEncoder.encode(value);
}

export function encodeUtf8(value: string) {
  return toUtf8Bytes(value);
}

export function decodeUtf8(value: BytesLike) {
  return textDecoder.decode(toArrayBufferView(value));
}

export function encodeBase64(value: BytesLike) {
  return Buffer.from(toUint8Array(value)).toString("base64");
}

export function decodeBase64(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export function encodeBase64Url(value: BytesLike) {
  return encodeBase64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = padded.length % 4;
  const suffix = remainder === 0 ? "" : "=".repeat(4 - remainder);
  return decodeBase64(`${padded}${suffix}`);
}

export function serializeStoredCipher(cipher: MemoryCipherBytes): MemoryStoredCipher {
  return {
    algorithm: cipher.algorithm,
    ciphertextBase64: encodeBase64(cipher.ciphertext),
    nonceBase64: encodeBase64(cipher.nonce),
  };
}

export function deserializeStoredCipher(cipher: MemoryStoredCipher): MemoryCipherBytes {
  return {
    algorithm: cipher.algorithm,
    ciphertext: decodeBase64(cipher.ciphertextBase64),
    nonce: decodeBase64(cipher.nonceBase64),
  };
}

function buildPassphraseSalt(profileId: string, namespace: string) {
  return createHash("sha256")
    .update("alisio-memory")
    .update("\0")
    .update(namespace)
    .update("\0")
    .update(profileId)
    .digest();
}

export async function deriveProfileRootKey(
  params: DeriveProfileRootKeyParams,
): Promise<Uint8Array> {
  const profileId = requireNonEmpty(params.profileId, "profileId");
  const passphrase = requireNonEmpty(params.passphrase, "passphrase");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      passphrase,
      buildPassphraseSalt(profileId, params.namespace ?? "profile-root"),
      32,
      {
        N: params.costFactor ?? DEFAULT_SCRYPT_COST_FACTOR,
        r: params.blockSize ?? DEFAULT_SCRYPT_BLOCK_SIZE,
        p: params.parallelization ?? DEFAULT_SCRYPT_PARALLELIZATION,
        maxmem: params.maxMemoryBytes ?? DEFAULT_SCRYPT_MAX_MEMORY_BYTES,
      },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(Buffer.from(key));
      },
    );
  });
  return new Uint8Array(derived);
}

export function deriveEventKey(profileRootKey: BytesLike, eventId: string, purpose: string) {
  const rootKey = require32ByteKey(profileRootKey, "profileRootKey");
  const normalizedEventId = requireNonEmpty(eventId, "eventId");
  const normalizedPurpose = requireNonEmpty(purpose, "purpose");
  return new Uint8Array(
    createHmac("sha256", rootKey)
      .update("alisio-memory")
      .update("\0")
      .update(normalizedPurpose)
      .update("\0")
      .update(normalizedEventId)
      .digest(),
  );
}

async function importAesKey(key: BytesLike) {
  return await subtle.importKey(
    "raw",
    toWebCryptoBytes(require32ByteKey(key, "aesKey")),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

function normalizeAad(aad?: BytesLike | string) {
  if (aad === undefined) {
    return undefined;
  }
  return typeof aad === "string" ? toUtf8Bytes(aad) : toUint8Array(aad);
}

export async function encryptBytes(
  key: BytesLike,
  plaintext: BytesLike,
  aad?: BytesLike | string,
): Promise<MemoryCipherBytes> {
  const nonce = new Uint8Array(randomBytes(NONCE_BYTES));
  const additionalData = normalizeAad(aad);
  const ciphertext = await subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: additionalData ? toWebCryptoBytes(additionalData) : undefined,
      tagLength: 128,
    },
    await importAesKey(key),
    toWebCryptoBytes(plaintext),
  );

  return {
    algorithm: "AES-256-GCM",
    ciphertext: new Uint8Array(ciphertext),
    nonce,
  };
}

export async function decryptBytes(
  key: BytesLike,
  ciphertext: BytesLike,
  nonce: BytesLike,
  aad?: BytesLike | string,
  telemetry?: MemoryCryptoTelemetry,
): Promise<Uint8Array> {
  try {
    const additionalData = normalizeAad(aad);
    const plaintext = await subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toWebCryptoBytes(nonce),
        additionalData: additionalData ? toWebCryptoBytes(additionalData) : undefined,
        tagLength: 128,
      },
      await importAesKey(key),
      toWebCryptoBytes(ciphertext),
    );
    return new Uint8Array(plaintext);
  } catch {
    incrementCryptoCounter(telemetry, "decrypt_failures");
    throw new Error("AES-256-GCM decrypt failed");
  }
}

export function buildEventPayloadAad(meta: MemoryEventCryptoMeta) {
  return toUtf8Bytes(
    [
      "alisio-memory:event",
      "v1",
      meta.profileId,
      meta.deviceId,
      String(meta.lamport),
      meta.eventType,
      String(meta.schemaVersion),
      meta.eventId,
    ].join("\0"),
  );
}

export function buildBlobAad(blobId: string) {
  return toUtf8Bytes(["alisio-memory:blob", "v1", requireNonEmpty(blobId, "blobId")].join("\0"));
}

export async function encryptEventPayload(
  profileRootKey: BytesLike,
  meta: MemoryEventCryptoMeta,
  plaintextBytes: BytesLike,
) {
  const eventKey = deriveEventKey(profileRootKey, meta.eventId, "event-payload");
  return await encryptBytes(eventKey, plaintextBytes, buildEventPayloadAad(meta));
}

export async function decryptEventPayload(
  profileRootKey: BytesLike,
  meta: MemoryEventCryptoMeta,
  cipher: MemoryCipherBytes,
  telemetry?: MemoryCryptoTelemetry,
) {
  const eventKey = deriveEventKey(profileRootKey, meta.eventId, "event-payload");
  return await decryptBytes(
    eventKey,
    cipher.ciphertext,
    cipher.nonce,
    buildEventPayloadAad(meta),
    telemetry,
  );
}

export async function encryptBlob(profileRootKey: BytesLike, blobId: string, bytes: BytesLike) {
  const blobKey = deriveEventKey(profileRootKey, blobId, "blob");
  return await encryptBytes(blobKey, bytes, buildBlobAad(blobId));
}

export async function decryptBlob(
  profileRootKey: BytesLike,
  blobId: string,
  cipher: MemoryCipherBytes,
  telemetry?: MemoryCryptoTelemetry,
) {
  const blobKey = deriveEventKey(profileRootKey, blobId, "blob");
  return await decryptBytes(
    blobKey,
    cipher.ciphertext,
    cipher.nonce,
    buildBlobAad(blobId),
    telemetry,
  );
}

export function createMemoryCrypto(params: {
  profileRootKey: BytesLike;
  telemetry?: MemoryCryptoTelemetry;
}) {
  const profileRootKey = require32ByteKey(params.profileRootKey, "profileRootKey");
  return {
    deriveEventKey(eventId: string, purpose: string) {
      return deriveEventKey(profileRootKey, eventId, purpose);
    },
    encryptEventPayload(meta: MemoryEventCryptoMeta, plaintextBytes: BytesLike) {
      return encryptEventPayload(profileRootKey, meta, plaintextBytes);
    },
    decryptEventPayload(meta: MemoryEventCryptoMeta, cipher: MemoryCipherBytes) {
      return decryptEventPayload(profileRootKey, meta, cipher, params.telemetry);
    },
    encryptBlob(blobId: string, bytes: BytesLike) {
      return encryptBlob(profileRootKey, blobId, bytes);
    },
    decryptBlob(blobId: string, cipher: MemoryCipherBytes) {
      return decryptBlob(profileRootKey, blobId, cipher, params.telemetry);
    },
  };
}
