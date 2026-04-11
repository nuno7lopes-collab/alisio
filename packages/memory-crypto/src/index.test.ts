import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  createMemoryCrypto,
  createMemoryCryptoTelemetryCollector,
  deriveProfileRootKey,
  exportPairingCode,
  importProfileKeyFromPairingCode,
  loadProfileRootKey,
  storeProfileRootKey,
} from "./index.js";

describe("@alisio/memory-crypto", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips encrypted event payloads and blobs", async () => {
    const profileRootKey = await deriveProfileRootKey({
      profileId: "profile-alpha",
      passphrase: "hunter2 with more entropy",
    });
    const crypto = createMemoryCrypto({ profileRootKey });
    const eventMeta = {
      profileId: "profile-alpha",
      deviceId: "device-a",
      lamport: 42,
      eventType: "ledger.memory.upsert",
      schemaVersion: 1,
      eventId: "evt-42",
    };
    const plaintext = new TextEncoder().encode("TOP_SECRET_EVENT_MARKER");
    const encryptedEvent = await crypto.encryptEventPayload(eventMeta, plaintext);
    const decryptedEvent = await crypto.decryptEventPayload(eventMeta, encryptedEvent);
    expect(Buffer.from(decryptedEvent)).toEqual(Buffer.from(plaintext));

    const blobCipher = await crypto.encryptBlob("blob-123", plaintext);
    const decryptedBlob = await crypto.decryptBlob("blob-123", blobCipher);
    expect(Buffer.from(decryptedBlob)).toEqual(Buffer.from(plaintext));
  });

  it("fails closed when event metadata, ciphertext, nonce, or blob id is tampered", async () => {
    const telemetry = createMemoryCryptoTelemetryCollector();
    const profileRootKey = await deriveProfileRootKey({
      profileId: "profile-beta",
      passphrase: "very secret passphrase",
    });
    const crypto = createMemoryCrypto({
      profileRootKey,
      telemetry: telemetry.telemetry,
    });
    const meta = {
      profileId: "profile-beta",
      deviceId: "device-b",
      lamport: 7,
      eventType: "ledger.memory.delete",
      schemaVersion: 1,
      eventId: "evt-007",
    };
    const plaintext = new TextEncoder().encode("tamper-me");
    const eventCipher = await crypto.encryptEventPayload(meta, plaintext);

    await expect(
      crypto.decryptEventPayload({ ...meta, lamport: meta.lamport + 1 }, eventCipher),
    ).rejects.toThrow(/decrypt failed/i);

    await expect(
      crypto.decryptEventPayload(meta, {
        ...eventCipher,
        nonce: Uint8Array.from(eventCipher.nonce, (value, index) =>
          index === 0 ? value ^ 0xff : value,
        ),
      }),
    ).rejects.toThrow(/decrypt failed/i);

    await expect(
      crypto.decryptEventPayload(meta, {
        ...eventCipher,
        ciphertext: Uint8Array.from(eventCipher.ciphertext, (value, index) =>
          index === eventCipher.ciphertext.length - 1 ? value ^ 0xff : value,
        ),
      }),
    ).rejects.toThrow(/decrypt failed/i);

    const blobCipher = await crypto.encryptBlob("blob-tamper", plaintext);
    await expect(crypto.decryptBlob("blob-wrong", blobCipher)).rejects.toThrow(/decrypt failed/i);
    expect(telemetry.getCounter("decrypt_failures")).toBe(4);
  });

  it("caches the profile root key locally and imports pairing codes without plaintext leakage", async () => {
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-memory-crypto-"));
    const stateDir = path.join(tempHome, ".alisio");
    vi.stubEnv("HOME", tempHome);
    vi.stubEnv("ALISIO_STATE_DIR", stateDir);

    const passphrase = "pairing passphrase with enough entropy";
    const profileId = "profile-gamma";
    const profileRootKey = await deriveProfileRootKey({ profileId, passphrase });
    const stored = await storeProfileRootKey({ profileId, profileRootKey });
    expect(stored.status).toBe("file");
    expect(stored.deviceKeyStoredIn).toBe("file");
    expect(__testing.resolveWrappedProfileRootKeyPath(profileId, stateDir)).toContain(".alisio");

    const loaded = await loadProfileRootKey({ profileId, passphrase, stateDir });
    expect(Buffer.from(loaded ?? [])).toEqual(Buffer.from(profileRootKey));

    const pairingCode = await exportPairingCode({
      profileId,
      passphrase,
      profileRootKey,
      sourceDeviceId: "device-origin",
    });
    expect(pairingCode).not.toContain("pairing passphrase");
    expect(pairingCode).not.toContain("profile-gamma-secret");

    const imported = await importProfileKeyFromPairingCode({
      pairingCode,
      passphrase,
      stateDir,
    });
    expect(imported.profileId).toBe(profileId);
    expect(imported.cached).toBe("file");
    expect(imported.sourceDeviceId).toBe("device-origin");
    expect(Buffer.from(imported.profileRootKey)).toEqual(Buffer.from(profileRootKey));
  });
});
