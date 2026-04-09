/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALISIO_ACCOUNT_AUTH_CHANNEL,
  ALISIO_ACCOUNT_AUTH_SIGNAL_TYPE,
  ALISIO_ACCOUNT_AUTH_STORAGE_KEY,
  LEGACY_ALISIO_ACCOUNT_AUTH_CHANNEL,
  LEGACY_ALISIO_ACCOUNT_AUTH_STORAGE_KEY,
  type AlisioAccountAuthSignal,
} from "../../../src/shared/alisio-account-auth.js";
import { emitAlisioAccountAuthSignal } from "./alisio-account-auth.ts";

describe("emitAlisioAccountAuthSignal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("emite storage e BroadcastChannel canónicos e legacy", () => {
    const posted: Array<{ name: string; message: unknown }> = [];

    class BroadcastChannelMock {
      constructor(private readonly name: string) {}

      postMessage(message: unknown) {
        posted.push({ name: this.name, message });
      }

      close() {}
    }

    vi.stubGlobal("BroadcastChannel", BroadcastChannelMock);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const removeItemSpy = vi.spyOn(Storage.prototype, "removeItem");
    const signal: AlisioAccountAuthSignal = {
      type: ALISIO_ACCOUNT_AUTH_SIGNAL_TYPE,
      method: "email",
      signalId: "signal-1",
      createdAtMs: 123,
    };

    expect(emitAlisioAccountAuthSignal(signal)).toEqual(signal);
    expect(setItemSpy).toHaveBeenCalledWith(
      ALISIO_ACCOUNT_AUTH_STORAGE_KEY,
      JSON.stringify(signal),
    );
    expect(setItemSpy).toHaveBeenCalledWith(
      LEGACY_ALISIO_ACCOUNT_AUTH_STORAGE_KEY,
      JSON.stringify(signal),
    );
    expect(removeItemSpy).toHaveBeenCalledWith(ALISIO_ACCOUNT_AUTH_STORAGE_KEY);
    expect(removeItemSpy).toHaveBeenCalledWith(LEGACY_ALISIO_ACCOUNT_AUTH_STORAGE_KEY);
    expect(posted).toEqual([
      { name: ALISIO_ACCOUNT_AUTH_CHANNEL, message: signal },
      { name: LEGACY_ALISIO_ACCOUNT_AUTH_CHANNEL, message: signal },
    ]);
  });
});
