import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../test-utils/temp-dir.js";
import {
  deriveDeviceIdFromPublicKey,
  loadOrCreateDeviceIdentity,
  normalizeDevicePublicKeyBase64Url,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
  verifyDeviceSignature,
} from "./device-identity.js";

async function withIdentity(
  run: (identity: ReturnType<typeof loadOrCreateDeviceIdentity>) => void,
) {
  await withTempDir("alisio-device-identity-", async (dir) => {
    const identity = loadOrCreateDeviceIdentity(path.join(dir, "device.json"));
    run(identity);
  });
}

describe("device identity crypto helpers", () => {
  it("derives the same canonical raw key and device id from pem and encoded public keys", async () => {
    await withIdentity((identity) => {
      const publicKeyRaw = publicKeyRawBase64UrlFromPem(identity.publicKeyPem);
      const paddedBase64 = `${publicKeyRaw.replaceAll("-", "+").replaceAll("_", "/")}==`;

      expect(normalizeDevicePublicKeyBase64Url(identity.publicKeyPem)).toBe(publicKeyRaw);
      expect(normalizeDevicePublicKeyBase64Url(paddedBase64)).toBe(publicKeyRaw);
      expect(deriveDeviceIdFromPublicKey(identity.publicKeyPem)).toBe(identity.deviceId);
      expect(deriveDeviceIdFromPublicKey(publicKeyRaw)).toBe(identity.deviceId);
    });
  });

  it("signs payloads that verify against pem and raw public key forms", async () => {
    await withIdentity((identity) => {
      const payload = JSON.stringify({
        action: "system.run",
        ts: 1234,
      });
      const signature = signDevicePayload(identity.privateKeyPem, payload);
      const publicKeyRaw = publicKeyRawBase64UrlFromPem(identity.publicKeyPem);

      expect(verifyDeviceSignature(identity.publicKeyPem, payload, signature)).toBe(true);
      expect(verifyDeviceSignature(publicKeyRaw, payload, signature)).toBe(true);
      expect(verifyDeviceSignature(publicKeyRaw, `${payload}!`, signature)).toBe(false);
    });
  });

  it("fails closed for invalid public keys and signatures", async () => {
    await withIdentity((identity) => {
      const payload = "hello";
      const signature = signDevicePayload(identity.privateKeyPem, payload);

      expect(normalizeDevicePublicKeyBase64Url("-----BEGIN PUBLIC KEY-----broken")).toBeNull();
      expect(deriveDeviceIdFromPublicKey("%%%")).toBeNull();
      expect(verifyDeviceSignature("%%%invalid%%%", payload, signature)).toBe(false);
      expect(verifyDeviceSignature(identity.publicKeyPem, payload, "%%%invalid%%%")).toBe(false);
    });
  });

  it("migrates legacy raw-key identity files into canonical pem storage", async () => {
    await withTempDir("alisio-device-identity-legacy-", async (dir) => {
      const identityPath = path.join(dir, "device.json");
      const generated = loadOrCreateDeviceIdentity(identityPath);
      const privateKeyDer = crypto.createPrivateKey(generated.privateKeyPem).export({
        type: "pkcs8",
        format: "der",
      }) as Buffer;
      const rawPrivateKey = privateKeyDer.subarray(Buffer.from("302e020100300506032b657004220420", "hex").length);
      const rawPublicKeyBase64Url = publicKeyRawBase64UrlFromPem(generated.publicKeyPem);
      const paddedPublicKey = `${rawPublicKeyBase64Url.replaceAll("-", "+").replaceAll("_", "/")}${"=".repeat((4 - (rawPublicKeyBase64Url.length % 4)) % 4)}`;
      const rawPublicKeyBase64 = Buffer.from(
        paddedPublicKey,
        "base64",
      ).toString("base64");

      await fs.writeFile(
        identityPath,
        `${JSON.stringify(
          {
            version: 1,
            deviceId: generated.deviceId,
            publicKey: rawPublicKeyBase64,
            privateKey: rawPrivateKey.toString("base64"),
            createdAtMs: 123,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      const loaded = loadOrCreateDeviceIdentity(identityPath);
      const stored = JSON.parse(await fs.readFile(identityPath, "utf8")) as {
        version?: number;
        deviceId?: string;
        publicKeyPem?: string;
        privateKeyPem?: string;
      };

      expect(loaded).toEqual(generated);
      expect(stored.version).toBe(1);
      expect(stored.deviceId).toBe(generated.deviceId);
      expect(stored.publicKeyPem).toContain("BEGIN PUBLIC KEY");
      expect(stored.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    });
  });
});
