import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorizationFromCallback,
  sendAlisioGmailMessage,
} from "./alisio-store.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

function parseJsonBody<T>(body: BodyInit | null | undefined): T {
  if (typeof body !== "string") {
    throw new Error("Expected request body to be a JSON string.");
  }
  return JSON.parse(body) as T;
}

async function createReadyAlisioAccountEnv(root: string) {
  const env = {
    OPENCLAW_STATE_DIR: root,
    ALISIO_SUPABASE_URL: "https://example.supabase.co",
    ALISIO_SUPABASE_ANON_KEY: "anon-key",
    ALISIO_GOOGLE_CLIENT_ID: "google-client-id",
    ALISIO_GOOGLE_CLIENT_SECRET: "google-client-secret",
    ALISIO_GOOGLE_REDIRECT_URI: "http://127.0.0.1:8787/oauth/google/callback",
    ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY: CONNECTOR_ENCRYPTION_KEY,
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

describe("sendAlisioGmailMessage", () => {
  it("sends a real Gmail API payload through the connected gmail-send connector", async () => {
    await withTempDir({ prefix: "alisio-gmail-send-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);

      const begin = await beginAlisioConnectorSetup("gmail-send", env);
      const launchUrl = new URL(begin?.setupUrl ?? "");
      const authFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: "gmail-access",
              refresh_token: "gmail-refresh",
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

      await completeAlisioConnectorAuthorizationFromCallback(
        {
          provider: "google",
          stateToken: launchUrl.searchParams.get("state"),
          code: "google-code",
        },
        env,
        authFetch,
      );

      const sendFetch = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "gmail-message-1",
            threadId: "gmail-thread-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await sendAlisioGmailMessage(
        {
          to: "user@example.com",
          cc: "copy@example.com",
          replyTo: "reply@example.com",
          subject: "Hello",
          body: "<p>Hello world</p>",
          bodyFormat: "html",
        },
        env,
        sendFetch,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "sent",
        connectorId: "gmail-send",
        messageId: "gmail-message-1",
        threadId: "gmail-thread-1",
        to: ["user@example.com"],
        cc: ["copy@example.com"],
        subject: "Hello",
      });

      const request = sendFetch.mock.calls[0]?.[1];
      expect(sendFetch.mock.calls[0]?.[0]).toBe(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      );
      const payload = parseJsonBody<{ raw: string }>(request?.body);
      const mime = Buffer.from(payload.raw, "base64url").toString("utf8");
      expect(mime).toContain("To: user@example.com");
      expect(mime).toContain("Cc: copy@example.com");
      expect(mime).toContain("Reply-To: reply@example.com");
      expect(mime).toContain("Subject: Hello");
      expect(mime).toContain("Content-Type: text/html; charset=UTF-8");
      expect(mime).toContain(Buffer.from("<p>Hello world</p>", "utf8").toString("base64"));
    });
  });

  it("returns auth_required when gmail-send is not connected", async () => {
    await withTempDir({ prefix: "alisio-gmail-send-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      const result = await sendAlisioGmailMessage(
        {
          to: "user@example.com",
          subject: "Hello",
          body: "Body",
        },
        env,
        vi.fn<typeof fetch>(),
      );

      expect(result).toMatchObject({
        ok: false,
        status: "auth_required",
        connectorId: "gmail-send",
        reconnectRequired: false,
      });
    });
  });
});
