import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import { createAlisioGoogleDocument, readAlisioGoogleDocument } from "./alisio-google-docs.js";
import {
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorizationFromCallback,
} from "./alisio-store.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

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

async function connectGoogleDocs(env: NodeJS.ProcessEnv) {
  const begin = await beginAlisioConnectorSetup("google-docs", env);
  const launchUrl = new URL(begin?.setupUrl ?? "");
  const authFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "docs-access",
          refresh_token: "docs-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/documents openid email",
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

describe("alisio google docs runtime", () => {
  it("creates a Google Doc with content through the connected connector", async () => {
    await withTempDir({ prefix: "alisio-google-docs-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleDocs(env);

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              documentId: "doc-1",
              title: "porto",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ replies: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );

      const result = await createAlisioGoogleDocument(
        {
          title: "porto",
          content: "porto",
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "created",
        connectorId: "google-docs",
        documentId: "doc-1",
        title: "porto",
      });
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://docs.googleapis.com/v1/documents");
      const batchUpdateTarget = fetchMock.mock.calls[1]?.[0];
      expect(
        typeof batchUpdateTarget === "string"
          ? batchUpdateTarget
          : batchUpdateTarget instanceof URL
            ? batchUpdateTarget.toString()
            : "",
      ).toContain("/documents/doc-1:batchUpdate");
    });
  });

  it("reads a Google Doc through the connected connector", async () => {
    await withTempDir({ prefix: "alisio-google-docs-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleDocs(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documentId: "doc-1",
            title: "porto",
            body: {
              content: [
                {
                  paragraph: {
                    elements: [
                      {
                        textRun: {
                          content: "porto\n",
                        },
                      },
                    ],
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await readAlisioGoogleDocument(
        {
          documentId: "https://docs.google.com/document/d/doc-1/edit",
          maxChars: 50,
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "read",
        connectorId: "google-docs",
        documentId: "doc-1",
        title: "porto",
        text: "porto",
        truncated: false,
      });
    });
  });
});
