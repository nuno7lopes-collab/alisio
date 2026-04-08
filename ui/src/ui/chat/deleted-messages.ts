import { legacyColonKey } from "../../brand-compat.ts";
import { getSafeLocalStorage } from "../../local-storage.ts";

const PREFIX = "alisio:deleted:";
const LEGACY_PREFIX = `${legacyColonKey("deleted")}:`;

export class DeletedMessages {
  private key: string;
  private _keys = new Set<string>();

  constructor(sessionKey: string) {
    this.key = PREFIX + sessionKey;
    this.load();
  }

  has(key: string): boolean {
    return this._keys.has(key);
  }

  delete(key: string): void {
    this._keys.add(key);
    this.save();
  }

  restore(key: string): void {
    this._keys.delete(key);
    this.save();
  }

  clear(): void {
    this._keys.clear();
    this.save();
  }

  private load(): void {
    try {
      const storage = getSafeLocalStorage();
      const raw = storage?.getItem(this.key);
      const legacyKey = LEGACY_PREFIX + this.key.slice(PREFIX.length);
      const legacyRaw = raw ? null : storage?.getItem(legacyKey);
      const source = raw ?? legacyRaw;
      if (!source) {
        return;
      }
      const arr = JSON.parse(source);
      if (Array.isArray(arr)) {
        this._keys = new Set(arr.filter((s) => typeof s === "string"));
        if (legacyRaw) {
          this.save();
        }
      }
    } catch {
      // ignore
    }
  }

  private save(): void {
    try {
      const storage = getSafeLocalStorage();
      storage?.setItem(this.key, JSON.stringify([...this._keys]));
      storage?.removeItem(LEGACY_PREFIX + this.key.slice(PREFIX.length));
    } catch {
      // ignore
    }
  }
}
