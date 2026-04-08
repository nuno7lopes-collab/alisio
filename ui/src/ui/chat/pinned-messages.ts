import { legacyColonKey } from "../../brand-compat.ts";
import { getSafeLocalStorage } from "../../local-storage.ts";

const PREFIX = "alisio:pinned:";
const LEGACY_PREFIX = `${legacyColonKey("pinned")}:`;

export class PinnedMessages {
  private key: string;
  private _indices = new Set<number>();

  constructor(sessionKey: string) {
    this.key = PREFIX + sessionKey;
    this.load();
  }

  get indices(): Set<number> {
    return this._indices;
  }

  has(index: number): boolean {
    return this._indices.has(index);
  }

  pin(index: number): void {
    this._indices.add(index);
    this.save();
  }

  unpin(index: number): void {
    this._indices.delete(index);
    this.save();
  }

  toggle(index: number): void {
    if (this._indices.has(index)) {
      this.unpin(index);
    } else {
      this.pin(index);
    }
  }

  clear(): void {
    this._indices.clear();
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
        this._indices = new Set(arr.filter((n) => typeof n === "number"));
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
      storage?.setItem(this.key, JSON.stringify([...this._indices]));
      storage?.removeItem(LEGACY_PREFIX + this.key.slice(PREFIX.length));
    } catch {
      // ignore
    }
  }
}
