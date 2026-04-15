import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  createAlisioGitHubIssue,
  getAlisioGitHubProfile,
  listAlisioGitHubIssues,
  listAlisioGitHubPullRequests,
  listAlisioGitHubRepositories,
  readAlisioGitHubFile,
} from "./alisio-github.js";
import {
  beginAlisioConnectorSetup,
  completeAlisioConnectorAuthorizationFromCallback,
} from "./alisio-store.js";

const CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");

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
    ALISIO_GITHUB_CLIENT_ID: "github-client-id",
    ALISIO_GITHUB_CLIENT_SECRET: "github-client-secret",
    ALISIO_GITHUB_REDIRECT_URI: "http://127.0.0.1:8787/oauth/github/callback",
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

async function connectGitHub(env: NodeJS.ProcessEnv) {
  const begin = await beginAlisioConnectorSetup("github", env);
  const launchUrl = new URL(begin?.setupUrl ?? "");
  const authFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "github-access",
          token_type: "bearer",
          scope: "repo read:user user:email read:org gist",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          login: "nuno",
          name: "Nuno Lopes",
          email: null,
          html_url: "https://github.com/nuno",
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

  await completeAlisioConnectorAuthorizationFromCallback(
    {
      provider: "github",
      stateToken: launchUrl.searchParams.get("state"),
      code: "github-code",
    },
    env,
    authFetch,
  );
}

describe("alisio github runtime", () => {
  it("reads the connected GitHub profile", async () => {
    await withTempDir({ prefix: "alisio-github-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGitHub(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            login: "nuno",
            name: "Nuno Lopes",
            email: "nuno@github.example",
            avatar_url: "https://avatars.githubusercontent.com/u/1",
            html_url: "https://github.com/nuno",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await getAlisioGitHubProfile(env, fetchMock);

      expect(result).toMatchObject({
        ok: true,
        status: "profile",
        connectorId: "github",
        profile: {
          login: "nuno",
          email: "nuno@github.example",
        },
      });
      expect(readFetchCallUrl(fetchMock.mock.calls[0]?.[0])).toContain("/user");
    });
  });

  it("lists repositories and preserves key metadata", async () => {
    await withTempDir({ prefix: "alisio-github-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGitHub(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              full_name: "nuno/alisio",
              name: "alisio",
              private: false,
              html_url: "https://github.com/nuno/alisio",
              description: "Personal agent",
              default_branch: "main",
              visibility: "public",
              archived: false,
              fork: false,
              open_issues_count: 12,
              language: "TypeScript",
              updated_at: "2026-04-15T10:00:00Z",
              pushed_at: "2026-04-15T10:05:00Z",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await listAlisioGitHubRepositories(
        { visibility: "public", limit: 5 },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "repos_listed",
        connectorId: "github",
        repositories: [
          {
            fullName: "nuno/alisio",
            defaultBranch: "main",
            primaryLanguage: "TypeScript",
          },
        ],
      });
      expect(readFetchCallUrl(fetchMock.mock.calls[0]?.[0])).toContain("/user/repos");
      expect(readFetchCallUrl(fetchMock.mock.calls[0]?.[0])).toContain("visibility=public");
    });
  });

  it("filters pull requests out of the issues list", async () => {
    await withTempDir({ prefix: "alisio-github-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGitHub(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              number: 41,
              title: "Fix runtime gap",
              state: "open",
              html_url: "https://github.com/nuno/alisio/issues/41",
              user: { login: "nuno" },
              labels: [{ name: "bug" }],
            },
            {
              number: 42,
              title: "PR masquerading in issues API",
              state: "open",
              html_url: "https://github.com/nuno/alisio/pull/42",
              user: { login: "nuno" },
              pull_request: {},
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await listAlisioGitHubIssues(
        { repository: "nuno/alisio", state: "open", limit: 10 },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "issues_listed",
        connectorId: "github",
        repository: "nuno/alisio",
        issues: [{ number: 41 }],
      });
      if (result.ok && result.status === "issues_listed") {
        expect(result.issues).toHaveLength(1);
      }
    });
  });

  it("creates GitHub issues", async () => {
    await withTempDir({ prefix: "alisio-github-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGitHub(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            number: 77,
            title: "Investigate connector gap",
            state: "open",
            html_url: "https://github.com/nuno/alisio/issues/77",
            user: { login: "nuno" },
            body: "Details",
            labels: [],
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await createAlisioGitHubIssue(
        {
          repository: "https://github.com/nuno/alisio",
          title: "Investigate connector gap",
          body: "Details",
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "issue_created",
        connectorId: "github",
        repository: "nuno/alisio",
        issue: { number: 77 },
      });
      expect(JSON.parse(readFetchBodyText(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
        title: "Investigate connector gap",
        body: "Details",
      });
    });
  });

  it("lists pull requests", async () => {
    await withTempDir({ prefix: "alisio-github-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGitHub(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              number: 12,
              title: "Close the connector gap",
              state: "open",
              html_url: "https://github.com/nuno/alisio/pull/12",
              user: { login: "nuno" },
              draft: false,
              head: { ref: "codex/github-runtime" },
              base: { ref: "main" },
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await listAlisioGitHubPullRequests(
        { repository: "nuno/alisio", state: "open", limit: 5 },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "pulls_listed",
        connectorId: "github",
        repository: "nuno/alisio",
        pullRequests: [{ number: 12, headRef: "codex/github-runtime", baseRef: "main" }],
      });
    });
  });

  it("reads repository files from blob URLs and truncates content", async () => {
    await withTempDir({ prefix: "alisio-github-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);
      await connectGitHub(env);

      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            type: "file",
            size: 12,
            sha: "sha-1",
            content: Buffer.from("console.log(1);\n").toString("base64"),
            encoding: "base64",
            html_url: "https://github.com/nuno/alisio/blob/main/src/index.ts",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const result = await readAlisioGitHubFile(
        {
          repository: "https://github.com/nuno/alisio/blob/main/src/index.ts",
          maxChars: 8,
        },
        env,
        fetchMock,
      );

      expect(result).toMatchObject({
        ok: true,
        status: "file_read",
        connectorId: "github",
        repository: "nuno/alisio",
        path: "src/index.ts",
        ref: "main",
        truncated: true,
        sha: "sha-1",
      });
      if (result.ok && result.status === "file_read") {
        expect(result.content).toBe("console.");
      }
      expect(readFetchCallUrl(fetchMock.mock.calls[0]?.[0])).toContain(
        "/repos/nuno/alisio/contents/src/index.ts",
      );
      expect(readFetchCallUrl(fetchMock.mock.calls[0]?.[0])).toContain("ref=main");
    });
  });

  it("returns auth_required when GitHub is not connected", async () => {
    await withTempDir({ prefix: "alisio-github-" }, async (root) => {
      const env = await createReadyAlisioAccountEnv(root);

      const result = await getAlisioGitHubProfile(env, vi.fn<typeof fetch>());

      expect(result).toEqual({
        ok: false,
        status: "auth_required",
        connectorId: "github",
        message: "GitHub is not connected in Alisio. Connect GitHub in Apps first.",
        reconnectRequired: false,
      });
    });
  });
});
