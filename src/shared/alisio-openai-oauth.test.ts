import { describe, expect, it } from "vitest";
import {
  ALISIO_OPENAI_OAUTH_CHANNEL,
  ALISIO_OPENAI_OAUTH_STORAGE_KEY,
  buildAlisioOpenAiOAuthCompletionScript,
  buildAlisioOpenAiOAuthSignal,
} from "./alisio-openai-oauth.js";

describe("alisio openai oauth signal", () => {
  it("builds a browser-safe completion script that notifies canonical listeners", () => {
    const signal = buildAlisioOpenAiOAuthSignal(123_456);
    const script = buildAlisioOpenAiOAuthCompletionScript(signal);

    expect(signal.type).toBe("openai-oauth-complete");
    expect(script).toContain(ALISIO_OPENAI_OAUTH_STORAGE_KEY);
    expect(script).toContain(ALISIO_OPENAI_OAUTH_CHANNEL);
    expect(script).toContain("localStorage.setItem");
    expect(script).toContain("BroadcastChannel");
    expect(script).toContain("window.close");
  });
});
