import { describe, expect, it, vi } from "vitest";
import { OpenAICodexOAuthManager } from "./openai-codex-oauth.js";

describe("OpenAICodexOAuthManager", () => {
  it("usa o fluxo manual remoto para evitar a porta de callback partilhada", async () => {
    const login = vi.fn(
      async (params: {
        runtime: { log: (...args: unknown[]) => void };
        openUrl: (url: string) => Promise<void>;
        prompter: { text: (params: { message: string }) => Promise<string> };
      }) => {
        await params.openUrl("https://example.com/oauth");
        params.runtime.log("Open this URL in your LOCAL browser:\n\nhttps://example.com/oauth\n");
        const manualCode = await params.prompter.text({
          message: "Paste the authorization code (or full redirect URL):",
        });
        expect(manualCode).toBe("manual-code");
        return {
          provider: "openai-codex" as const,
          access: "oauth-access-token",
          refresh: "oauth-refresh-token",
          expires: Date.now() + 60_000,
          email: "nuno@example.com",
        };
      },
    );
    const writeOAuthCredentials = vi.fn(async () => "openai-codex:isolated");

    const manager = new OpenAICodexOAuthManager({
      login,
      writeOAuthCredentials,
    });

    const started = await manager.start();
    expect(started.phase).toBe("waiting_manual");
    expect(started.authUrl).toBe("https://example.com/oauth");

    manager.submitManual("manual-code");

    await vi.waitFor(() => {
      const snapshot = manager.getSnapshot();
      expect(snapshot.phase).toBe("success");
      expect(snapshot.connected).toBe(true);
      expect(snapshot.profileId).toBe("openai-codex:isolated");
    });
  });
});
