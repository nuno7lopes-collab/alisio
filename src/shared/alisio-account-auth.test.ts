import { describe, expect, it } from "vitest";
import {
  ALISIO_ACCOUNT_AUTH_CHANNEL,
  ALISIO_ACCOUNT_AUTH_SIGNAL_TYPE,
  ALISIO_ACCOUNT_AUTH_STORAGE_KEY,
  buildAlisioAccountAuthCompletionScript,
} from "./alisio-account-auth.js";

describe("alisio account auth completion script", () => {
  it("emite apenas a via canónica", () => {
    const script = buildAlisioAccountAuthCompletionScript({
      type: ALISIO_ACCOUNT_AUTH_SIGNAL_TYPE,
      method: "email",
      signalId: "signal-1",
      createdAtMs: 123,
    });

    expect(script).toContain(ALISIO_ACCOUNT_AUTH_STORAGE_KEY);
    expect(script).toContain(ALISIO_ACCOUNT_AUTH_CHANNEL);
    expect(script).toContain("localStorage.setItem(storageKey, serialized);");
    expect(script).toContain("new BroadcastChannel(channelName)");
  });
});
