import { describe, expect, it } from "vitest";
import {
  CANONICAL_STABLE_ID_RULES,
  EventEnvelopeSchema,
  canonicalizeEventMetaForHash,
  createCanonicalStableId,
  hashEventChain,
  normalizeLedgerPayload,
} from "./index.js";

describe("@alisio/memory-schema", () => {
  it("creates canonical ULID-style stable IDs", () => {
    const stableId = createCanonicalStableId({
      nowMs: 1_717_171_717_171,
      random: new Uint8Array([1, 35, 69, 103, 137, 171, 205, 239, 16, 32]),
    });

    expect(stableId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(CANONICAL_STABLE_ID_RULES[0]).toContain("ULIDs");
  });

  it("validates plain and encrypted envelopes", () => {
    const meta = {
      eventId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      profileId: "profile-main",
      deviceId: "device-a",
      lamport: 1,
      eventType: "DOC_CRDT_UPDATE" as const,
      createdAtMs: 1_700_000_000_000,
      schemaVersion: 1,
    };

    expect(
      EventEnvelopeSchema.parse({
        meta,
        payload: normalizeLedgerPayload(new Uint8Array([1, 2, 3])),
      }),
    ).toEqual({
      meta,
      payload: {
        kind: "plain",
        bytes: new Uint8Array([1, 2, 3]),
      },
    });

    expect(
      EventEnvelopeSchema.parse({
        meta,
        payload: normalizeLedgerPayload({
          kind: "encrypted",
          ciphertext: new Uint8Array([9, 8, 7]),
          nonce: new Uint8Array([6, 5, 4]),
          aad: new Uint8Array([3, 2, 1]),
        }),
      }),
    ).toMatchObject({
      meta,
      payload: {
        kind: "encrypted",
      },
    });
  });

  it("hashes stable metadata deterministically", () => {
    const meta = {
      eventId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      profileId: "profile-main",
      deviceId: "device-a",
      lamport: 7,
      eventType: "CHECKPOINT_CREATED" as const,
      createdAtMs: 1_700_000_000_700,
      schemaVersion: 1,
    };

    const stableMeta = canonicalizeEventMetaForHash(meta);
    const eventHash = hashEventChain({
      prevEventHash: null,
      payloadHash: "a".repeat(64),
      meta,
    });

    expect(stableMeta).toBe(
      JSON.stringify([
        "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "profile-main",
        "device-a",
        7,
        "CHECKPOINT_CREATED",
        1_700_000_000_700,
        1,
      ]),
    );
    expect(eventHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
