import {
  decodeBase64Url,
  decodeUtf8,
  decryptBytes,
  deriveProfileRootKey,
  encodeBase64Url,
  encryptBytes,
  serializeStoredCipher,
  toUint8Array,
} from "./crypto.js";
import { storeProfileRootKey } from "./storage.js";
import type {
  ExportPairingCodeParams,
  ImportPairingCodeParams,
  ImportedProfileKey,
  MemoryStoredCipher,
} from "./types.js";

type PairingEnvelope = {
  version: 1;
  profileId: string;
  createdAt: string;
  sourceDeviceId?: string;
  cipher: MemoryStoredCipher;
};

function buildPairingAad(envelope: Omit<PairingEnvelope, "cipher">) {
  return [
    "alisio-memory:pairing-code",
    "v1",
    envelope.profileId,
    envelope.createdAt,
    envelope.sourceDeviceId ?? "",
  ].join("\0");
}

export async function exportPairingCode(params: ExportPairingCodeParams) {
  const createdAt =
    params.createdAt instanceof Date
      ? params.createdAt.toISOString()
      : (params.createdAt ?? new Date().toISOString());
  const exportKey = await deriveProfileRootKey({
    profileId: params.profileId,
    passphrase: params.passphrase,
    namespace: "pairing-code",
  });
  const envelopeWithoutCipher = {
    version: 1 as const,
    profileId: params.profileId,
    createdAt,
    ...(params.sourceDeviceId ? { sourceDeviceId: params.sourceDeviceId } : {}),
  };
  const cipher = await encryptBytes(
    exportKey,
    toUint8Array(params.profileRootKey),
    buildPairingAad(envelopeWithoutCipher),
  );
  const envelope: PairingEnvelope = {
    ...envelopeWithoutCipher,
    cipher: serializeStoredCipher(cipher),
  };
  return encodeBase64Url(Buffer.from(JSON.stringify(envelope), "utf8"));
}

export async function importProfileKeyFromPairingCode(
  params: ImportPairingCodeParams,
): Promise<ImportedProfileKey> {
  const envelope = JSON.parse(decodeUtf8(decodeBase64Url(params.pairingCode))) as PairingEnvelope;

  if (envelope.version !== 1) {
    throw new Error(`Unsupported pairing code version: ${String(envelope.version)}`);
  }

  const importKey = await deriveProfileRootKey({
    profileId: envelope.profileId,
    passphrase: params.passphrase,
    namespace: "pairing-code",
  });
  const profileRootKey = await decryptBytes(
    importKey,
    Buffer.from(envelope.cipher.ciphertextBase64, "base64"),
    Buffer.from(envelope.cipher.nonceBase64, "base64"),
    buildPairingAad({
      version: envelope.version,
      profileId: envelope.profileId,
      createdAt: envelope.createdAt,
      ...(envelope.sourceDeviceId ? { sourceDeviceId: envelope.sourceDeviceId } : {}),
    }),
    params.telemetry,
  );

  if (params.cache === false) {
    return {
      profileId: envelope.profileId,
      profileRootKey,
      cached: "passphrase-only",
      createdAt: envelope.createdAt,
      ...(envelope.sourceDeviceId ? { sourceDeviceId: envelope.sourceDeviceId } : {}),
    };
  }

  const cached = await storeProfileRootKey({
    profileId: envelope.profileId,
    profileRootKey,
    stateDir: params.stateDir,
    env: params.env,
  });

  return {
    profileId: envelope.profileId,
    profileRootKey,
    cached: cached.status,
    createdAt: envelope.createdAt,
    ...(envelope.sourceDeviceId ? { sourceDeviceId: envelope.sourceDeviceId } : {}),
  };
}
