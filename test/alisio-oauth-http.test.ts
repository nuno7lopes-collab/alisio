import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { handleAlisioOAuthHttpRequest } from "../src/gateway/alisio-oauth-http.js";
import { makeMockHttpResponse } from "../src/gateway/test-http-response.js";
import { beginAlisioConnectorSetup } from "../src/infra/alisio-store.js";
import { withTempDir } from "../src/test-helpers/temp-dir.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

function makeRequest(url: string, method = "GET") {
  return {
    url,
    method,
  } as IncomingMessage;
}

async function createReadyAlisioAccountEnv(
  root: string,
  extra: Record<string, string> = {},
): Promise<NodeJS.ProcessEnv> {
  const env = {
    ALISIO_STATE_DIR: root,
    ALISIO_SUPABASE_URL: "https://example.supabase.co",
    ALISIO_SUPABASE_ANON_KEY: "anon-key",
    ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
    ...extra,
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

describe("handleAlisioOAuthHttpRequest", () => {
  it("completes a Google OAuth callback and renders a success page", async () => {
    await withTempDir({ prefix: "alisio-oauth-http-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
      });
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const stateToken = new URL(begin?.setupUrl ?? "").searchParams.get("state");
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
      const { res, setHeader, end } = makeMockHttpResponse();

      const handled = await handleAlisioOAuthHttpRequest(
        makeRequest(`/oauth/google/callback?state=${stateToken}&code=google-code`),
        res,
        env,
        fetchMock,
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(setHeader).toHaveBeenCalledWith("Content-Type", "text/html; charset=utf-8");
      expect(String(end.mock.calls.at(-1)?.[0] ?? "")).toContain("Alisio connection completed");
      expect(String(end.mock.calls.at(-1)?.[0] ?? "")).toContain("google-calendar");
      expect(String(end.mock.calls.at(-1)?.[0] ?? "")).toContain("nuno@example.com");
    });
  });

  it("renders an error page when the callback is missing state", async () => {
    const { res, setHeader, end } = makeMockHttpResponse();

    const handled = await handleAlisioOAuthHttpRequest(
      makeRequest("/oauth/google/callback?code=missing-state"),
      res,
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(setHeader).toHaveBeenCalledWith("Content-Type", "text/html; charset=utf-8");
    expect(String(end.mock.calls.at(-1)?.[0] ?? "")).toContain("Alisio connection failed");
    expect(String(end.mock.calls.at(-1)?.[0] ?? "")).toContain("Missing OAuth state token");
  });

  it("escapes provider error text before rendering callback HTML", async () => {
    await withTempDir({ prefix: "alisio-oauth-http-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root, {
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
      });
      const begin = await beginAlisioConnectorSetup("google-calendar", env);
      const stateToken = new URL(begin?.setupUrl ?? "").searchParams.get("state");
      const { res, end } = makeMockHttpResponse();

      const handled = await handleAlisioOAuthHttpRequest(
        makeRequest(
          `/oauth/google/callback?state=${stateToken}&error=access_denied&error_description=%3Cscript%3Ealert(1)%3C%2Fscript%3E`,
        ),
        res,
        env,
      );

      expect(handled).toBe(true);
      const body = String(end.mock.calls.at(-1)?.[0] ?? "");
      expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(body).not.toContain("<script>alert(1)</script>");
    });
  });
});
