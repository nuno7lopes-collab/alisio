import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import { createAlisioGoogleForm, readAlisioGoogleForm } from "./alisio-google-forms.js";
import {
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorizationFromCallback,
} from "./alisio-store.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 10).toString("base64");

function readFetchBodyText(body: unknown): string {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  return JSON.stringify(body ?? "");
}

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

async function connectGoogleForms(env: NodeJS.ProcessEnv) {
  const begin = await beginAlisioConnectorSetup("google-forms", env);
  const launchUrl = new URL(begin?.setupUrl ?? "");
  const authFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "forms-access",
          refresh_token: "forms-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/forms.body openid email",
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

describe("alisio google forms runtime", () => {
  it("creates Google Forms with text questions", async () => {
    await withTempDir({ prefix: "alisio-google-forms-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleForms(env);

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              formId: "form-1",
              info: {
                title: "Leads",
                description: "Intake",
              },
              responderUri: "https://docs.google.com/forms/d/e/form-1/viewform",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              form: {
                formId: "form-1",
                info: {
                  title: "Leads",
                  description: "Intake",
                },
                responderUri: "https://docs.google.com/forms/d/e/form-1/viewform",
                items: [
                  {
                    itemId: "item-1",
                    title: "Name",
                    questionItem: {
                      question: {
                        questionId: "question-1",
                        required: false,
                        textQuestion: {
                          paragraph: false,
                        },
                      },
                    },
                  },
                  {
                    itemId: "item-2",
                    title: "Notes",
                    questionItem: {
                      question: {
                        questionId: "question-2",
                        required: false,
                        textQuestion: {
                          paragraph: false,
                        },
                      },
                    },
                  },
                ],
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await createAlisioGoogleForm(
        {
          title: "Leads",
          description: "Intake",
          questions: ["Name", "Notes"],
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "created",
        connectorId: "google-forms",
        formId: "form-1",
        title: "Leads",
        description: "Intake",
        questionCount: 2,
      });
      const updateBody = JSON.parse(readFetchBodyText(fetchMock.mock.calls[1]?.[1]?.body));
      expect(updateBody.requests).toHaveLength(2);
      expect(updateBody.requests[0]).toMatchObject({
        createItem: {
          item: {
            title: "Name",
          },
          location: {
            index: 0,
          },
        },
      });
    });
  });

  it("reads Google Forms metadata and questions", async () => {
    await withTempDir({ prefix: "alisio-google-forms-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleForms(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            formId: "form-1",
            info: {
              title: "Leads",
              description: "Intake",
            },
            responderUri: "https://docs.google.com/forms/d/e/form-1/viewform",
            items: [
              {
                itemId: "item-1",
                title: "Name",
                questionItem: {
                  question: {
                    questionId: "question-1",
                    required: true,
                    textQuestion: {
                      paragraph: false,
                    },
                  },
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await readAlisioGoogleForm(
        {
          formId: "https://docs.google.com/forms/d/form-1/edit",
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "read",
        connectorId: "google-forms",
        formId: "form-1",
        title: "Leads",
        questionCount: 1,
      });
      if (result.ok && result.status === "read") {
        expect(result.questions[0]).toMatchObject({
          itemId: "item-1",
          questionId: "question-1",
          title: "Name",
          required: true,
          type: "text",
        });
      }
    });
  });

  it("extracts responder form ids correctly from public view URLs", async () => {
    await withTempDir({ prefix: "alisio-google-forms-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleForms(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            formId: "form-public-1",
            info: {
              title: "Public form",
            },
            items: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await readAlisioGoogleForm(
        {
          formId: "https://docs.google.com/forms/d/e/form-public-1/viewform",
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "read",
        connectorId: "google-forms",
        formId: "form-public-1",
        title: "Public form",
      });
    });
  });
});
