import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { handleAlisioOAuthHttpRequest } from "../src/gateway/alisio-oauth-http.js";
import { makeMockHttpResponse } from "../src/gateway/test-http-response.js";
import { beginAlisioConnectorSetup } from "../src/infra/alisio-store.js";
import { withTempDir } from "../src/test-helpers/temp-dir.js";

function makeRequest(url: string, method = "GET") {
  return {
    url,
    method,
  } as IncomingMessage;
}

describe("handleAlisioOAuthHttpRequest", () => {
  it("completes a Google OAuth callback and renders a success page", async () => {
    await withTempDir({ prefix: "alisio-oauth-http-" }, async (root) => {
      const env = {
        OPENCLAW_STATE_DIR: root,
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
      } as NodeJS.ProcessEnv;
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
      const env = {
        OPENCLAW_STATE_DIR: root,
        ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
        ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
        ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
      } as NodeJS.ProcessEnv;
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
