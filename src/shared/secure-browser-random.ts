export type BrowserCryptoLike = {
  randomUUID?: (() => string) | undefined;
  getRandomValues?: (<T extends Exclude<BufferSource, ArrayBuffer>>(array: T) => T) | undefined;
};

function formatUuidFromBytes(bytes: Uint8Array): string {
  const uuidBytes = Uint8Array.from(bytes);
  // Preserve RFC 4122 v4 semantics when we only have getRandomValues.
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;

  let hex = "";
  for (const byte of uuidBytes) {
    hex += byte.toString(16).padStart(2, "0");
  }

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}

export function generateSecureBrowserUuid(
  cryptoLike: BrowserCryptoLike | null = globalThis.crypto,
): string {
  if (cryptoLike && typeof cryptoLike.randomUUID === "function") {
    return cryptoLike.randomUUID();
  }

  if (cryptoLike && typeof cryptoLike.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoLike.getRandomValues(bytes);
    return formatUuidFromBytes(bytes);
  }

  throw new Error("Secure browser randomness requires the Web Crypto API.");
}
