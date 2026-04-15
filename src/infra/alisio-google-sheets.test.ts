import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  appendAlisioGoogleSpreadsheetRows,
  createAlisioGoogleSpreadsheet,
  readAlisioGoogleSpreadsheetRange,
} from "./alisio-google-sheets.js";
import {
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorizationFromCallback,
} from "./alisio-store.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString("base64");

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

async function connectGoogleSheets(env: NodeJS.ProcessEnv) {
  const begin = await beginAlisioConnectorSetup("google-sheets", env);
  const launchUrl = new URL(begin?.setupUrl ?? "");
  const authFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "sheets-access",
          refresh_token: "sheets-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/spreadsheets openid email",
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

describe("alisio google sheets runtime", () => {
  it("creates Google Sheets spreadsheets with initial rows", async () => {
    await withTempDir({ prefix: "alisio-google-sheets-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleSheets(env);

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              spreadsheetId: "sheet-1",
              spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ updatedRows: 2 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );

      const result = await createAlisioGoogleSpreadsheet(
        {
          title: "porto",
          headers: ["city", "country"],
          rows: [["Porto", "Portugal"]],
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "created",
        connectorId: "google-sheets",
        spreadsheetId: "sheet-1",
        title: "porto",
        sheetTitle: "Sheet1",
        rowCount: 2,
      });
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://sheets.googleapis.com/v4/spreadsheets");
      expect(readFetchCallUrl(fetchMock.mock.calls[1]?.[0])).toContain("/values/Sheet1!A1");
    });
  });

  it("reads Google Sheets ranges through the connected connector", async () => {
    await withTempDir({ prefix: "alisio-google-sheets-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleSheets(env);

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              spreadsheetId: "sheet-1",
              spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
              properties: { title: "porto" },
              sheets: [{ properties: { title: "Sheet1" } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              range: "Sheet1!A:B",
              values: [
                ["city", "country"],
                ["Porto", "Portugal"],
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await readAlisioGoogleSpreadsheetRange(
        {
          spreadsheetId: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
          range: "Sheet1!A:B",
          maxRows: 10,
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "read",
        connectorId: "google-sheets",
        spreadsheetId: "sheet-1",
        title: "porto",
        range: "Sheet1!A:B",
        rowCount: 2,
        truncatedRows: false,
      });
      if (result.ok && result.status === "read") {
        expect(result.values).toEqual([
          ["city", "country"],
          ["Porto", "Portugal"],
        ]);
      }
      const readUrl = new URL(readFetchCallUrl(fetchMock.mock.calls[1]?.[0]));
      expect(readUrl.pathname).toBe("/v4/spreadsheets/sheet-1/values/Sheet1!A%3AB");
    });
  });

  it("appends Google Sheets rows through the connected connector", async () => {
    await withTempDir({ prefix: "alisio-google-sheets-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleSheets(env);

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              spreadsheetId: "sheet-1",
              spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet-1/edit",
              properties: { title: "porto" },
              sheets: [{ properties: { title: "Sheet1" } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              tableRange: "Sheet1!A1:B2",
              updates: {
                updatedRange: "Sheet1!A3:B3",
                updatedRows: 1,
                updatedColumns: 2,
                updatedCells: 2,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      const result = await appendAlisioGoogleSpreadsheetRows(
        {
          spreadsheetId: "sheet-1",
          range: "Sheet1!A:B",
          rows: [["Braga", "Portugal"]],
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "appended",
        connectorId: "google-sheets",
        spreadsheetId: "sheet-1",
        updatedRows: 1,
        updatedColumns: 2,
        updatedCells: 2,
        tableRange: "Sheet1!A1:B2",
      });
      const appendUrl = new URL(readFetchCallUrl(fetchMock.mock.calls[1]?.[0]));
      expect(appendUrl.pathname).toBe("/v4/spreadsheets/sheet-1/values/Sheet1!A%3AB:append");
      expect(JSON.parse(readFetchBodyText(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
        majorDimension: "ROWS",
        values: [["Braga", "Portugal"]],
      });
    });
  });
});
