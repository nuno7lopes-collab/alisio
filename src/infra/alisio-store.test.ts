import { describe, expect, it, vi } from "vitest";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorization,
  completeAlisioConnectorAuthorizationFromCallback,
  getAlisioBootstrapSummary,
  getAlisioDoctorSummary,
  loadAlisioBootstrapSnapshot,
  listAlisioConnectorAuthorizations,
  summarizeAlisioConnectorAuthorizations,
  updateAlisioAccountProfile,
} from "./alisio-store.js";

describe("beginAlisioConnectorSetup", () => {
  it("returns an honest setup fallback when OAuth client config is missing", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const result = await beginAlisioConnectorSetup("google-docs", {
        OPENCLAW_STATE_DIR: root,
      } as NodeJS.ProcessEnv);

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
        ],
      });
      expect(result?.setupUrl).toContain("developers.google.com");
    });
  });

  it("builds a real Google OAuth authorization URL when client config exists", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const result = await beginAlisioConnectorSetup("google-calendar", {
        OPENCLAW_STATE_DIR: root,
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
      } as NodeJS.ProcessEnv);

      expect(result).toMatchObject({
        connectorId: "google-calendar",
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
      expect(launchUrl.searchParams.get("code_challenge_method")).toBe("S256");
      expect(launchUrl.searchParams.get("scope")).toContain(
        "https://www.googleapis.com/auth/calendar",
      );
      expect(launchUrl.searchParams.get("state")).toBeTruthy();
    });
  });

  it("completes a Google OAuth callback and persists the authorization", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const begin = await beginAlisioConnectorSetup("google-calendar", {
        OPENCLAW_STATE_DIR: root,
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
      } as NodeJS.ProcessEnv);
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
              scope: "openid email",
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
        {
          OPENCLAW_STATE_DIR: root,
          ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
          ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
          ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        } as NodeJS.ProcessEnv,
        fetchMock,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authorization.connectedAccount?.email).toBe("nuno@example.com");
      }
      const authorizations = await listAlisioConnectorAuthorizations({
        OPENCLAW_STATE_DIR: root,
      } as NodeJS.ProcessEnv);
      expect(authorizations.find((entry) => entry.connectorId === "google-calendar")?.state).toBe(
        "connected",
      );
      expect(
        authorizations.find((entry) => entry.connectorId === "google-calendar")?.scopes,
      ).toEqual(["openid", "email"]);
    });
  });

  it("fails cleanly when the token exchange request throws", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const begin = await beginAlisioConnectorSetup("google-calendar", {
        OPENCLAW_STATE_DIR: root,
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
      } as NodeJS.ProcessEnv);
      const launchUrl = new URL(begin?.setupUrl ?? "");

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        {
          OPENCLAW_STATE_DIR: root,
          ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
          ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
          ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
        } as NodeJS.ProcessEnv,
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
      const begin = await beginAlisioConnectorSetup("github", {
        OPENCLAW_STATE_DIR: root,
        ALISIO_GITHUB_CLIENT_ID: "github-client-id",
        ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
        ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
      } as NodeJS.ProcessEnv);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "github-access",
              token_type: "bearer",
              scope: "repo user:email",
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
        {
          OPENCLAW_STATE_DIR: root,
          ALISIO_GITHUB_CLIENT_ID: "github-client-id",
          ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
          ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
        } as NodeJS.ProcessEnv,
        fetchMock,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.authorization.connectedAccount?.handle).toBe("nunolopes");
        expect(result.authorization.connectedAccount?.email).toBe("nuno@github.example");
      }
    });
  });

  it("rejects expired pending OAuth requests", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-04-01T10:00:00.000Z"));
      try {
        const begin = await beginAlisioConnectorSetup("github", {
          OPENCLAW_STATE_DIR: root,
          ALISIO_GITHUB_CLIENT_ID: "github-client-id",
          ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
          ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
        } as NodeJS.ProcessEnv);
        const launchUrl = new URL(begin?.setupUrl ?? "");

        vi.setSystemTime(new Date("2026-04-01T10:20:00.000Z"));

        const result = await completeAlisioConnectorAuthorizationFromCallback(
          {
            provider: "github",
            stateToken: launchUrl.searchParams.get("state"),
            code: "github-code",
          },
          {
            OPENCLAW_STATE_DIR: root,
            ALISIO_GITHUB_CLIENT_ID: "github-client-id",
            ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
            ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
          } as NodeJS.ProcessEnv,
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
      const begin = await beginAlisioConnectorSetup("github", {
        OPENCLAW_STATE_DIR: root,
        ALISIO_GITHUB_CLIENT_ID: "github-client-id",
        ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
        ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
      } as NodeJS.ProcessEnv);
      const launchUrl = new URL(begin?.setupUrl ?? "");

      const result = await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "github",
          stateToken: launchUrl.searchParams.get("state"),
          code: "github-code",
        },
        {
          OPENCLAW_STATE_DIR: root,
          ALISIO_GITHUB_CLIENT_ID: "github-client-id",
          ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
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

  it("keeps in-review connectors honest instead of pretending OAuth is ready", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const [facebook, notion, vercel] = await Promise.all([
        beginAlisioConnectorSetup("facebook", {
          OPENCLAW_STATE_DIR: root,
        } as NodeJS.ProcessEnv),
        beginAlisioConnectorSetup("notion", {
          OPENCLAW_STATE_DIR: root,
        } as NodeJS.ProcessEnv),
        beginAlisioConnectorSetup("vercel", {
          OPENCLAW_STATE_DIR: root,
        } as NodeJS.ProcessEnv),
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
      const result = await completeAlisioConnectorAuthorization(
        {
          connectorId: "notion",
        },
        {
          OPENCLAW_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
      );

      expect(result).toBeNull();
    });
  });

  it("does not allow manual completion for Google and GitHub connectors", async () => {
    await withTempDir({ prefix: "alisio-store-" }, async (root) => {
      const google = await completeAlisioConnectorAuthorization(
        {
          connectorId: "google-calendar",
        },
        {
          OPENCLAW_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
      );
      const github = await completeAlisioConnectorAuthorization(
        {
          connectorId: "github",
        },
        {
          OPENCLAW_STATE_DIR: root,
        } as NodeJS.ProcessEnv,
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
      expect(summary.connectorSummary.ready).toBeGreaterThan(0);
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
        state: "connected",
        health: "needs_reconnect",
        scopes: ["openid"],
      },
    ]);

    expect(summary).toMatchObject({
      connected: 1,
      needsReconnect: 1,
      inReview: expect.any(Number),
      unavailable: expect.any(Number),
    });
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.ready).toBeGreaterThan(0);
    expect(summary.available).toBe(summary.total - summary.unavailable);
  });
});
