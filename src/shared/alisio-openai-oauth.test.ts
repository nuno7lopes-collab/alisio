import { describe, expect, it } from "vitest";
import {
  ALISIO_OPENAI_OAUTH_CHANNEL,
  ALISIO_OPENAI_OAUTH_STORAGE_KEY,
  LEGACY_ALISIO_OPENAI_OAUTH_CHANNEL,
  LEGACY_ALISIO_OPENAI_OAUTH_STORAGE_KEY,
  buildAlisioOpenAiOAuthCompletionScript,
  buildAlisioOpenAiOAuthSignal,
} from "./alisio-openai-oauth.js";

describe("alisio openai oauth signal", () => {
  it("builds a browser-safe completion script that notifies canonical and legacy listeners", () => {
    const signal = buildAlisioOpenAiOAuthSignal(123_456);
    const script = buildAlisioOpenAiOAuthCompletionScript(signal);

    expect(signal.type).toBe("openai-oauth-complete");
    expect(script).toContain(ALISIO_OPENAI_OAUTH_STORAGE_KEY);
    expect(script).toContain(LEGACY_ALISIO_OPENAI_OAUTH_STORAGE_KEY);
    expect(script).toContain(ALISIO_OPENAI_OAUTH_CHANNEL);
    expect(script).toContain(LEGACY_ALISIO_OPENAI_OAUTH_CHANNEL);
    expect(script).toContain("localStorage.setItem");
    expect(script).toContain("localStorage.setItem(legacyStorageKey, serialized);");
    expect(script).toContain("BroadcastChannel");
    expect(script).toContain("new BroadcastChannel(legacyChannelName)");
    expect(script).toContain("window.close");
  });
});
