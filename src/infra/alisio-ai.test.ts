import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAuthTestLifecycle, setupAuthTestEnv } from "../../test/helpers/auth-wizard.js";
import { ensureAuthProfileStore } from "../agents/auth-profiles.js";
import { resolveAuthStorePath } from "../agents/auth-profiles/paths.js";
import { resolveConfigPath } from "../config/paths.js";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  applyAlisioOpenAiRuntime,
  buildAlisioOpenAiAuthorization,
  refreshAlisioOpenAiSession,
  resolveAlisioOpenAiTokenIdentity,
} from "./alisio-ai.js";
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

function createJwt(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

async function createReadyAlisioAccountEnv(root: string): Promise<NodeJS.ProcessEnv> {
  const env = {
    ALISIO_STATE_DIR: root,
    ALISIO_SUPABASE_URL: "https://example.supabase.co",
    ALISIO_SUPABASE_ANON_KEY: "anon-key",
  } as NodeJS.ProcessEnv;
  const statePath = path.join(root, "alisio", "state.json");
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(
    statePath,
    JSON.stringify(
      {
        version: 1,
        account: {
          profile: {
            userId: "user-1",
            username: "nuno",
            displayName: "Nuno Lopes",
            email: "nuno@example.com",
            avatarLabel: "N",
            joinedAt: "2026-04-04T15:00:00.000Z",
            plan: "free",
            backend: "supabase",
          },
          preferences: {
            language: "pt-PT",
            themeFamily: DEFAULT_THEME_FAMILY,
            themeMode: "dark",
            themeAccents: DEFAULT_THEME_ACCENTS,
          },
          session: {
            state: "signed_in",
            profileCompleted: true,
            signedInAt: "2026-04-04T15:00:00.000Z",
            backend: "supabase",
          },
        },
        organization: {
          mode: "none",
        },
        ai: {},
        authorizations: {},
        oauthCredentials: {},
        pendingAuthorizations: {},
      },
      null,
      2,
    ),
  );
  return env;
}

describe("Alisio OpenAI connect", () => {
  it("extracts canonical account identity and email from OpenAI token claims", () => {
    const token = createJwt({
      sub: "google-oauth2|shared-user",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_123",
        chatgpt_account_user_id: "account-user-123",
        chatgpt_user_id: "google-oauth2|shared-user",
        chatgpt_plan_type: "team",
      },
      "https://api.openai.com/profile": {
        email: "Nuno7Lopes@gmail.com",
      },
    });

    expect(resolveAlisioOpenAiTokenIdentity(token)).toEqual({
      accountId: "acct_123",
      accountUserId: "account-user-123",
      userId: "google-oauth2|shared-user",
      email: "nuno7lopes@gmail.com",
      planType: "team",
    });
  });

  it("forces a fresh telemetry fetch when requested even if cached telemetry is still fresh", async () => {
    const accessToken = createJwt({
      sub: "google-oauth2|shared-user",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "acct_123",
        chatgpt_account_user_id: "account-user-123",
        chatgpt_user_id: "google-oauth2|shared-user",
        chatgpt_plan_type: "team",
      },
      "https://api.openai.com/profile": {
        email: "Nuno7Lopes@gmail.com",
      },
    });
    const credential = {
      provider: "openai" as const,
      aiProfileId: "profile-1",
      workerId: "local:test",
      authProfileId: "openai-codex:test",
      runtimeState: "connected" as const,
      accessToken,
      refreshToken: "refresh-token",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      createdAt: new Date().toISOString(),
      localTelemetry: {
        source: "official" as const,
        planType: "team",
        observedAt: new Date().toISOString(),
        staleAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        primaryWindow: {
          label: "5h",
          durationMinutes: 300,
          usedPercent: 10,
          remainingPercent: 90,
        },
      },
    };
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          plan_type: "pro",
          rate_limit: {
            primary_window: {
              limit_window_seconds: 18_000,
              used_percent: 75,
              reset_at: Math.round(Date.now() / 1000) + 1800,
            },
          },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const cached = await refreshAlisioOpenAiSession({
      credential,
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(cached.localTelemetry?.planType).toBe("team");

    const refreshed = await refreshAlisioOpenAiSession({
      credential,
      fetchImpl: fetchImpl as typeof fetch,
      forceTelemetry: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(refreshed.localTelemetry?.planType).toBe("pro");
    expect(refreshed.localTelemetry?.primaryWindow?.usedPercent).toBe(75);
    expect(refreshed.localTelemetry?.primaryWindow?.remainingPercent).toBe(25);
  });

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

  it("relays local browser callbacks through the configured localhost relay", async () => {
    await withTempDir({ prefix: "alisio-ai-" }, async (root) => {
      const callbackPort = await getFreePort();
      const relayPort = await getFreePort();
      const callbackUrl = `http://127.0.0.1:${callbackPort}/__alisio/auth/openai/callback`;
      const env = await createReadyAlisioAccountEnv(root);

      const begin = await buildAlisioOpenAiAuthorization({
        callbackUrl,
        loopbackPort: relayPort,
      });

      const setupUrl = new URL(begin.setupUrl);
      expect(setupUrl.searchParams.get("redirect_uri")).toBe(
        `http://localhost:${relayPort}/auth/callback`,
      );
      expect(setupUrl.searchParams.get("originator")).toBe("pi");

      const state = setupUrl.searchParams.get("state");
      expect(state).toBeTruthy();

      const response = await fetch(
        `http://localhost:${relayPort}/auth/callback?code=test-code&state=${state}`,
        { redirect: "manual" },
      );

      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe(
        `http://127.0.0.1:${callbackPort}/__alisio/auth/openai/callback?code=test-code&state=${state}`,
      );

      const storedBegin = await beginAlisioAiConnect({ callbackUrl }, env);
      expect(storedBegin.setupUrl).toContain("originator=pi");
      await disconnectAlisioAi(undefined, env);
    });
  });

  it("keeps remote callback URLs unchanged", async () => {
    await withTempDir({ prefix: "alisio-ai-" }, async (root) => {
      const callbackUrl = "https://example.com/__alisio/auth/openai/callback";
      const env = await createReadyAlisioAccountEnv(root);
      const begin = await beginAlisioAiConnect({ callbackUrl }, env);

      const setupUrl = new URL(begin.setupUrl);
      expect(setupUrl.searchParams.get("redirect_uri")).toBe(callbackUrl);
      expect(setupUrl.searchParams.get("originator")).toBe("pi");

      await disconnectAlisioAi(undefined, env);
    });
  });

  it("keeps active OpenAI runtime profiles in memory without persisting auth store secrets", async () => {
    const lifecycle = createAuthTestLifecycle([
      "ALISIO_STATE_DIR",
      "ALISIO_AGENT_DIR",
      "PI_CODING_AGENT_DIR",
      "ALISIO_CONFIG_PATH",
    ]);
    const env = await setupAuthTestEnv("alisio-runtime-");
    lifecycle.setStateDir(env.stateDir);
    try {
      const configPath = resolveConfigPath(process.env);
      await applyAlisioOpenAiRuntime(
        {
          authProfileId: "openai-codex:alisio-primary",
          accessToken: "access-primary",
          refreshToken: "refresh-primary",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          email: "primary@example.com",
        },
        { displayName: "Primary" },
      );
      const configAfterPrimary = await fs.readFile(configPath, "utf8");
      await applyAlisioOpenAiRuntime(
        {
          authProfileId: "openai-codex:alisio-secondary",
          accessToken: "access-secondary",
          refreshToken: "refresh-secondary",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          email: "secondary@example.com",
        },
        { displayName: "Secondary" },
      );
      const configAfterSecondary = await fs.readFile(configPath, "utf8");

      await expect(fs.readFile(resolveAuthStorePath(env.agentDir), "utf8")).rejects.toThrow(
        /ENOENT/,
      );

      const runtimeStore = ensureAuthProfileStore(env.agentDir, {
        allowKeychainPrompt: false,
      });
      expect(runtimeStore.profiles["openai-codex:alisio-primary"]).toMatchObject({
        type: "oauth",
        email: "primary@example.com",
        displayName: "Primary",
      });
      expect(runtimeStore.profiles["openai-codex:alisio-secondary"]).toMatchObject({
        type: "oauth",
        email: "secondary@example.com",
        displayName: "Secondary",
      });
      expect(runtimeStore.order?.["openai-codex"]).toEqual([
        "openai-codex:alisio-secondary",
        "openai-codex:alisio-primary",
      ]);
      expect(configAfterSecondary).toBe(configAfterPrimary);

      const config = JSON.parse(configAfterSecondary) as {
        agents?: {
          defaults?: {
            model?: string | { primary?: string };
            models?: Record<string, unknown>;
          };
        };
        auth?: { profiles?: Record<string, unknown>; order?: Record<string, string[]> };
      };
      expect(config.agents?.defaults?.model).toEqual({ primary: "openai-codex/gpt-5.4" });
      expect(config.agents?.defaults?.models?.["openai-codex/gpt-5.4"]).toEqual({});
      expect(config.auth?.profiles?.["openai-codex:alisio-primary"]).toBeUndefined();
      expect(config.auth?.profiles?.["openai-codex:alisio-secondary"]).toBeUndefined();
      expect(config.auth?.order?.["openai-codex"]).toBeUndefined();
    } finally {
      await lifecycle.cleanup();
    }
  });

  it("preserves an explicit OpenAI Codex model instead of forcing gpt-5.4", async () => {
    const lifecycle = createAuthTestLifecycle([
      "ALISIO_STATE_DIR",
      "ALISIO_AGENT_DIR",
      "PI_CODING_AGENT_DIR",
      "ALISIO_CONFIG_PATH",
    ]);
    const env = await setupAuthTestEnv("alisio-runtime-preserve-");
    lifecycle.setStateDir(env.stateDir);
    try {
      const configPath = resolveConfigPath(process.env);
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            agents: {
              defaults: {
                model: {
                  primary: "openai-codex/gpt-5.3-codex",
                },
              },
            },
          },
          null,
          2,
        ),
      );

      await applyAlisioOpenAiRuntime(
        {
          authProfileId: "openai-codex:alisio-primary",
          accessToken: "access-primary",
          refreshToken: "refresh-primary",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          email: "primary@example.com",
        },
        { displayName: "Primary" },
      );

      const config = JSON.parse(await fs.readFile(configPath, "utf8")) as {
        agents?: {
          defaults?: {
            model?: string | { primary?: string };
            models?: Record<string, unknown>;
          };
        };
      };
      expect(config.agents?.defaults?.model).toEqual({ primary: "openai-codex/gpt-5.3-codex" });
      expect(config.agents?.defaults?.models?.["openai-codex/gpt-5.3-codex"]).toEqual({});
      expect(config.agents?.defaults?.models?.["openai-codex/gpt-5.4"]).toBeUndefined();
    } finally {
      await lifecycle.cleanup();
    }
  });
});
