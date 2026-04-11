import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCanonicalStableId, computeSha256Hex } from "../../memory-schema/src/index.js";
import { bootstrapGenesisFromLegacySnapshot, openLedger } from "./index.js";
import { resolveLedgerSqlitePath } from "./paths.js";

function makeTempStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "alisio-memory-ledger-"));
}

function makeEventId(index: number): string {
  return createCanonicalStableId({
    nowMs: 1_700_000_000_000 + index,
    random: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, index & 0xff]),
  });
}

function makeCheckpointId(index: number): string {
  return createCanonicalStableId({
    nowMs: 1_700_100_000_000 + index,
    random: new Uint8Array([1, 1, 1, 1, 1, 1, 1, 1, 1, index & 0xff]),
  });
}

function makeMeta(
  index: number,
  eventType: "DOC_CRDT_UPDATE" | "DOC_CRDT_SNAPSHOT" = "DOC_CRDT_UPDATE",
) {
  return {
    eventId: makeEventId(index),
    profileId: "profile-main",
    deviceId: "device-a",
    lamport: index + 1,
    eventType,
    createdAtMs: 1_700_000_000_000 + index,
    schemaVersion: 1,
  } as const;
}

const tempRoots = new Set<string>();

afterEach(() => {
  for (const tempRoot of tempRoots) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  tempRoots.clear();
});

describe("@alisio/memory-ledger", () => {
  it("appends, lists, and reads back plain and encrypted events", () => {
    const stateDir = makeTempStateDir();
    tempRoots.add(stateDir);
    const telemetry = {
      appended: [] as Array<{ status: string; eventType: string }>,
    };
    const ledger = openLedger("profile-main", {
      stateDir,
      telemetry: {
        onAppend(event) {
          telemetry.appended.push({ status: event.status, eventType: event.eventType });
        },
      },
    });

    const first = ledger.appendEvent(makeMeta(0), new Uint8Array([1, 2, 3]));
    const second = ledger.appendEvent(
      {
        ...makeMeta(1),
        eventType: "DOC_CRDT_SNAPSHOT",
      },
      {
        kind: "encrypted",
        ciphertext: new Uint8Array([9, 8, 7]),
        nonce: new Uint8Array([6, 5, 4]),
        aad: new Uint8Array([3, 2, 1]),
      },
    );

    expect(first.status).toBe("inserted");
    expect(second.status).toBe("inserted");
    expect(ledger.listEventsSince(0, 10)).toHaveLength(2);
    expect(ledger.getEventById(first.eventId)?.payload.kind).toBe("plain");
    expect(ledger.getEventById(second.eventId)?.payload.kind).toBe("encrypted");
    expect(telemetry.appended).toEqual([
      { status: "inserted", eventType: "DOC_CRDT_UPDATE" },
      { status: "inserted", eventType: "DOC_CRDT_SNAPSHOT" },
    ]);

    ledger.close();
  });

  it("is idempotent for an existing eventId", () => {
    const stateDir = makeTempStateDir();
    tempRoots.add(stateDir);
    const ledger = openLedger("profile-main", { stateDir });
    const meta = makeMeta(0);

    const inserted = ledger.appendEvent(meta, new Uint8Array([1, 2, 3]));
    const duplicate = ledger.appendEvent(meta, new Uint8Array([1, 2, 3]));

    expect(duplicate).toEqual({
      eventId: inserted.eventId,
      eventHash: inserted.eventHash,
      status: "duplicate",
    });
    expect(ledger.listEventsSince(0, 10)).toHaveLength(1);

    ledger.close();
  });

  it("records acks, creates checkpoints, and plans compaction conservatively", () => {
    const stateDir = makeTempStateDir();
    tempRoots.add(stateDir);
    const compactionPlans: Array<number | undefined> = [];
    const ledger = openLedger("profile-main", {
      stateDir,
      telemetry: {
        onCompactionPlan(event) {
          compactionPlans.push(event.safeUntilLamport);
        },
      },
    });

    const event1 = ledger.appendEvent(makeMeta(0), new Uint8Array([1]));
    const event2 = ledger.appendEvent(makeMeta(1), new Uint8Array([2]));
    ledger.recordAck("replica-a", 2, event2.eventId);
    ledger.recordAck("replica-b", 1, event1.eventId);

    const checkpoint = ledger.createCheckpoint(
      makeCheckpointId(0),
      2,
      computeSha256Hex(new Uint8Array([9, 9, 9])),
      new Uint8Array([7, 7, 7]),
    );
    const latestCheckpoint = ledger.getLatestCheckpoint();
    const plan = ledger.planCompaction();

    expect(ledger.getAckVector()).toEqual({
      "replica-a": 2,
      "replica-b": 1,
    });
    expect(latestCheckpoint).toEqual(checkpoint);
    expect(plan).toEqual({
      safeDeleteUntilLamport: 1,
      ackFloorLamport: 1,
      checkpointLamport: 2,
      checkpointId: checkpoint.checkpointId,
    });
    expect(compactionPlans).toEqual([1]);

    ledger.close();
  });

  it("produces the same final event hash for the same sequence", () => {
    const firstStateDir = makeTempStateDir();
    const secondStateDir = makeTempStateDir();
    tempRoots.add(firstStateDir);
    tempRoots.add(secondStateDir);

    const sequence = [
      { meta: makeMeta(0), payload: new Uint8Array([1, 2, 3]) },
      {
        meta: { ...makeMeta(1), deviceId: "device-b", lamport: 2, eventId: makeEventId(10) },
        payload: new Uint8Array([4, 5, 6]),
      },
      { meta: makeMeta(2), payload: new Uint8Array([7, 8, 9]) },
    ] as const;

    const ledgerA = openLedger("profile-main", { stateDir: firstStateDir });
    const ledgerB = openLedger("profile-main", { stateDir: secondStateDir });

    const lastA = ledgerA.appendBatch(sequence).at(-1);
    const lastB = ledgerB.appendBatch(sequence).at(-1);

    expect(lastA?.eventHash).toBe(lastB?.eventHash);

    ledgerA.close();
    ledgerB.close();
  });

  it("rejects out-of-order lamports", () => {
    const stateDir = makeTempStateDir();
    tempRoots.add(stateDir);
    const corruptions: string[] = [];
    const ledger = openLedger("profile-main", {
      stateDir,
      telemetry: {
        onCorruptionDetected(event) {
          corruptions.push(event.code);
        },
      },
    });

    ledger.appendEvent(makeMeta(0), new Uint8Array([1]));
    expect(() =>
      ledger.appendEvent(
        {
          ...makeMeta(1),
          lamport: 1,
          eventId: makeEventId(9),
        },
        new Uint8Array([2]),
      ),
    ).toThrow(/Out-of-order/);
    expect(corruptions).toContain("out_of_order_lamport");

    ledger.close();
  });

  it("bootstraps a genesis stub for GAIA", () => {
    expect(bootstrapGenesisFromLegacySnapshot()).toEqual({
      status: "pending-gaia-legacy-import",
      requiredFields: ["profileId", "deviceId", "snapshotBytes", "stateHash"],
      suggestedGenesisEvent: {
        eventType: "DOC_CRDT_SNAPSHOT",
        lamport: 1,
        schemaVersion: 1,
      },
      suggestedCheckpoint: {
        eventType: "CHECKPOINT_CREATED",
        coveredUntilLamport: 1,
      },
    });
  });

  it("appends 10k events in a reasonable smoke budget", { timeout: 30_000 }, () => {
    const stateDir = makeTempStateDir();
    tempRoots.add(stateDir);
    const ledger = openLedger("profile-main", { stateDir });
    const batch = Array.from({ length: 10_000 }, (_, index) => ({
      meta: {
        eventId: createCanonicalStableId({
          nowMs: 1_800_000_000_000 + index,
          random: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, (index >> 8) & 0xff, index & 0xff]),
        }),
        profileId: "profile-main",
        deviceId: "device-a",
        lamport: index + 1,
        eventType: "DOC_CRDT_UPDATE" as const,
        createdAtMs: 1_800_000_000_000 + index,
        schemaVersion: 1,
      },
      payload: new Uint8Array([index & 0xff, (index >> 8) & 0xff]),
    }));

    const startedAt = Date.now();
    const results = ledger.appendBatch(batch);
    const durationMs = Date.now() - startedAt;

    expect(results).toHaveLength(10_000);
    expect(ledger.listEventsSince(0, 10_001)).toHaveLength(10_000);
    expect(durationMs).toBeLessThan(15_000);
    expect(
      resolveLedgerSqlitePath({
        profileId: "profile-main",
        stateDir,
      }),
    ).toBe(path.join(stateDir, "state", "profile-main", "memory", "ledger.sqlite"));

    ledger.close();
  });
});
