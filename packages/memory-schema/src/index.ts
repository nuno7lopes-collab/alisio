import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const MEMORY_EVENT_TYPES = [
  "PAGE_CREATED",
  "PAGE_TOMBSTONED",
  "DOC_CRDT_UPDATE",
  "DOC_CRDT_SNAPSHOT",
  "CLAIM_UPSERTED",
  "CLAIM_RETRACTED",
  "EVIDENCE_ADDED",
  "EVIDENCE_REMOVED",
  "LINK_ADDED",
  "LINK_REMOVED",
  "ATTACHMENT_ADDED",
  "ATTACHMENT_REMOVED",
  "RETRIEVAL_TRACE_RECORDED",
  "CHECKPOINT_CREATED",
  "JOB_CHECKPOINT_UPDATED",
] as const;

export type MemoryEventType = (typeof MEMORY_EVENT_TYPES)[number];

export const MEMORY_SCHEMA_VERSION = 1;
export const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;
export const CANONICAL_STABLE_ID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const ULID_TIME_CHARS = 10;
const ULID_RANDOM_CHARS = 16;
const ULID_RANDOM_BYTES = 10;
const ULID_TIMESTAMP_MAX = 0xffff_ffff_ffff;
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const textEncoder = new TextEncoder();

let lastGeneratedTimestamp = -1;
let lastGeneratedEntropy: Uint8Array<ArrayBuffer> = new Uint8Array(ULID_RANDOM_BYTES);

function cloneBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function encodeCrockford(value: bigint, width: number): string {
  let remaining = value;
  let output = "";
  for (let index = 0; index < width; index += 1) {
    output = CROCKFORD_BASE32[Number(remaining & 31n)] + output;
    remaining >>= 5n;
  }
  return output;
}

function validateTimestamp(nowMs: number): number {
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > ULID_TIMESTAMP_MAX) {
    throw new Error(
      `Stable IDs require an integer millisecond timestamp between 0 and ${ULID_TIMESTAMP_MAX}.`,
    );
  }
  return nowMs;
}

function copyEntropy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.length !== ULID_RANDOM_BYTES) {
    throw new Error(`Stable IDs require exactly ${ULID_RANDOM_BYTES} random bytes.`);
  }
  return cloneBytes(bytes);
}

function incrementEntropy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const next = cloneBytes(bytes);
  for (let index = next.length - 1; index >= 0; index -= 1) {
    if (next[index] === 0xff) {
      next[index] = 0;
      continue;
    }
    next[index] += 1;
    return next;
  }
  throw new Error("Stable ID monotonic entropy overflowed for a single millisecond.");
}

function encodeEntropy(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return encodeCrockford(value, ULID_RANDOM_CHARS);
}

function normalizeIdentifier(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} must not be empty.`);
  }
  return trimmed;
}

export const ByteArraySchema = z.instanceof(Uint8Array);
export const Sha256HexSchema = z
  .string()
  .regex(SHA256_HEX_REGEX, "Expected a lowercase sha256 hex digest.");
export const CanonicalStableIdSchema = z
  .string()
  .regex(CANONICAL_STABLE_ID_REGEX, "Expected a canonical uppercase ULID.");
export const EventIdSchema = CanonicalStableIdSchema;
export const PageIdSchema = CanonicalStableIdSchema;
export const ClaimIdSchema = CanonicalStableIdSchema;
export const BlobIdSchema = CanonicalStableIdSchema;
export const CheckpointIdSchema = CanonicalStableIdSchema;
export const EventTypeSchema = z.enum(MEMORY_EVENT_TYPES);

export const EventEnvelopeMetaSchema = z.object({
  eventId: EventIdSchema,
  profileId: z.string().trim().min(1),
  deviceId: z.string().trim().min(1),
  lamport: z.number().int().positive(),
  eventType: EventTypeSchema,
  createdAtMs: z.number().int().nonnegative(),
  schemaVersion: z.number().int().positive().default(MEMORY_SCHEMA_VERSION),
});

export const PlaintextPayloadEnvelopeSchema = z.object({
  kind: z.literal("plain"),
  bytes: ByteArraySchema,
});

export const EncryptedPayloadEnvelopeSchema = z.object({
  kind: z.literal("encrypted"),
  ciphertext: ByteArraySchema,
  nonce: ByteArraySchema,
  aad: ByteArraySchema.optional(),
});

export const EventPayloadEnvelopeSchema = z.discriminatedUnion("kind", [
  PlaintextPayloadEnvelopeSchema,
  EncryptedPayloadEnvelopeSchema,
]);

export const EventEnvelopeSchema = z.object({
  meta: EventEnvelopeMetaSchema,
  payload: EventPayloadEnvelopeSchema,
});

export const LedgerAppendPayloadSchema = z.union([ByteArraySchema, EncryptedPayloadEnvelopeSchema]);

export type CanonicalStableId = z.infer<typeof CanonicalStableIdSchema>;
export type Sha256Hex = z.infer<typeof Sha256HexSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type PageId = z.infer<typeof PageIdSchema>;
export type ClaimId = z.infer<typeof ClaimIdSchema>;
export type BlobId = z.infer<typeof BlobIdSchema>;
export type CheckpointId = z.infer<typeof CheckpointIdSchema>;
export type EventEnvelopeMeta = z.infer<typeof EventEnvelopeMetaSchema>;
export type PlaintextPayloadEnvelope = z.infer<typeof PlaintextPayloadEnvelopeSchema>;
export type EncryptedPayloadEnvelope = z.infer<typeof EncryptedPayloadEnvelopeSchema>;
export type EventPayloadEnvelope = z.infer<typeof EventPayloadEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;
export type LedgerAppendPayloadInput = Uint8Array | EncryptedPayloadEnvelope;

export const CANONICAL_STABLE_ID_RULES = [
  "Use canonical uppercase ULIDs for eventId, pageId, claimId, blobId, and checkpointId.",
  "Keep IDs immutable once published to the ledger.",
  "Generate IDs client-side so offline writers can append without coordination.",
  "Prefer monotonic ULIDs for event ordering within the same millisecond.",
] as const;

export function isCanonicalStableId(value: unknown): value is CanonicalStableId {
  return typeof value === "string" && CANONICAL_STABLE_ID_REGEX.test(value);
}

export function assertCanonicalStableId(
  value: unknown,
  fieldName = "id",
): asserts value is CanonicalStableId {
  const normalized = normalizeIdentifier(value, fieldName);
  if (!isCanonicalStableId(normalized)) {
    throw new Error(`${fieldName} must be a canonical uppercase ULID.`);
  }
}

export function createCanonicalStableId(params?: {
  nowMs?: number;
  random?: Uint8Array;
}): CanonicalStableId {
  const nowMs = validateTimestamp(params?.nowMs ?? Date.now());
  let entropy: Uint8Array<ArrayBuffer>;
  if (params?.random) {
    entropy = copyEntropy(params.random);
  } else if (nowMs === lastGeneratedTimestamp) {
    entropy = incrementEntropy(lastGeneratedEntropy);
  } else {
    entropy = cloneBytes(randomBytes(ULID_RANDOM_BYTES));
  }
  lastGeneratedTimestamp = nowMs;
  lastGeneratedEntropy = entropy;
  const encoded = `${encodeCrockford(BigInt(nowMs), ULID_TIME_CHARS)}${encodeEntropy(entropy)}`;
  return CanonicalStableIdSchema.parse(encoded);
}

export function computeSha256Hex(value: Uint8Array | string): string {
  const input = typeof value === "string" ? textEncoder.encode(value) : value;
  return createHash("sha256").update(input).digest("hex");
}

export function normalizeLedgerPayload(payload: LedgerAppendPayloadInput): EventPayloadEnvelope {
  if (payload instanceof Uint8Array) {
    return {
      kind: "plain",
      bytes: cloneBytes(payload),
    };
  }
  return EncryptedPayloadEnvelopeSchema.parse(payload);
}

export function payloadHashBytes(payload: EventPayloadEnvelope): Uint8Array {
  return payload.kind === "plain" ? payload.bytes : payload.ciphertext;
}

export function canonicalizeEventMetaForHash(meta: EventEnvelopeMeta): string {
  const normalized = EventEnvelopeMetaSchema.parse(meta);
  return JSON.stringify([
    normalized.eventId,
    normalized.profileId,
    normalized.deviceId,
    normalized.lamport,
    normalized.eventType,
    normalized.createdAtMs,
    normalized.schemaVersion,
  ]);
}

export function hashEventChain(params: {
  prevEventHash: string | null;
  payloadHash: string;
  meta: EventEnvelopeMeta;
}): string {
  const stableMeta = canonicalizeEventMetaForHash(params.meta);
  return computeSha256Hex(
    JSON.stringify([params.prevEventHash ?? "", params.payloadHash, stableMeta]),
  );
}
