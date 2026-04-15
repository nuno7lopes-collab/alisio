import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  modifyAlisioGmailMessage,
  readAlisioGmailMessage,
  searchAlisioGmailMessages,
} from "./alisio-gmail.js";
import {
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorizationFromCallback,
} from "./alisio-store.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");

async function createReadyAlisioAccountEnv(root: string) {
  const env = {
    ALISIO_STATE_DIR: root,
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

async function connectConnector(
  connectorId: "gmail-read" | "gmail-modify",
  scopes: string,
  env: NodeJS.ProcessEnv,
) {
  const begin = await beginAlisioConnectorSetup(connectorId, env);
  const launchUrl = new URL(begin?.setupUrl ?? "");
  const authFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: `${connectorId}-access`,
          refresh_token: `${connectorId}-refresh`,
          expires_in: 3600,
          token_type: "Bearer",
          scope: scopes,
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
}

describe("alisio gmail runtime", () => {
  it("reads Gmail through gmail-modify when gmail-read is not connected", async () => {
    await withTempDir({ prefix: "alisio-gmail-runtime-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectConnector(
        "gmail-modify",
        "https://www.googleapis.com/auth/gmail.modify openid email",
        env,
      );

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "msg-1",
            threadId: "thread-1",
            snippet: "porto",
            payload: {
              headers: [
                { name: "Subject", value: "Porto" },
                { name: "From", value: "user@example.com" },
              ],
              body: {
                data: Buffer.from("porto", "utf8").toString("base64url"),
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await readAlisioGmailMessage(
        {
          messageId: "msg-1",
          maxChars: 50,
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "read",
        connectorId: "gmail-modify",
      });
    });
  });

  it("searches Gmail and returns normalized message summaries", async () => {
    await withTempDir({ prefix: "alisio-gmail-runtime-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectConnector(
        "gmail-read",
        "https://www.googleapis.com/auth/gmail.readonly openid email",
        env,
      );

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              resultSizeEstimate: 1,
              messages: [{ id: "msg-1" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: "msg-1",
              threadId: "thread-1",
              snippet: "porto",
              payload: {
                headers: [
                  { name: "Subject", value: "Porto" },
                  { name: "From", value: "user@example.com" },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await searchAlisioGmailMessages(
        {
          query: "porto",
          maxResults: 3,
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "listed",
        connectorId: "gmail-read",
        resultSizeEstimate: 1,
      });
      if (result.ok && result.status === "listed") {
        expect(result.messages[0]).toMatchObject({
          messageId: "msg-1",
          subject: "Porto",
        });
      }
    });
  });

  it("archives Gmail messages through gmail-modify", async () => {
    await withTempDir({ prefix: "alisio-gmail-runtime-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectConnector(
        "gmail-modify",
        "https://www.googleapis.com/auth/gmail.modify openid email",
        env,
      );

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "msg-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const result = await modifyAlisioGmailMessage(
        {
          action: "archive",
          messageId: "msg-1",
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "modified",
        connectorId: "gmail-modify",
        action: "archive",
        messageId: "msg-1",
        removedLabelIds: ["INBOX"],
      });
    });
  });
});
