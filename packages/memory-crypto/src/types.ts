export type BytesLike = ArrayBuffer | ArrayBufferView | Uint8Array;

export type MemoryCryptoPurpose =
  | "event-payload"
  | "blob"
  | "pairing-code"
  | "profile-root"
  | "device-key"
  | (string & {});

export type MemoryEventCryptoMeta = {
  profileId: string;
  deviceId: string;
  lamport: number;
  eventType: string;
  schemaVersion: number;
  eventId: string;
};

export type MemoryCipherBytes = {
  algorithm: "AES-256-GCM";
  ciphertext: Uint8Array;
  nonce: Uint8Array;
};

export type MemoryStoredCipher = {
  algorithm: "AES-256-GCM";
  ciphertextBase64: string;
  nonceBase64: string;
};

export type MemoryCryptoCounter = "decrypt_failures";

export type MemoryCryptoTelemetry = {
  incrementCounter: (name: MemoryCryptoCounter, value?: number) => void;
};

export type DeriveProfileRootKeyParams = {
  profileId: string;
  passphrase: string;
  namespace?: string;
  costFactor?: number;
  blockSize?: number;
  parallelization?: number;
  maxMemoryBytes?: number;
};

export type LoadProfileRootKeyParams = {
  profileId: string;
  passphrase?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  telemetry?: MemoryCryptoTelemetry;
};

export type StoreProfileRootKeyParams = {
  profileId: string;
  profileRootKey: BytesLike;
  deviceKey?: BytesLike;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
};

export type StoreProfileRootKeyResult = {
  path: string;
  status: "keychain" | "file";
  deviceKeyStoredIn: "keychain" | "file";
};

export type SetupProfileRootKeyParams = {
  profileId: string;
  passphrase: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  telemetry?: MemoryCryptoTelemetry;
};

export type SetupProfileRootKeyResult = {
  profileId: string;
  profileRootKey: Uint8Array;
  action: "created" | "loaded";
  storedIn: "keychain" | "file";
  path: string;
};

export type LoadDeviceKeyParams = {
  profileId: string;
  profileRootKey?: BytesLike;
  passphrase?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  telemetry?: MemoryCryptoTelemetry;
};

export type StoreDeviceKeyParams = {
  profileId: string;
  profileRootKey: BytesLike;
  deviceKey?: BytesLike;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
};

export type StoredDeviceKeyResult = {
  deviceKey: Uint8Array;
  storedIn: "keychain" | "file";
};

export type ExportPairingCodeParams = {
  profileId: string;
  passphrase: string;
  profileRootKey: BytesLike;
  sourceDeviceId?: string;
  createdAt?: string | Date;
};

export type ImportedProfileKey = {
  profileId: string;
  profileRootKey: Uint8Array;
  cached: "keychain" | "file" | "passphrase-only";
  createdAt: string;
  sourceDeviceId?: string;
};

export type ImportPairingCodeParams = {
  pairingCode: string;
  passphrase: string;
  cache?: boolean;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
  telemetry?: MemoryCryptoTelemetry;
};
