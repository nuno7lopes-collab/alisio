import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  __testing,
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorization,
  completeAlisioConnectorAuthorizationFromCallback,
  disconnectAlisioAi,
  getAlisioAccountState,
  getAlisioAiState,
  getAlisioConnectorAccessToken,
  getAlisioBootstrapSummary,
  getAlisioDoctorSummary,
  getAlisioOrganizationState,
  loadAlisioBootstrapSnapshot,
  listAlisioConnectorAuthorizations,
  renameAlisioAiProfile,
  revokeAlisioConnectorAuthorization,
  setAlisioOrganizationState,
  signInAlisioAccount,
  signUpAlisioAccount,
  signOutAlisioAccount,
  summarizeAlisioConnectorAuthorizations,
  type AlisioStoredState,
  updateAlisioAccountProfile,
} from "./alisio-store.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

function parseJsonBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") {
    throw new Error("Expected request body to be a JSON string.");
  }
  return JSON.parse(body) as Record<string, unknown>;
}

function alisioStateFile(root: string) {
  return path.join(root, "alisio", "state.json");
}

function createJwt(payload: Record<string, unknown>) {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

async function createReadyAlisioAccountEnv(
  root: string,
  extra: Record<string, string> = {},
): Promise<NodeJS.ProcessEnv> {
  const env = {
    OPENCLAW_STATE_DIR: root,
    ALISIO_SUPABASE_URL: "https://example.supabase.co",
    ALISIO_SUPABASE_ANON_KEY: "anon-key",
    ...extra,
  } as NodeJS.ProcessEnv;
  const statePath = alisioStateFile(root);
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
            plan: "Free Plan",
            backend: "supabase",
          },
          preferences: {
            language: "pt-PT",
            theme: "dark",
          },
          session: {
            state: "signed_in",
            profileCompleted: true,
            signedInAt: "2026-04-04T15:00:00.000Z",
            backend: "supabase",
          },
          cloudSession: {
            backend: "supabase",
            state: "signed_out",
            userId: "user-1",
            email: "nuno@example.com",
            signedInAt: "2026-04-04T15:00:00.000Z",
            signedOutAt: "2026-04-04T15:05:00.000Z",
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

describe("beginAlisioConnectorSetup", () => {
  it("treats the connector token keychain as unavailable when macOS has no default user keychain", () => {
    const env = {
      HOME: "/Users/nuno",
    } as NodeJS.ProcessEnv;
    const execFileSyncMock = vi.fn(() => {
      throw new Error("A default keychain could not be found");
    });

    expect(
      __testing.hasUsableConnectorTokenKeychain(env, execFileSyncMock as never, "darwin"),
    ).toBe(false);
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "security",
      ["default-keychain", "-d", "user"],
      expect.objectContaining({
        encoding: "utf8",
      }),
    );
  });

  it("accepts the connector token keychain when macOS reports a default user keychain", () => {
    const env = {
      HOME: "/Users/nuno",
    } as NodeJS.ProcessEnv;
    const execFileSyncMock = vi.fn(() => '"/Users/nuno/Library/Keychains/login.keychain-db"\n');

    expect(
      __testing.hasUsableConnectorTokenKeychain(env, execFileSyncMock as never, "darwin"),
    ).toBe(true);
  });

  it("returns an honest setup fallback when OAuth client config is missing", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const result = await beginAlisioConnectorSetup("google-docs", env);

      expect(result).toMatchObject({
        connectorId: "google-docs",
        availability: "ready",
        mode: "setup",
        provider: "google",
        providerLabel: "Google",
        statusReason: "missing_client_config",
        callbackPath: "/oauth/google/callback",
        requiredEnvVars: [
          "ALISIO_GOOGLE_CLIENT_ID",
          "ALISIO_GOOGLE_CLIENT_SECRET",
          "ALISIO_GOOGLE_REDIRECT_URI",
          "ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY",
        ],
      });
      expect(result?.setupUrl).toContain("developers.google.com");
    });
  });

  it("reports missing token encryption separately when OAuth client config exists but secure storage is unavailable", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
      });
      const result = await beginAlisioConnectorSetup("google-docs", env);

      expect(result).toMatchObject({
        connectorId: "google-docs",
        availability: "ready",
        mode: "setup",
        provider: "google",
        providerLabel: "Google",
        statusReason: "missing_token_encryption",
        callbackPath: "/oauth/google/callback",
        requiredEnvVars: [
          "ALISIO_GOOGLE_CLIENT_ID",
          "ALISIO_GOOGLE_CLIENT_SECRET",
          "ALISIO_GOOGLE_REDIRECT_URI",
          "ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY",
        ],
      });
    });
  });

  it("builds a real Google OAuth authorization URL when client config exists", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const result = await beginAlisioConnectorSetup("gmail-send", env);

      expect(result).toMatchObject({
        connectorId: "gmail-send",
        availability: "ready",
        mode: "oauth",
        provider: "google",
        providerLabel: "Google",
        redirectUri: "http://127.0.0.1:8787/oauth/google/callback",
        statusReason: "ready_for_oauth",
        callbackPath: "/oauth/google/callback",
      });
      const launchUrl = new URL(result?.setupUrl ?? "");
      expect(`${launchUrl.origin}${launchUrl.pathname}`).toBe(
        "https://accounts.google.com/o/oauth2/v2/auth",
      );
      expect(launchUrl.searchParams.get("client_id")).toBe("google-client-id");
      expect(launchUrl.searchParams.get("redirect_uri")).toBe(
        "http://127.0.0.1:8787/oauth/google/callback",
      );
      expect(launchUrl.searchParams.get("response_type")).toBe("code");
      expect(launchUrl.searchParams.get("access_type")).toBe("offline");
      expect(launchUrl.searchParams.get("include_granted_scopes")).toBe("true");
      expect(launchUrl.searchParams.get("prompt")).toBe("select_account consent");
      expect(launchUrl.searchParams.get("code_challenge_method")).toBe("S256");
      expect(launchUrl.searchParams.get("scope")).toContain(
        "https://www.googleapis.com/auth/gmail.send",
      );
      expect(launchUrl.searchParams.get("scope")).toContain("openid");
      expect(launchUrl.searchParams.get("scope")).toContain("email");
      expect(launchUrl.searchParams.get("state")).toBeTruthy();
    });
  });

  it("builds a hardened GitHub OAuth authorization URL when client config exists", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GITHUB_CLIENT_ID: "github-client-id",
        ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
        ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const result = await beginAlisioConnectorSetup("github", env);

      expect(result).toMatchObject({
        connectorId: "github",
        availability: "ready",
        mode: "oauth",
        provider: "github",
        providerLabel: "GitHub",
        redirectUri: "http://127.0.0.1:8787/oauth/github/callback",
        statusReason: "ready_for_oauth",
        callbackPath: "/oauth/github/callback",
      });
      const launchUrl = new URL(result?.setupUrl ?? "");
      expect(`${launchUrl.origin}${launchUrl.pathname}`).toBe(
        "https://github.com/login/oauth/authorize",
      );
      expect(launchUrl.searchParams.get("client_id")).toBe("github-client-id");
      expect(launchUrl.searchParams.get("redirect_uri")).toBe(
        "http://127.0.0.1:8787/oauth/github/callback",
      );
      expect(launchUrl.searchParams.get("prompt")).toBe("select_account");
      expect(launchUrl.searchParams.get("code_challenge_method")).toBe("S256");
      expect(launchUrl.searchParams.get("scope")).toContain("repo");
      expect(launchUrl.searchParams.get("state")).toBeTruthy();
    });
  });

  it("completes a Gmail Send callback with the exact Gmail send scope", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("gmail-send", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "gmail-send-access",
              refresh_token: "gmail-send-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "https://www.googleapis.com/auth/gmail.send openid email",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authorization.connectorId).toBe("gmail-send");
        expect(result.authorization.scopes).toEqual([
          "https://www.googleapis.com/auth/gmail.send",
          "openid",
          "email",
        ]);
        expect(result.authorization.connectedAccount?.email).toBe("nuno@example.com");
      }
      const persistedState = await fs.readFile(alisioStateFile(root), "utf8");
      expect(persistedState).not.toContain("gmail-send-access");
      expect(persistedState).not.toContain("gmail-send-refresh");
    });
  });

  it("accepts Google's canonical userinfo email scope alias during callback validation", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("gmail-send", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "gmail-send-access",
              refresh_token: "gmail-send-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope:
                "https://www.googleapis.com/auth/gmail.send openid https://www.googleapis.com/auth/userinfo.email",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authorization.scopes).toEqual([
          "https://www.googleapis.com/auth/gmail.send",
          "openid",
          "email",
        ]);
      }
    });
  });

  it("falls back to the Google ID token when userinfo is unavailable", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("gmail-send", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const idToken = createJwt({
        sub: "google-user-1",
        email: "nuno@example.com",
        name: "Nuno Lopes",
      });
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "gmail-send-access",
              refresh_token: "gmail-send-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              id_token: idToken,
              scope: "https://www.googleapis.com/auth/gmail.send",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
        );

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authorization.connectedAccount).toEqual({
          label: "Nuno Lopes",
          email: "nuno@example.com",
          handle: "google-user-1",
        });
        expect(result.authorization.scopes).toEqual(["https://www.googleapis.com/auth/gmail.send"]);
      }
    });
  });

  it("completes a Google OAuth callback and persists the authorization", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "google-access",
              refresh_token: "google-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid email https://www.googleapis.com/auth/calendar",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authorization.connectedAccount?.email).toBe("nuno@example.com");
      }
      const authorizations = await listAlisioConnectorAuthorizations(env);
      expect(authorizations.find((entry) => entry.connectorId === "google-calendar")?.state).toBe(
        "connected",
      );
      expect(
        authorizations.find((entry) => entry.connectorId === "google-calendar")?.scopes,
      ).toEqual(["openid", "email", "https://www.googleapis.com/auth/calendar"]);
      const persistedState = await fs.readFile(alisioStateFile(root), "utf8");
      expect(persistedState).not.toContain("google-access");
      expect(persistedState).not.toContain("google-refresh");
    });
  });

  it("fails cleanly when the token exchange request throws", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        vi.fn<typeof fetch>().mockRejectedValue(new Error("network down")),
      );

      expect(result).toMatchObject({
        ok: false,
        reason: "token_exchange_failed",
      });
    });
  });

  it("completes a GitHub OAuth callback and uses the primary email fallback", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GITHUB_CLIENT_ID: "github-client-id",
        ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
        ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("github", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "github-access",
              token_type: "bearer",
              scope: "repo read:user user:email read:org gist",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              login: "nunolopes",
              name: "Nuno Lopes",
              email: null,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([{ email: "nuno@github.example", primary: true, verified: true }]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "github",
          stateToken: launchUrl.searchParams.get("state"),
          code: "github-code",
        },
        env,
        fetchMock,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authorization.connectedAccount?.handle).toBe("nunolopes");
        expect(result.authorization.connectedAccount?.email).toBe("nuno@github.example");
      }
    });
  });

  it("refreshes expired Google connector tokens before returning an access token", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const initialFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "google-access",
              refresh_token: "google-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid email https://www.googleapis.com/auth/calendar",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        initialFetch,
      );

      const statePath = alisioStateFile(root);
      const state = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        oauthCredentials: Record<string, { expiresAt?: string }>;
      };
      state.oauthCredentials["google-calendar"].expiresAt = new Date(
        Date.now() - 5 * 60 * 1000,
      ).toISOString();
      await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

      const refreshFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "google-access-refreshed",
            expires_in: 1800,
            token_type: "Bearer",
            scope: "openid email https://www.googleapis.com/auth/calendar",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const token = await getAlisioConnectorAccessToken("google-calendar", env, refreshFetch);

      expect(token).toBe("google-access-refreshed");
      const persistedState = await fs.readFile(statePath, "utf8");
      expect(persistedState).not.toContain("google-access-refreshed");
      expect(persistedState).not.toContain("google-refresh");
    });
  });

  it("marks expired GitHub connector auth as needing reconnect when no refresh token exists", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GITHUB_CLIENT_ID: "github-client-id",
        ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
        ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("github", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "github-access",
              token_type: "bearer",
              scope: "repo read:user user:email read:org gist",
              expires_in: 1,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              login: "nunolopes",
              name: "Nuno Lopes",
              email: "nuno@github.example",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "github",
          stateToken: launchUrl.searchParams.get("state"),
          code: "github-code",
        },
        env,
        fetchMock,
      );

      const statePath = alisioStateFile(root);
      const state = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        oauthCredentials: Record<string, { expiresAt?: string }>;
      };
      state.oauthCredentials.github.expiresAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

      const authorizations = await listAlisioConnectorAuthorizations(env);

      expect(authorizations.find((entry) => entry.connectorId === "github")).toMatchObject({
        state: "needs_reconnect",
        health: "needs_reconnect",
      });
    });
  });

  it("marks ready connectors as config missing when the gateway OAuth app is not configured", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const authorizations = await listAlisioConnectorAuthorizations({
        OPENCLAW_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

      expect(authorizations.find((entry) => entry.connectorId === "gmail-send")).toMatchObject({
        state: "not_connected",
        health: "config_missing",
      });
      expect(authorizations.find((entry) => entry.connectorId === "github")).toMatchObject({
        state: "not_connected",
        health: "config_missing",
      });
      expect(authorizations.find((entry) => entry.connectorId === "facebook")).toMatchObject({
        state: "not_connected",
        health: "in_review",
      });
    });
  });

  it("rejects expired pending OAuth requests", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-01T10:00:00.000Z"));
      try {
        const env = await createReadyAlisioAccountEnv(root, {
          ALISIO_GITHUB_CLIENT_ID: "github-client-id",
          ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
          ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
          ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
        });
        const begin = await beginAlisioConnectorSetup("github", env);
        const launchUrl = new URL(begin?.setupUrl ?? "");

        vi.setSystemTime(new Date("2026-04-01T10:20:00.000Z"));

        const result = await completeAlisioConnectorAuthorizationFromCallback(
          {
            provider: "github",
            stateToken: launchUrl.searchParams.get("state"),
            code: "github-code",
          },
          env,
          vi.fn<typeof fetch>(),
        );

        expect(result).toMatchObject({
          ok: false,
          reason: "pending_not_found",
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  it("rejects callbacks when the redirect URI changed after begin", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GITHUB_CLIENT_ID: "github-client-id",
        ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
        ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("github", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "github",
          stateToken: launchUrl.searchParams.get("state"),
          code: "github-code",
        },
        {
          ...env,
          ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:9999/oauth/github/callback",
        } as NodeJS.ProcessEnv,
        vi.fn<typeof fetch>(),
      );

      expect(result).toMatchObject({
        ok: false,
        reason: "missing_client_config",
      });
    });
  });

  it("rejects callbacks honestly when secure token storage disappears before completion", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GITHUB_CLIENT_ID: "github-client-id",
        ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
        ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("github", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      delete env.ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY;

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "github",
          stateToken: launchUrl.searchParams.get("state"),
          code: "github-code",
        },
        env,
        vi.fn<typeof fetch>(),
      );

      expect(result).toMatchObject({
        ok: false,
        reason: "missing_token_encryption",
      });
    });
  });

  it("revokes Google on disconnect before removing the local connector state", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const setupFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "google-access",
              refresh_token: "google-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid email https://www.googleapis.com/auth/calendar",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        setupFetch,
      );

      const revokeFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("", { status: 200 }));
      const result = await revokeAlisioConnectorAuthorization("google-calendar", env, revokeFetch);

      expect(result).toMatchObject({
        connectorId: "google-calendar",
        state: "not_connected",
      });
      expect(revokeFetch).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/revoke",
        expect.objectContaining({
          method: "POST",
        }),
      );
      const persistedState = await fs.readFile(alisioStateFile(root), "utf8");
      expect(persistedState).not.toContain("google-calendar");
    });
  });

  it("keeps in-review connectors honest instead of pretending OAuth is ready", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const [facebook, notion, vercel] = await Promise.all([
        beginAlisioConnectorSetup("facebook", env),
        beginAlisioConnectorSetup("notion", env),
        beginAlisioConnectorSetup("vercel", env),
      ]);

      expect(facebook).toMatchObject({
        connectorId: "facebook",
        availability: "in_review",
        mode: "setup",
        statusReason: "review_required",
      });
      expect(notion).toMatchObject({
        connectorId: "notion",
        availability: "in_review",
        mode: "setup",
        statusReason: "review_required",
        provider: "notion",
        providerLabel: "Notion",
        requiredEnvVars: [
          "ALISIO_NOTION_CLIENT_ID",
          "ALISIO_NOTION_CLIENT_SECRET",
          "ALISIO_NOTION_REDIRECT_URI",
        ],
      });
      expect(vercel).toMatchObject({
        connectorId: "vercel",
        availability: "in_review",
        mode: "setup",
        statusReason: "review_required",
        provider: "vercel",
        providerLabel: "Vercel",
        requiredEnvVars: [
          "ALISIO_VERCEL_CLIENT_ID",
          "ALISIO_VERCEL_CLIENT_SECRET",
          "ALISIO_VERCEL_REDIRECT_URI",
        ],
      });
    });
  });

  it("does not allow manual completion for connectors that are still in review", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const result = await completeAlisioConnectorAuthorization(
        {
          connectorId: "notion",
        },
        env,
      );

      expect(result).toBeNull();
    });
  });

  it("does not allow manual completion for Google and GitHub connectors", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const google = await completeAlisioConnectorAuthorization(
        {
          connectorId: "google-calendar",
        },
        env,
      );
      const github = await completeAlisioConnectorAuthorization(
        {
          connectorId: "github",
        },
        env,
      );

      expect(google).toBeNull();
      expect(github).toBeNull();
    });
  });

  it("builds a bootstrap snapshot with connector summary counts", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const snapshot = await loadAlisioBootstrapSnapshot({
        OPENCLAW_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

      expect(snapshot.account.profile.username).toBeTruthy();
      expect(snapshot.organization.mode).toBe("none");
      expect(snapshot.connectors.catalog.length).toBeGreaterThan(0);
      expect(snapshot.connectors.authorizations.length).toBe(snapshot.connectors.catalog.length);
      expect(snapshot.connectors.summary.total).toBe(snapshot.connectors.catalog.length);
      expect(snapshot.connectors.summary.connected).toBe(0);
      expect(snapshot.connectors.summary.inReview).toBeGreaterThan(0);
    });
  });

  it("hides preserved organization and connector state after logout, then restores it for the same account", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      await setAlisioOrganizationState(
        {
          mode: "owner",
          organizationName: "OpenClaw",
        },
        env,
      );
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "google-access",
              refresh_token: "google-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid email https://www.googleapis.com/auth/calendar",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      await signOutAlisioAccount(env);

      expect(await getAlisioOrganizationState(env)).toEqual({ mode: "none" });
      expect(
        (await listAlisioConnectorAuthorizations(env)).find(
          (entry) => entry.connectorId === "google-calendar",
        ),
      ).toMatchObject({
        state: "not_connected",
      });

      const signInFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "supabase-access",
              refresh_token: "supabase-refresh",
              expires_in: 3600,
              token_type: "bearer",
              user: {
                id: "user-1",
                email: "nuno@example.com",
                created_at: "2026-04-04T15:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                user_id: "user-1",
                email: "nuno@example.com",
                display_name: "Nuno Lopes",
                username: "nuno",
                avatar_label: "N",
                joined_at: "2026-04-04T15:00:00.000Z",
                plan: "Free Plan",
                profile_completed: true,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      vi.stubGlobal("fetch", signInFetch);
      try {
        await signInAlisioAccount(
          {
            email: "nuno@example.com",
            password: "password123",
          },
          env,
        );
      } finally {
        vi.unstubAllGlobals();
      }

      expect(await getAlisioOrganizationState(env)).toEqual({
        mode: "owner",
        organizationName: "OpenClaw",
      });
      expect(
        (await listAlisioConnectorAuthorizations(env)).find(
          (entry) => entry.connectorId === "google-calendar",
        ),
      ).toMatchObject({
        state: "connected",
      });
    });
  });

  it("clears preserved organization and connector state when a different account signs in", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      });
      await setAlisioOrganizationState(
        {
          mode: "owner",
          organizationName: "OpenClaw",
        },
        env,
      );
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "google-access",
              refresh_token: "google-refresh",
              expires_in: 3600,
              token_type: "Bearer",
              scope: "openid email https://www.googleapis.com/auth/calendar",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: "google-user-1",
              name: "Nuno Lopes",
              email: "nuno@example.com",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        fetchMock,
      );

      const otherAccountFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              user: {
                id: "user-2",
                email: "other@example.com",
                created_at: "2026-04-04T16:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "other-access",
              refresh_token: "other-refresh",
              expires_in: 3600,
              token_type: "bearer",
              user: {
                id: "user-2",
                email: "other@example.com",
                created_at: "2026-04-04T16:00:00.000Z",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                user_id: "user-2",
                email: "other@example.com",
                display_name: "Other",
                username: "other",
                avatar_label: "O",
                joined_at: "2026-04-04T16:00:00.000Z",
                plan: "Free Plan",
                profile_completed: false,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                user_id: "user-2",
                email: "other@example.com",
                display_name: "Other User",
                username: "other",
                avatar_label: "OU",
                joined_at: "2026-04-04T16:00:00.000Z",
                plan: "Free Plan",
                profile_completed: true,
              },
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      vi.stubGlobal("fetch", otherAccountFetch);
      try {
        await signUpAlisioAccount(
          {
            email: "other@example.com",
            password: "password123",
          },
          env,
        );
        await updateAlisioAccountProfile(
          {
            username: "other",
            displayName: "Other User",
            email: "other@example.com",
          },
          env,
        );
      } finally {
        vi.unstubAllGlobals();
      }

      expect(await getAlisioOrganizationState(env)).toEqual({ mode: "none" });
      expect(
        (await listAlisioConnectorAuthorizations(env)).find(
          (entry) => entry.connectorId === "google-calendar",
        ),
      ).toMatchObject({
        state: "not_connected",
      });
    });
  });

  it("normalizes usernames to lowercase when saving the local account", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const account = await updateAlisioAccountProfile(
        {
          username: "Nuno.Lopes",
          displayName: "Nuno Lopes",
          email: "nuno@example.com",
        },
        {
          OPENCLAW_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
      );

      expect(account.profile.username).toBe("nuno.lopes");
    });
  });

  it("rejects invalid usernames for the local account", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      await expect(
        updateAlisioAccountProfile(
          {
            username: "nuno!",
            displayName: "Nuno Lopes",
            email: "nuno@example.com",
          },
          {
            OPENCLAW_STATE_DIR: root,
          } as NodeJS.ProcessEnv,
        ),
      ).rejects.toThrow("Use only letters, numbers, dots, and underscores.");
    });
  });

  it("keeps the Supabase auth email authoritative when saving account profile changes", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
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
                plan: "Free Plan",
                backend: "supabase",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                signedInAt: "2026-04-04T15:00:00.000Z",
                backend: "supabase",
              },
              cloudSession: {
                backend: "supabase",
                state: "signed_in",
                userId: "user-1",
                email: "nuno@example.com",
                accessToken: "access-token",
                refreshToken: "refresh-token",
                signedInAt: "2026-04-04T15:00:00.000Z",
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

      const env = {
        OPENCLAW_STATE_DIR: root,
        ALISIO_SUPABASE_URL: "https://example.supabase.co",
        ALISIO_SUPABASE_ANON_KEY: "anon-key",
      } as NodeJS.ProcessEnv;
      const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
        const payload = parseJsonBody(init?.body);
        expect(payload.email).toBe("nuno@example.com");
        return new Response(JSON.stringify([payload]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      vi.stubGlobal("fetch", fetchMock);
      try {
        const account = await updateAlisioAccountProfile(
          {
            displayName: "Nuno Cloud",
            email: "other@example.com",
          },
          env,
        );

        expect(account.profile.displayName).toBe("Nuno Cloud");
        expect(account.profile.email).toBe("nuno@example.com");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it("normalizes legacy stored plan labels to canonical Alisio plans", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
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
                plan: "Free Plan",
                backend: "supabase",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
              },
              session: {
                state: "signed_out",
                profileCompleted: false,
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

      const account = await getAlisioAccountState({
        OPENCLAW_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

      expect(account.profile.plan).toBe("free");
    });
  });

  it("cleans stored Supabase tokens after a failed session refresh", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
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
                plan: "Free Plan",
                backend: "supabase",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                signedInAt: "2026-04-04T15:00:00.000Z",
                backend: "supabase",
              },
              cloudSession: {
                backend: "supabase",
                state: "signed_in",
                userId: "user-1",
                email: "nuno@example.com",
                accessToken: "access-token",
                refreshToken: "refresh-token",
                expiresAt: "2026-04-04T15:00:01.000Z",
                tokenType: "bearer",
                signedInAt: "2026-04-04T15:00:00.000Z",
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

      const env = {
        OPENCLAW_STATE_DIR: root,
        ALISIO_SUPABASE_URL: "https://example.supabase.co",
        ALISIO_SUPABASE_ANON_KEY: "anon-key",
      } as NodeJS.ProcessEnv;

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "refresh failed" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      );

      vi.stubGlobal("fetch", fetchMock);
      try {
        const account = await getAlisioAccountState(env);

        expect(account.session.state).toBe("signed_out");
      } finally {
        vi.unstubAllGlobals();
      }

      const persistedState = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        account: {
          cloudSession: Record<string, unknown>;
        };
      };
      expect(persistedState.account.cloudSession).toMatchObject({
        backend: "supabase",
        state: "signed_out",
        userId: "user-1",
        email: "nuno@example.com",
        signedInAt: "2026-04-04T15:00:00.000Z",
        signedOutAt: expect.any(String),
      });
      expect(persistedState.account.cloudSession).not.toHaveProperty("accessToken");
      expect(persistedState.account.cloudSession).not.toHaveProperty("refreshToken");
      expect(persistedState.account.cloudSession).not.toHaveProperty("expiresAt");
      expect(persistedState.account.cloudSession).not.toHaveProperty("tokenType");
    });
  });

  it("encrypts persisted Supabase and OpenAI tokens when local token encryption is configured", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      const workerId = `local:${os.hostname().trim().toLowerCase() || "this device"}`;
      const openAiAccessToken = createJwt({
        sub: "google-oauth2|shared-user",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct_team_1",
          chatgpt_account_user_id: "account-user-team-1",
          chatgpt_user_id: "google-oauth2|shared-user",
          chatgpt_plan_type: "team",
        },
        "https://api.openai.com/profile": {
          email: "nuno7lopes@gmail.com",
        },
      });
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
                plan: "Free Plan",
                backend: "supabase",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                signedInAt: "2026-04-04T15:00:00.000Z",
                backend: "supabase",
              },
              cloudSession: {
                backend: "supabase",
                state: "signed_in",
                userId: "user-1",
                email: "nuno@example.com",
                accessToken: "supabase-access-token",
                refreshToken: "supabase-refresh-token",
                expiresAt: "2099-04-04T15:00:00.000Z",
                tokenType: "bearer",
                signedInAt: "2026-04-04T15:00:00.000Z",
              },
            },
            organization: {
              mode: "none",
            },
            ai: {
              aiProfiles: {
                "alisio-openai:user-1": {
                  provider: "openai",
                  scope: "user",
                  ownerKey: "user:user-1",
                  canonicalIdentityKey: "account_user_id:account-user-team-1",
                  identity: {
                    accountId: "acct_team_1",
                    accountUserId: "account-user-team-1",
                    userId: "google-oauth2|shared-user",
                    email: "nuno7lopes@gmail.com",
                    canonicalIdentityKey: "account_user_id:account-user-team-1",
                    source: "account_user_id",
                  },
                  createdAt: "2026-04-04T15:00:00.000Z",
                },
              },
              workerCredentials: {
                "worker-credential-1": {
                  provider: "openai",
                  aiProfileId: "alisio-openai:user-1",
                  workerId,
                  authProfileId: "openai-codex:alisio-main",
                  runtimeState: "connected",
                  accessToken: openAiAccessToken,
                  refreshToken: "openai-refresh-token",
                  expiresAt: "2099-04-04T15:00:00.000Z",
                  email: "nuno7lopes@gmail.com",
                  accountId: "acct_team_1",
                  accountUserId: "account-user-team-1",
                  userId: "google-oauth2|shared-user",
                  connectedAt: "2026-04-04T15:00:00.000Z",
                  createdAt: "2026-04-04T15:00:00.000Z",
                  localTelemetry: {
                    source: "official",
                    observedAt: "2099-04-04T15:00:00.000Z",
                    staleAt: "2099-04-04T15:10:00.000Z",
                    planType: "team",
                    primaryWindow: {
                      label: "5h",
                      durationMinutes: 300,
                      usedPercent: 10,
                      remainingPercent: 90,
                    },
                  },
                },
              },
              runtimeBindings: {
                [workerId]: {
                  workerId,
                  workerCredentialId: "worker-credential-1",
                  authProfileId: "openai-codex:alisio-main",
                  boundAt: "2026-04-04T15:00:00.000Z",
                },
              },
            },
            authorizations: {},
            oauthCredentials: {},
            pendingAuthorizations: {},
          },
          null,
          2,
        ),
      );

      const env = {
        OPENCLAW_STATE_DIR: root,
        ALISIO_SUPABASE_URL: "https://example.supabase.co",
        ALISIO_SUPABASE_ANON_KEY: "anon-key",
        ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
      } as NodeJS.ProcessEnv;

      const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
        const payload = parseJsonBody(init?.body);
        return new Response(
          JSON.stringify([
            {
              user_id: "user-1",
              email: payload.email,
              display_name: payload.display_name,
              username: payload.username,
              avatar_label: payload.avatar_label,
              avatar_url: payload.avatar_url,
              joined_at: payload.joined_at,
              plan: payload.plan,
              profile_completed: payload.profile_completed,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

      vi.stubGlobal("fetch", fetchMock);
      try {
        await updateAlisioAccountProfile(
          {
            displayName: "Nuno Lopes",
          },
          env,
        );
      } finally {
        vi.unstubAllGlobals();
      }

      const persistedRaw = await fs.readFile(statePath, "utf8");
      expect(persistedRaw).not.toContain("supabase-access-token");
      expect(persistedRaw).not.toContain("supabase-refresh-token");
      expect(persistedRaw).not.toContain("openai-refresh-token");

      const persistedState = JSON.parse(persistedRaw) as AlisioStoredState;
      expect(persistedState.account.cloudSession).toMatchObject({
        backend: "supabase",
        state: "signed_in",
        userId: "user-1",
        email: "nuno@example.com",
      });
      expect(persistedState.account.cloudSession).toHaveProperty("accessTokenEncrypted");
      expect(persistedState.account.cloudSession).toHaveProperty("refreshTokenEncrypted");
      expect(persistedState.account.cloudSession).not.toHaveProperty("accessToken");
      expect(persistedState.account.cloudSession).not.toHaveProperty("refreshToken");

      const persistedAiCredential = Object.values(persistedState.ai?.workerCredentials ?? {})[0] as
        | {
            authProfileId?: string;
            accountUserId?: string;
          }
        | undefined;
      expect(persistedAiCredential).toMatchObject({
        authProfileId: "openai-codex:alisio-main",
        accountUserId: "account-user-team-1",
      });
      expect(persistedAiCredential).toHaveProperty("accessTokenEncrypted");
      expect(persistedAiCredential).toHaveProperty("refreshTokenEncrypted");
      expect(persistedAiCredential).not.toHaveProperty("accessToken");
      expect(persistedAiCredential).not.toHaveProperty("refreshToken");
    });
  });

  it("migrates legacy local-dev account state to signed-out Supabase mode", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                userId: "legacy-user",
                username: "nuno7lopes",
                displayName: "Nuno7lopes",
                email: "nuno7lopes@gmail.com",
                avatarLabel: "N",
                joinedAt: "2026-04-02T17:32:33.688Z",
                plan: "Free Plan",
                backend: "local-dev",
              },
              preferences: {
                language: "pt-PT",
                theme: "system",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                backend: "local-dev",
                signedInAt: "2026-04-02T17:32:33.688Z",
              },
              cloudSession: {
                backend: "local-dev",
                state: "signed_in",
                userId: "legacy-user",
                email: "nuno7lopes@gmail.com",
                signedInAt: "2026-04-02T17:32:33.688Z",
              },
              passwordCredential: {
                email: "nuno7lopes@gmail.com",
                salt: "salt",
                hash: "hash",
              },
            },
            organization: {
              mode: "owner",
              organizationName: "Legacy Org",
            },
            ai: {
              pending: {
                callbackUrl: "https://example.com/callback",
                codeVerifier: "code",
                stateToken: "state",
                createdAt: "2026-04-04T15:00:00.000Z",
              },
            },
            authorizations: {
              github: {
                connectorId: "github",
                state: "connected",
                health: "healthy",
                scopes: ["repo"],
              },
            },
            oauthCredentials: {
              github: {
                provider: "github",
                accessToken: "token",
                createdAt: "2026-04-04T15:00:00.000Z",
              },
            },
            pendingAuthorizations: {
              state: {
                connectorId: "github",
                provider: "github",
                redirectUri: "https://example.com",
                requestedScopes: ["repo"],
                createdAt: "2026-04-04T15:00:00.000Z",
              },
            },
          },
          null,
          2,
        ),
      );

      const account = await getAlisioAccountState({
        OPENCLAW_STATE_DIR: root,
        ALISIO_SUPABASE_URL: "https://example.supabase.co",
        ALISIO_SUPABASE_ANON_KEY: "anon-key",
      } as NodeJS.ProcessEnv);

      expect(account.session).toMatchObject({
        state: "signed_out",
        profileCompleted: false,
        backend: "supabase",
      });
      expect(account.profile.email).toBe("nuno7lopes@gmail.com");
      expect(account.profile.backend).toBe("supabase");

      const persistedState = JSON.parse(await fs.readFile(statePath, "utf8")) as AlisioStoredState;
      expect(persistedState.account.session).toMatchObject({
        state: "signed_out",
        profileCompleted: false,
        backend: "supabase",
      });
      expect(persistedState.account.cloudSession).toMatchObject({
        state: "signed_out",
        backend: "supabase",
        email: "nuno7lopes@gmail.com",
      });
      expect(persistedState.account.profile).not.toHaveProperty("userId");
      expect(persistedState.account).not.toHaveProperty("passwordCredential");
      expect(persistedState.organization).toEqual({ mode: "none" });
      expect(persistedState.authorizations).toEqual({});
      expect(persistedState.oauthCredentials).toEqual({});
      expect(persistedState.pendingAuthorizations).toEqual({});
    });
  });

  it("warns when local token encryption is missing for persisted account or AI sessions", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
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
                plan: "Free Plan",
                backend: "supabase",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
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
            ai: {
              aiProfiles: {
                "alisio-openai:user-1": {
                  provider: "openai",
                  scope: "user",
                  ownerKey: "user:user-1",
                  canonicalIdentityKey: "account_user_id:account-user-team-1",
                  identity: {
                    accountId: "acct_team_1",
                    accountUserId: "account-user-team-1",
                    userId: "google-oauth2|shared-user",
                    email: "nuno7lopes@gmail.com",
                    canonicalIdentityKey: "account_user_id:account-user-team-1",
                    source: "account_user_id",
                  },
                  createdAt: "2026-04-04T15:00:00.000Z",
                },
              },
              workerCredentials: {
                "worker-credential-1": {
                  provider: "openai",
                  aiProfileId: "alisio-openai:user-1",
                  workerId: `local:${os.hostname().trim().toLowerCase() || "this device"}`,
                  authProfileId: "openai-codex:alisio-main",
                  runtimeState: "connected",
                  accessToken: createJwt({
                    sub: "google-oauth2|shared-user",
                    "https://api.openai.com/auth": {
                      chatgpt_account_id: "acct_team_1",
                      chatgpt_account_user_id: "account-user-team-1",
                      chatgpt_user_id: "google-oauth2|shared-user",
                      chatgpt_plan_type: "team",
                    },
                    "https://api.openai.com/profile": {
                      email: "nuno7lopes@gmail.com",
                    },
                  }),
                  refreshToken: "openai-refresh-token",
                  expiresAt: "2099-04-04T15:00:00.000Z",
                  connectedAt: "2026-04-04T15:00:00.000Z",
                  createdAt: "2026-04-04T15:00:00.000Z",
                  localTelemetry: {
                    source: "official",
                    observedAt: "2099-04-04T15:00:00.000Z",
                    staleAt: "2099-04-04T15:10:00.000Z",
                    planType: "team",
                    primaryWindow: {
                      label: "5h",
                      durationMinutes: 300,
                      usedPercent: 10,
                      remainingPercent: 90,
                    },
                  },
                },
              },
            },
            authorizations: {},
            oauthCredentials: {},
            pendingAuthorizations: {},
          },
          null,
          2,
        ),
      );

      const summary = await getAlisioDoctorSummary({
        env: {
          OPENCLAW_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
        providerReady: false,
        gatewayHealthy: true,
      });

      expect(summary.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "local_token_encryption_not_configured",
            severity: "warning",
          }),
        ]),
      );
    });
  });

  it("builds an Alisio bootstrap summary from account, organization, and connector state", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const summary = await getAlisioBootstrapSummary({
        env: {
          OPENCLAW_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
        providerReady: false,
        wizardRunning: true,
      });

      expect(summary).toMatchObject({
        connectionRequired: false,
        wizardRequired: false,
        wizardRunning: true,
        providerReady: false,
        accountReady: false,
        startupState: "signed_out",
        nextStep: "account",
      });
      expect(summary.organizationState.mode).toBe("none");
      expect(summary.connectorSummary.total).toBeGreaterThan(0);
      expect(summary.connectorSummary.ready).toBe(0);
      expect(summary.connectorSummary.connected).toBe(0);
    });
  });

  it("builds an Alisio doctor summary with actionable setup issues", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const summary = await getAlisioDoctorSummary({
        env: {
          OPENCLAW_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
        providerReady: false,
        wizardRunning: false,
      });

      expect(summary.ok).toBe(false);
      expect(summary.bootstrap.nextStep).toBe("account");
      expect(summary.issues.map((issue) => issue.code)).toContain("account_not_ready");
      expect(summary.issues.map((issue) => issue.code)).toContain("runtime_not_ready");
      expect(summary.checks.runtime).toBe(false);
      expect(summary.checks.account).toBe(false);
    });
  });

  it("summarizes reconnecting authorizations once", () => {
    const summary = summarizeAlisioConnectorAuthorizations([
      {
        connectorId: "google-calendar",
        state: "needs_reconnect",
        health: "needs_reconnect",
        scopes: ["openid"],
      },
    ]);

    expect(summary).toMatchObject({
      connected: 0,
      needsReconnect: 1,
      inReview: expect.any(Number),
      unavailable: expect.any(Number),
    });
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.ready).toBeGreaterThan(0);
    expect(summary.available).toBe(summary.total - summary.unavailable);
  });

  it("does not route ready accounts into an empty connectors step when OAuth config is missing", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await setAlisioOrganizationState(
        {
          mode: "owner",
          organizationName: "OpenClaw",
        },
        env,
      );

      const summary = await getAlisioBootstrapSummary({
        env,
        providerReady: true,
      });

      expect(summary.startupState).toBe("ready");
      expect(summary.connectorSummary.connected).toBe(0);
      expect(summary.connectorSummary.ready).toBe(0);
      expect(summary.nextStep).toBe(process.platform === "darwin" ? "permissions" : "ready");
    });
  });
});

describe("Alisio OpenAI profiles", () => {
  it("rehydrates stored worker credentials with real token identity and hides technical labels", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      const workerId = `local:${os.hostname().trim().toLowerCase() || "this device"}`;
      const accessToken = createJwt({
        sub: "google-oauth2|shared-user",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct_team_1",
          chatgpt_account_user_id: "account-user-team-1",
          chatgpt_user_id: "google-oauth2|shared-user",
          chatgpt_plan_type: "team",
        },
        "https://api.openai.com/profile": {
          email: "nuno7lopes@gmail.com",
        },
      });
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-03T20:00:00.000Z",
                plan: "Free Plan",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
              },
            },
            ai: {
              aiProfiles: {
                "legacy-profile": {
                  provider: "openai",
                  scope: "user",
                  ownerKey: "user:nuno@example.com",
                  canonicalIdentityKey: "account_id:acct_team_1",
                  identity: {
                    accountId: "acct_team_1",
                    canonicalIdentityKey: "account_id:acct_team_1",
                    source: "account_id",
                  },
                  label: "9e05e4cd-454b-485c-847c-274bf93afa77",
                  createdAt: "2026-04-03T20:00:00.000Z",
                },
              },
              workerCredentials: {
                "legacy-credential": {
                  provider: "openai",
                  aiProfileId: "legacy-profile",
                  workerId,
                  authProfileId: "openai-codex:legacy",
                  runtimeState: "connected",
                  accessToken,
                  connectedAt: "2026-04-03T20:00:00.000Z",
                  createdAt: "2026-04-03T20:00:00.000Z",
                  localTelemetry: {
                    source: "official",
                    observedAt: "2026-04-04T15:00:00.000Z",
                    staleAt: "2099-04-04T15:10:00.000Z",
                    primaryWindow: {
                      label: "5h",
                      durationMinutes: 300,
                      usedPercent: 68,
                      remainingPercent: 32,
                    },
                  },
                },
              },
              runtimeBindings: {
                [workerId]: {
                  workerId,
                  workerCredentialId: "legacy-credential",
                  authProfileId: "openai-codex:legacy",
                  boundAt: "2026-04-03T20:00:00.000Z",
                },
              },
            },
          },
          null,
          2,
        ),
      );

      const aiState = await getAlisioAiState({
        OPENCLAW_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

      expect(aiState.activeProfileId).toBeTruthy();
      expect(aiState.email).toBe("nuno7lopes@gmail.com");
      expect(aiState.planLabel).toBe("team");
      expect(aiState.profiles).toHaveLength(1);
      expect(aiState.profiles?.[0]).toMatchObject({
        email: "nuno7lopes@gmail.com",
        accountUserId: "account-user-team-1",
        userId: "google-oauth2|shared-user",
        label: "nuno7lopes@gmail.com",
        planLabel: "team",
      });
      expect(aiState.profiles?.[0]?.canonicalIdentityKey).toBe(
        "account_user_id:account-user-team-1",
      );

      const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        ai?: {
          aiProfiles?: Record<string, { canonicalIdentityKey?: string }>;
          workerCredentials?: Record<
            string,
            { email?: string; accountUserId?: string; userId?: string }
          >;
        };
      };
      const persistedProfile = Object.values(persisted.ai?.aiProfiles ?? {})[0];
      const persistedCredential = Object.values(persisted.ai?.workerCredentials ?? {})[0];
      expect(persistedProfile?.canonicalIdentityKey).toBe("account_user_id:account-user-team-1");
      expect((persistedProfile as { label?: string } | undefined)?.label).toBe(
        "9e05e4cd-454b-485c-847c-274bf93afa77",
      );
      expect(persistedCredential).toMatchObject({
        email: "nuno7lopes@gmail.com",
        accountUserId: "account-user-team-1",
        userId: "google-oauth2|shared-user",
      });
    });
  });

  it("renames a stored OpenAI profile without touching the others", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-03T20:00:00.000Z",
                plan: "Free Plan",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
              },
            },
            ai: {
              activeProfileId: "alisio-openai:nuno",
              profiles: {
                "alisio-openai:nuno": {
                  status: "connected",
                  email: "nuno@example.com",
                  label: "Personal",
                  connectedAt: "2026-04-03T20:00:00.000Z",
                },
                "alisio-openai:work": {
                  status: "connected",
                  email: "nuno@work.example",
                  label: "Work",
                  connectedAt: "2026-04-03T20:05:00.000Z",
                },
              },
            },
          },
          null,
          2,
        ),
      );
      const initialState = await getAlisioAiState({
        OPENCLAW_STATE_DIR: root,
      } as NodeJS.ProcessEnv);
      const targetProfileId = initialState.profiles?.find(
        (profile) => profile.email === "nuno@example.com",
      )?.profileId;
      expect(targetProfileId).toBeTruthy();

      const result = await renameAlisioAiProfile(
        {
          profileId: targetProfileId ?? "",
          label: "Main OpenAI",
        },
        {
          OPENCLAW_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
      );

      expect(result.activeProfileId).toBe(initialState.activeProfileId);
      expect(result.profiles?.find((profile) => profile.email === "nuno@example.com")?.label).toBe(
        "Main OpenAI",
      );
      expect(result.profiles?.find((profile) => profile.email === "nuno@work.example")?.label).toBe(
        "Work",
      );
    });
  });

  it("keeps fallback emails out of the stored profile label when deriving AI state", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      const workerId = `local:${os.hostname().trim().toLowerCase() || "this device"}`;
      const accessToken = createJwt({
        sub: "google-oauth2|shared-user",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct_team_1",
          chatgpt_account_user_id: "account-user-team-1",
          chatgpt_user_id: "google-oauth2|shared-user",
          chatgpt_plan_type: "team",
        },
        "https://api.openai.com/profile": {
          email: "nuno7lopes@gmail.com",
        },
      });
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-03T20:00:00.000Z",
                plan: "Free Plan",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
              },
            },
            ai: {
              aiProfiles: {
                "alisio-openai:nuno": {
                  provider: "openai",
                  scope: "user",
                  ownerKey: "user:user-1",
                  canonicalIdentityKey: "account_user_id:account-user-team-1",
                  identity: {
                    accountId: "acct_team_1",
                    accountUserId: "account-user-team-1",
                    userId: "google-oauth2|shared-user",
                    email: "nuno7lopes@gmail.com",
                    canonicalIdentityKey: "account_user_id:account-user-team-1",
                    source: "account_user_id",
                  },
                  createdAt: "2026-04-03T20:00:00.000Z",
                },
              },
              workerCredentials: {
                "worker-credential-1": {
                  provider: "openai",
                  aiProfileId: "alisio-openai:nuno",
                  workerId,
                  authProfileId: "openai-codex:alisio-main",
                  runtimeState: "connected",
                  accessToken,
                  connectedAt: "2026-04-03T20:00:00.000Z",
                  createdAt: "2026-04-03T20:00:00.000Z",
                  localTelemetry: {
                    source: "official",
                    observedAt: "2099-04-04T15:00:00.000Z",
                    staleAt: "2099-04-04T15:10:00.000Z",
                    planType: "team",
                    primaryWindow: {
                      label: "5h",
                      durationMinutes: 300,
                      usedPercent: 10,
                      remainingPercent: 90,
                    },
                  },
                },
              },
              runtimeBindings: {
                [workerId]: {
                  workerId,
                  workerCredentialId: "worker-credential-1",
                  authProfileId: "openai-codex:alisio-main",
                  boundAt: "2026-04-03T20:00:00.000Z",
                },
              },
            },
          },
          null,
          2,
        ),
      );

      const result = await getAlisioAiState({
        OPENCLAW_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

      expect(result.profiles?.[0]?.label).toBe("nuno7lopes@gmail.com");

      const persisted = JSON.parse(await fs.readFile(statePath, "utf8")) as {
        ai?: {
          aiProfiles?: Record<string, { label?: string }>;
        };
      };
      expect(persisted.ai?.aiProfiles?.["alisio-openai:nuno"]?.label).toBeUndefined();
    });
  });

  it("rehydrates the best OpenAI profile when no runtime binding exists yet", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      const workerId = `local:${os.hostname().trim().toLowerCase() || "this device"}`;
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-03T20:00:00.000Z",
                plan: "Free Plan",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
              },
            },
            ai: {
              aiProfiles: {
                "alisio-openai:nuno": {
                  provider: "openai",
                  scope: "user",
                  ownerKey: "user:user-1",
                  canonicalIdentityKey: "email:nuno@example.com",
                  identity: {
                    email: "nuno@example.com",
                    canonicalIdentityKey: "email:nuno@example.com",
                    source: "email",
                  },
                  createdAt: "2026-04-03T20:00:00.000Z",
                },
              },
              workerCredentials: {
                "worker-credential-1": {
                  provider: "openai",
                  aiProfileId: "alisio-openai:nuno",
                  workerId,
                  authProfileId: "openai-codex:alisio-main",
                  runtimeState: "connected",
                  connectedAt: "2026-04-03T20:00:00.000Z",
                  createdAt: "2026-04-03T20:00:00.000Z",
                  email: "nuno@example.com",
                },
              },
            },
          },
          null,
          2,
        ),
      );

      const result = await getAlisioAiState({
        OPENCLAW_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

      expect(result.activeProfileId).toBeTruthy();
      expect(result.profiles).toHaveLength(1);
      expect(["connected", "limits_unavailable"]).toContain(result.profiles?.[0]?.status);
    });
  });

  it("falls back to the next stored profile when the active profile is removed", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const statePath = alisioStateFile(root);
      await fs.mkdir(path.dirname(statePath), { recursive: true });
      await fs.writeFile(
        statePath,
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
                avatarLabel: "N",
                joinedAt: "2026-04-03T20:00:00.000Z",
                plan: "Free Plan",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
              },
            },
            ai: {
              activeProfileId: "alisio-openai:nuno",
              profiles: {
                "alisio-openai:nuno": {
                  status: "connected",
                  email: "nuno@example.com",
                  label: "Personal",
                  connectedAt: "2026-04-03T20:00:00.000Z",
                },
                "alisio-openai:work": {
                  status: "connected",
                  email: "nuno@work.example",
                  label: "Work",
                  connectedAt: "2026-04-03T20:05:00.000Z",
                },
              },
            },
          },
          null,
          2,
        ),
      );
      const initialState = await getAlisioAiState({
        OPENCLAW_STATE_DIR: root,
      } as NodeJS.ProcessEnv);
      const targetProfileId = initialState.profiles?.find(
        (profile) => profile.email === "nuno@example.com",
      )?.profileId;
      expect(targetProfileId).toBeTruthy();

      const state = await disconnectAlisioAi(
        {
          profileId: targetProfileId ?? "",
        },
        {
          OPENCLAW_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
      );
      expect(state.activeProfileId).not.toBe(targetProfileId);
      expect(state.profiles?.map((profile) => profile.email)).toEqual(["nuno@work.example"]);
    });
  });
});
