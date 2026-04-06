import {
  generateSecureBrowserUuid,
  type BrowserCryptoLike as CryptoLike,
} from "../../../src/shared/secure-browser-random.js";

export function generateUUID(cryptoLike: CryptoLike | null = globalThis.crypto): string {
  return generateSecureBrowserUuid(cryptoLike);
}
