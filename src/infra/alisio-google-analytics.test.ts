import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  listAlisioGoogleAnalyticsAccounts,
  runAlisioGoogleAnalyticsReport,
} from "./alisio-google-analytics.js";
import {
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorizationFromCallback,
} from "./alisio-store.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString("base64");

function readFetchCallUrl(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  if (input instanceof Request) {
    return input.url;
  }
  return JSON.stringify(input);
}

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

async function connectGoogleAnalytics(env: NodeJS.ProcessEnv) {
  const begin = await beginAlisioConnectorSetup("google-analytics", env);
  const launchUrl = new URL(begin?.setupUrl ?? "");
  const authFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "analytics-access",
          refresh_token: "analytics-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/analytics.readonly openid email",
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

describe("alisio google analytics runtime", () => {
  it("lists Analytics account summaries", async () => {
    await withTempDir({ prefix: "alisio-google-analytics-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleAnalytics(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            accountSummaries: [
              {
                account: "accounts/1000",
                displayName: "Alisio",
                propertySummaries: [
                  {
                    property: "properties/2000",
                    displayName: "Main site",
                    propertyType: "PROPERTY_TYPE_ORDINARY",
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await listAlisioGoogleAnalyticsAccounts({ pageSize: 5 }, env, fetchMock);

      expect(result).toMatchObject({
        ok: true,
        status: "listed",
        connectorId: "google-analytics",
      });
      if (result.ok && result.status === "listed") {
        expect(result.accounts[0]).toMatchObject({
          accountId: "1000",
          displayName: "Alisio",
        });
        expect(result.accounts[0]?.properties[0]).toMatchObject({
          propertyId: "2000",
          displayName: "Main site",
        });
      }
      expect(readFetchCallUrl(fetchMock.mock.calls[0]?.[0])).toContain(
        "/accountSummaries?pageSize=5",
      );
    });
  });

  it("runs GA4 reports", async () => {
    await withTempDir({ prefix: "alisio-google-analytics-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleAnalytics(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            dimensionHeaders: [{ name: "country" }],
            metricHeaders: [{ name: "activeUsers" }],
            rows: [
              {
                dimensionValues: [{ value: "Portugal" }],
                metricValues: [{ value: "42" }],
              },
            ],
            rowCount: 1,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await runAlisioGoogleAnalyticsReport(
        {
          propertyId: "properties/2000",
          dimensions: ["country"],
          metrics: ["activeUsers"],
          startDate: "7daysAgo",
          endDate: "today",
          limit: 5,
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "reported",
        connectorId: "google-analytics",
        propertyId: "2000",
        rowCount: 1,
      });
      if (result.ok && result.status === "reported") {
        expect(result.rows[0]).toEqual({
          country: "Portugal",
          activeUsers: "42",
        });
      }
      const requestUrl = readFetchCallUrl(fetchMock.mock.calls[0]?.[0]);
      expect(requestUrl).toContain("/properties/2000:runReport");
      expect(JSON.parse(readFetchBodyText(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
        dimensions: [{ name: "country" }],
        metrics: [{ name: "activeUsers" }],
        dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
        limit: "5",
      });
    });
  });
});
