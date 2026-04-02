import net from "node:net";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../test-helpers/temp-dir.js";
import { buildAlisioOpenAiAuthorization } from "./alisio-ai.js";
import { beginAlisioAiConnect, disconnectAlisioAi } from "./alisio-store.js";

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("No TCP address")));
        return;
      }
      const port = address.port;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

describe("Alisio OpenAI connect", () => {
  it("matches the upstream OpenAI Codex OAuth request shape", async () => {
    const result = await buildAlisioOpenAiAuthorization({
      callbackUrl: "https://example.com/__alisio/auth/openai/callback",
    });

    expect(result.pending.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.pending.stateToken).toMatch(/^[0-9a-f]{32}$/);

    const setupUrl = new URL(result.setupUrl);
    expect(setupUrl.searchParams.get("redirect_uri")).toBe(
      "https://example.com/__alisio/auth/openai/callback",
    );
    expect(setupUrl.searchParams.get("originator")).toBe("pi");
    expect(setupUrl.searchParams.get("state")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("relays local browser callbacks through localhost:1455", async () => {
    await withTempDir({ prefix: "alisio-ai-" }, async (root) => {
      const callbackPort = await getFreePort();
      const callbackUrl = `http://127.0.0.1:${callbackPort}/__alisio/auth/openai/callback`;

      const begin = await beginAlisioAiConnect({ callbackUrl }, {
        OPENCLAW_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

      const setupUrl = new URL(begin.setupUrl);
      expect(setupUrl.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
      expect(setupUrl.searchParams.get("originator")).toBe("pi");

      const state = setupUrl.searchParams.get("state");
      expect(state).toBeTruthy();

      const response = await fetch(
        `http://localhost:1455/auth/callback?code=test-code&state=${state}`,
        { redirect: "manual" },
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `http://127.0.0.1:${callbackPort}/__alisio/auth/openai/callback?code=test-code&state=${state}`,
      );

      await disconnectAlisioAi({ OPENCLAW_STATE_DIR: root } as NodeJS.ProcessEnv);
    });
  });

  it("keeps remote callback URLs unchanged", async () => {
    await withTempDir({ prefix: "alisio-ai-" }, async (root) => {
      const callbackUrl = "https://example.com/__alisio/auth/openai/callback";
      const begin = await beginAlisioAiConnect({ callbackUrl }, {
        OPENCLAW_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

      const setupUrl = new URL(begin.setupUrl);
      expect(setupUrl.searchParams.get("redirect_uri")).toBe(callbackUrl);
      expect(setupUrl.searchParams.get("originator")).toBe("pi");

      await disconnectAlisioAi({ OPENCLAW_STATE_DIR: root } as NodeJS.ProcessEnv);
    });
  });
});
