import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  createAlisioGoogleDriveTextFile,
  readAlisioGoogleDriveFile,
  searchAlisioGoogleDriveFiles,
} from "./alisio-google-drive.js";
import {
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorizationFromCallback,
} from "./alisio-store.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");

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

async function connectGoogleDrive(env: NodeJS.ProcessEnv) {
  const begin = await beginAlisioConnectorSetup("google-drive", env);
  const launchUrl = new URL(begin?.setupUrl ?? "");
  const authFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "drive-access",
          refresh_token: "drive-refresh",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/drive openid email",
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

describe("alisio google drive runtime", () => {
  it("searches Google Drive files through the connected connector", async () => {
    await withTempDir({ prefix: "alisio-google-drive-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleDrive(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            nextPageToken: "next-1",
            files: [
              {
                id: "file-1",
                name: "porto.txt",
                mimeType: "text/plain",
                modifiedTime: "2026-04-15T10:00:00Z",
                size: "5",
                webViewLink: "https://drive.google.com/file/d/file-1/view",
                webContentLink: "https://content.googleusercontent.com/file-1",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await searchAlisioGoogleDriveFiles(
        {
          query: "porto",
          folderId: "folder-1",
          maxResults: 4,
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "listed",
        connectorId: "google-drive",
        nextPageToken: "next-1",
      });
      if (result.ok && result.status === "listed") {
        expect(result.files[0]).toMatchObject({
          fileId: "file-1",
          name: "porto.txt",
          mimeType: "text/plain",
          size: 5,
        });
      }

      const requestUrl = new URL(readFetchCallUrl(fetchMock.mock.calls[0]?.[0]));
      expect(requestUrl.pathname).toBe("/drive/v3/files");
      expect(requestUrl.searchParams.get("pageSize")).toBe("4");
      expect(requestUrl.searchParams.get("q")).toContain("trashed = false");
      expect(requestUrl.searchParams.get("q")).toContain("name contains 'porto'");
      expect(requestUrl.searchParams.get("q")).toContain("fullText contains 'porto'");
      expect(requestUrl.searchParams.get("q")).toContain("'folder-1' in parents");
    });
  });

  it("reads Google Docs exports through Google Drive", async () => {
    await withTempDir({ prefix: "alisio-google-drive-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleDrive(env);

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: "file-1",
              name: "porto",
              mimeType: "application/vnd.google-apps.document",
              webViewLink: "https://docs.google.com/document/d/file-1/edit",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          new Response("porto notes", {
            status: 200,
            headers: { "content-type": "text/plain; charset=utf-8" },
          }),
        );

      const result = await readAlisioGoogleDriveFile(
        {
          fileId: "https://drive.google.com/file/d/file-1/view",
          maxChars: 5,
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "read",
        connectorId: "google-drive",
        exportMimeType: "text/plain",
        text: "porto",
        truncated: true,
      });
      if (result.ok && result.status === "read") {
        expect(result.file).toMatchObject({
          fileId: "file-1",
          name: "porto",
          mimeType: "application/vnd.google-apps.document",
        });
      }

      expect(readFetchCallUrl(fetchMock.mock.calls[0]?.[0])).toContain("/drive/v3/files/file-1");
      expect(readFetchCallUrl(fetchMock.mock.calls[1]?.[0])).toContain(
        "/drive/v3/files/file-1/export",
      );
      const exportUrl = new URL(readFetchCallUrl(fetchMock.mock.calls[1]?.[0]));
      expect(exportUrl.searchParams.get("mimeType")).toBe("text/plain");
    });
  });

  it("creates text files in Google Drive through multipart upload", async () => {
    await withTempDir({ prefix: "alisio-google-drive-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGoogleDrive(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "file-1",
            name: "porto.md",
            mimeType: "text/markdown",
            webViewLink: "https://drive.google.com/file/d/file-1/view",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await createAlisioGoogleDriveTextFile(
        {
          name: "porto.md",
          content: "porto",
          folderId: "folder-1",
          mimeType: "text/markdown",
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "created",
        connectorId: "google-drive",
        contentLength: 5,
      });
      if (result.ok && result.status === "created") {
        expect(result.file).toMatchObject({
          fileId: "file-1",
          name: "porto.md",
          mimeType: "text/markdown",
        });
      }

      const requestUrl = new URL(readFetchCallUrl(fetchMock.mock.calls[0]?.[0]));
      expect(requestUrl.pathname).toBe("/upload/drive/v3/files");
      expect(requestUrl.searchParams.get("uploadType")).toBe("multipart");
      const requestInit = fetchMock.mock.calls[0]?.[1];
      const body = readFetchBodyText(requestInit?.body);
      expect(requestInit?.method).toBe("POST");
      expect(body).toContain('"name":"porto.md"');
      expect(body).toContain('"parents":["folder-1"]');
      expect(body).toContain("Content-Type: text/markdown; charset=UTF-8");
      expect(body).toContain("porto");
    });
  });
});
