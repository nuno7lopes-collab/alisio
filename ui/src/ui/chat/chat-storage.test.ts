/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSafeLocalStorage } from "../../local-storage.ts";
import { DeletedMessages } from "./deleted-messages.ts";
import { PinnedMessages } from "./pinned-messages.ts";

beforeEach(() => {
  vi.stubGlobal("localStorage", window.localStorage);
});

afterEach(() => {
  getSafeLocalStorage()?.clear();
  vi.unstubAllGlobals();
});

describe("chat storage keys", () => {
  it("loads pinned messages from the legacy key and resaves them under alisio", () => {
    const storage = getSafeLocalStorage();
    storage?.setItem("\u006fpen\u0063law:pinned:main", JSON.stringify([1, 4]));

    const pinned = new PinnedMessages("main");
    pinned.pin(7);

    expect(pinned.has(1)).toBe(true);
    expect(pinned.has(4)).toBe(true);
    expect(pinned.has(7)).toBe(true);
    expect(storage?.getItem("alisio:pinned:main")).toBe(JSON.stringify([1, 4, 7]));
    expect(storage?.getItem("\u006fpen\u0063law:pinned:main")).toBeNull();
  });

  it("loads deleted messages from the legacy key and resaves them under alisio", () => {
    const storage = getSafeLocalStorage();
    storage?.setItem("\u006fpen\u0063law:deleted:main", JSON.stringify(["a", "b"]));

    const deleted = new DeletedMessages("main");
    deleted.delete("c");

    expect(deleted.has("a")).toBe(true);
    expect(deleted.has("b")).toBe(true);
    expect(deleted.has("c")).toBe(true);
    expect(storage?.getItem("alisio:deleted:main")).toBe(JSON.stringify(["a", "b", "c"]));
    expect(storage?.getItem("\u006fpen\u0063law:deleted:main")).toBeNull();
  });
});
