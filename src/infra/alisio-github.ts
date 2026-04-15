import { Buffer } from "node:buffer";
import { resolveAlisioConnectorRuntimeAccess } from "./alisio-connector-runtime.js";

const GITHUB_CONNECTOR_ID = "github";
const GITHUB_API_ROOT = "https://api.github.com";

type GitHubRepositoryTarget = {
  owner: string;
  name: string;
  fullName: string;
  url: string;
};

type GitHubFileTarget = GitHubRepositoryTarget & {
  path: string;
  ref?: string;
};

export type AlisioGitHubProfile = {
  login: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
  url: string;
};

export type AlisioGitHubRepositorySummary = {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  url: string;
  description?: string;
  defaultBranch?: string;
  visibility?: string;
  archived?: boolean;
  fork?: boolean;
  openIssuesCount?: number;
  primaryLanguage?: string;
  updatedAt?: string;
  pushedAt?: string;
};

export type AlisioGitHubIssueSummary = {
  number: number;
  title: string;
  state: string;
  url: string;
  author?: string;
  body?: string;
  labels: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type AlisioGitHubPullRequestSummary = {
  number: number;
  title: string;
  state: string;
  url: string;
  author?: string;
  body?: string;
  draft?: boolean;
  headRef?: string;
  baseRef?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AlisioGitHubResult =
  | {
      ok: true;
      status: "profile";
      connectorId: "github";
      profile: AlisioGitHubProfile;
    }
  | {
      ok: true;
      status: "repos_listed";
      connectorId: "github";
      repositories: AlisioGitHubRepositorySummary[];
    }
  | {
      ok: true;
      status: "repo";
      connectorId: "github";
      repository: AlisioGitHubRepositorySummary;
    }
  | {
      ok: true;
      status: "issues_listed";
      connectorId: "github";
      repository: string;
      issues: AlisioGitHubIssueSummary[];
    }
  | {
      ok: true;
      status: "issue_created";
      connectorId: "github";
      repository: string;
      issue: AlisioGitHubIssueSummary;
    }
  | {
      ok: true;
      status: "pulls_listed";
      connectorId: "github";
      repository: string;
      pullRequests: AlisioGitHubPullRequestSummary[];
    }
  | {
      ok: true;
      status: "file_read";
      connectorId: "github";
      repository: string;
      path: string;
      ref?: string;
      content: string;
      truncated: boolean;
      size?: number;
      sha?: string;
      url: string;
    }
  | {
      ok: false;
      status: "auth_required" | "read_failed" | "write_failed";
      connectorId: "github";
      message: string;
      reconnectRequired?: boolean;
      apiMessage?: string;
    };

function buildGitHubAuthError(params: { reconnectRequired: boolean }): AlisioGitHubResult {
  return {
    ok: false,
    status: "auth_required",
    connectorId: GITHUB_CONNECTOR_ID,
    message: params.reconnectRequired
      ? "GitHub authorization is no longer valid. Reconnect GitHub in Apps."
      : "GitHub is not connected in Alisio. Connect GitHub in Apps first.",
    reconnectRequired: params.reconnectRequired,
  };
}

function normalizeGitHubRepositorySpecifier(value: string): GitHubRepositoryTarget | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch?.[1] && sshMatch[2]) {
    const owner = sshMatch[1].trim();
    const name = sshMatch[2].trim();
    if (owner && name) {
      return {
        owner,
        name,
        fullName: `${owner}/${name}`,
        url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      };
    }
  }

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);
    if ((host === "github.com" || host === "www.github.com") && parts.length >= 2) {
      const owner = parts[0]?.trim();
      const rawName = parts[1]?.trim();
      const name = rawName?.replace(/\.git$/i, "");
      if (owner && name) {
        return {
          owner,
          name,
          fullName: `${owner}/${name}`,
          url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
        };
      }
    }
    if (host === "api.github.com" && parts.length >= 3 && parts[0] === "repos") {
      const owner = parts[1]?.trim();
      const rawName = parts[2]?.trim();
      const name = rawName?.replace(/\.git$/i, "");
      if (owner && name) {
        return {
          owner,
          name,
          fullName: `${owner}/${name}`,
          url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
        };
      }
    }
  } catch {
    // Treat plain owner/repo specifiers below.
  }

  const plainMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!plainMatch?.[1] || !plainMatch[2]) {
    return null;
  }
  const owner = plainMatch[1].trim();
  const name = plainMatch[2].trim().replace(/\.git$/i, "");
  if (!owner || !name) {
    return null;
  }
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
    url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
  };
}

function normalizeGitHubBlobUrl(value: string): GitHubFileTarget | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);
    if ((host === "github.com" || host === "www.github.com") && parts.length >= 5) {
      const [owner, name, marker, ref, ...pathParts] = parts;
      if (marker === "blob" && owner && name && ref && pathParts.length > 0) {
        return {
          owner,
          name,
          fullName: `${owner}/${name}`,
          url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
          ref,
          path: pathParts.join("/"),
        };
      }
    }
    if (host === "raw.githubusercontent.com" && parts.length >= 4) {
      const [owner, name, ref, ...pathParts] = parts;
      if (owner && name && ref && pathParts.length > 0) {
        return {
          owner,
          name,
          fullName: `${owner}/${name}`,
          url: `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
          ref,
          path: pathParts.join("/"),
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeGitHubFileTarget(input: {
  repository: string;
  path?: string;
  ref?: string;
}): GitHubFileTarget | null {
  const fromPath = input.path ? normalizeGitHubBlobUrl(input.path) : null;
  if (fromPath) {
    return fromPath;
  }
  const fromRepository = normalizeGitHubBlobUrl(input.repository);
  if (fromRepository) {
    return fromRepository;
  }
  const repository = normalizeGitHubRepositorySpecifier(input.repository);
  const rawPath = input.path?.trim().replace(/^\/+/, "");
  if (!repository || !rawPath) {
    return null;
  }
  const ref = input.ref?.trim();
  return {
    ...repository,
    path: rawPath,
    ...(ref ? { ref } : {}),
  };
}

function encodeGitHubPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function extractGitHubApiMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
    const errors = (body as { errors?: unknown }).errors;
    if (Array.isArray(errors)) {
      const errorMessage = errors.find((entry): entry is { message: string } =>
        Boolean(
          entry &&
          typeof entry === "object" &&
          typeof (entry as { message?: unknown }).message === "string" &&
          (entry as { message: string }).message.trim(),
        ),
      )?.message;
      if (errorMessage?.trim()) {
        return errorMessage.trim();
      }
    }
  }
  return fallback;
}

function isGitHubReconnectRequired(statusCode: number, body: unknown): boolean {
  if (statusCode === 401) {
    return true;
  }
  const message = extractGitHubApiMessage(body, "").toLowerCase();
  return message.includes("bad credentials") || message.includes("requires authentication");
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeGitHubRepository(
  body: Record<string, unknown>,
): AlisioGitHubRepositorySummary | null {
  const fullName = readOptionalTrimmedString(body.full_name);
  const rawName = readOptionalTrimmedString(body.name);
  const htmlUrl = readOptionalTrimmedString(body.html_url);
  const privateRepo = typeof body.private === "boolean" ? body.private : undefined;
  if (!fullName || !rawName || !htmlUrl || privateRepo === undefined) {
    return null;
  }
  const [owner] = fullName.split("/");
  if (!owner?.trim()) {
    return null;
  }
  return {
    owner: owner.trim(),
    name: rawName,
    fullName,
    private: privateRepo,
    url: htmlUrl,
    ...(readOptionalTrimmedString(body.description)
      ? { description: readOptionalTrimmedString(body.description) }
      : {}),
    ...(readOptionalTrimmedString(body.default_branch)
      ? { defaultBranch: readOptionalTrimmedString(body.default_branch) }
      : {}),
    ...(readOptionalTrimmedString(body.visibility)
      ? { visibility: readOptionalTrimmedString(body.visibility) }
      : {}),
    ...(typeof body.archived === "boolean" ? { archived: body.archived } : {}),
    ...(typeof body.fork === "boolean" ? { fork: body.fork } : {}),
    ...(readOptionalFiniteNumber(body.open_issues_count) !== undefined
      ? { openIssuesCount: readOptionalFiniteNumber(body.open_issues_count) }
      : {}),
    ...(readOptionalTrimmedString(body.language)
      ? { primaryLanguage: readOptionalTrimmedString(body.language) }
      : {}),
    ...(readOptionalTrimmedString(body.updated_at)
      ? { updatedAt: readOptionalTrimmedString(body.updated_at) }
      : {}),
    ...(readOptionalTrimmedString(body.pushed_at)
      ? { pushedAt: readOptionalTrimmedString(body.pushed_at) }
      : {}),
  };
}

function normalizeGitHubIssue(body: Record<string, unknown>): AlisioGitHubIssueSummary | null {
  const number = readOptionalFiniteNumber(body.number);
  const title = readOptionalTrimmedString(body.title);
  const state = readOptionalTrimmedString(body.state);
  const url = readOptionalTrimmedString(body.html_url);
  if (number === undefined || !title || !state || !url) {
    return null;
  }
  const user =
    body.user && typeof body.user === "object"
      ? readOptionalTrimmedString((body.user as { login?: unknown }).login)
      : undefined;
  const labels = Array.isArray(body.labels)
    ? body.labels.flatMap((entry) => {
        if (typeof entry === "string" && entry.trim()) {
          return [entry.trim()];
        }
        if (entry && typeof entry === "object") {
          const name = readOptionalTrimmedString((entry as { name?: unknown }).name);
          return name ? [name] : [];
        }
        return [];
      })
    : [];
  return {
    number,
    title,
    state,
    url,
    labels,
    ...(user ? { author: user } : {}),
    ...(readOptionalTrimmedString(body.body) ? { body: readOptionalTrimmedString(body.body) } : {}),
    ...(readOptionalTrimmedString(body.created_at)
      ? { createdAt: readOptionalTrimmedString(body.created_at) }
      : {}),
    ...(readOptionalTrimmedString(body.updated_at)
      ? { updatedAt: readOptionalTrimmedString(body.updated_at) }
      : {}),
  };
}

function normalizeGitHubPullRequest(
  body: Record<string, unknown>,
): AlisioGitHubPullRequestSummary | null {
  const number = readOptionalFiniteNumber(body.number);
  const title = readOptionalTrimmedString(body.title);
  const state = readOptionalTrimmedString(body.state);
  const url = readOptionalTrimmedString(body.html_url);
  if (number === undefined || !title || !state || !url) {
    return null;
  }
  const user =
    body.user && typeof body.user === "object"
      ? readOptionalTrimmedString((body.user as { login?: unknown }).login)
      : undefined;
  const headRef =
    body.head && typeof body.head === "object"
      ? readOptionalTrimmedString((body.head as { ref?: unknown }).ref)
      : undefined;
  const baseRef =
    body.base && typeof body.base === "object"
      ? readOptionalTrimmedString((body.base as { ref?: unknown }).ref)
      : undefined;
  return {
    number,
    title,
    state,
    url,
    ...(user ? { author: user } : {}),
    ...(readOptionalTrimmedString(body.body) ? { body: readOptionalTrimmedString(body.body) } : {}),
    ...(typeof body.draft === "boolean" ? { draft: body.draft } : {}),
    ...(headRef ? { headRef } : {}),
    ...(baseRef ? { baseRef } : {}),
    ...(readOptionalTrimmedString(body.created_at)
      ? { createdAt: readOptionalTrimmedString(body.created_at) }
      : {}),
    ...(readOptionalTrimmedString(body.updated_at)
      ? { updatedAt: readOptionalTrimmedString(body.updated_at) }
      : {}),
  };
}

function normalizeGitHubProfile(body: Record<string, unknown>): AlisioGitHubProfile | null {
  const login = readOptionalTrimmedString(body.login);
  const url = readOptionalTrimmedString(body.html_url);
  if (!login || !url) {
    return null;
  }
  return {
    login,
    url,
    ...(readOptionalTrimmedString(body.name) ? { name: readOptionalTrimmedString(body.name) } : {}),
    ...(readOptionalTrimmedString(body.email)
      ? { email: readOptionalTrimmedString(body.email) }
      : {}),
    ...(readOptionalTrimmedString(body.avatar_url)
      ? { avatarUrl: readOptionalTrimmedString(body.avatar_url) }
      : {}),
  };
}

async function readGitHubResponseBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function callGitHubApi(params: {
  accessToken: string;
  path: string;
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  accept?: string;
  fetchImpl: typeof fetch;
}) {
  const url = new URL(`${GITHUB_API_ROOT}${params.path}`);
  for (const [key, value] of Object.entries(params.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await params.fetchImpl(url, {
    method: params.method ?? "GET",
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      accept: params.accept ?? "application/vnd.github+json",
      "user-agent": "Alisio",
      "x-github-api-version": "2022-11-28",
      ...(params.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(params.body === undefined ? {} : { body: JSON.stringify(params.body) }),
  });
  return {
    url: url.toString(),
    response,
    body: await readGitHubResponseBody(response),
  };
}

function normalizeGitHubText(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return { content: text, truncated: false };
  }
  return {
    content: text.slice(0, maxChars),
    truncated: true,
  };
}

export async function getAlisioGitHubProfile(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGitHubResult> {
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GITHUB_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildGitHubAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  try {
    const result = await callGitHubApi({
      accessToken: authorization.accessToken,
      path: "/user",
      fetchImpl,
    });
    if (!result.response.ok || !result.body || typeof result.body !== "object") {
      const reconnectRequired = isGitHubReconnectRequired(result.response.status, result.body);
      const apiMessage = extractGitHubApiMessage(
        result.body,
        "GitHub rejected the profile request.",
      );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: GITHUB_CONNECTOR_ID,
        message: reconnectRequired
          ? "GitHub authorization is no longer valid. Reconnect GitHub in Apps."
          : apiMessage,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        apiMessage,
      };
    }
    const profile = normalizeGitHubProfile(result.body as Record<string, unknown>);
    if (!profile) {
      return {
        ok: false,
        status: "read_failed",
        connectorId: GITHUB_CONNECTOR_ID,
        message: "GitHub returned an incomplete account profile.",
      };
    }
    return {
      ok: true,
      status: "profile",
      connectorId: GITHUB_CONNECTOR_ID,
      profile,
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub could not be reached right now. Try again in a moment.",
    };
  }
}

export async function listAlisioGitHubRepositories(
  input: {
    visibility?: "all" | "public" | "private" | "internal";
    limit?: number;
  } = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGitHubResult> {
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GITHUB_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildGitHubAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(Math.max(1, Math.trunc(input.limit)), 100)
      : 20;

  try {
    const result = await callGitHubApi({
      accessToken: authorization.accessToken,
      path: "/user/repos",
      query: {
        sort: "updated",
        per_page: limit,
        affiliation: "owner,collaborator,organization_member",
        ...(input.visibility ? { visibility: input.visibility } : {}),
      },
      fetchImpl,
    });
    if (!result.response.ok || !Array.isArray(result.body)) {
      const reconnectRequired = isGitHubReconnectRequired(result.response.status, result.body);
      const apiMessage = extractGitHubApiMessage(
        result.body,
        "GitHub rejected the repository list request.",
      );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: GITHUB_CONNECTOR_ID,
        message: reconnectRequired
          ? "GitHub authorization is no longer valid. Reconnect GitHub in Apps."
          : apiMessage,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        apiMessage,
      };
    }
    return {
      ok: true,
      status: "repos_listed",
      connectorId: GITHUB_CONNECTOR_ID,
      repositories: result.body.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const repository = normalizeGitHubRepository(entry as Record<string, unknown>);
        return repository ? [repository] : [];
      }),
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub could not be reached right now. Try again in a moment.",
    };
  }
}

export async function readAlisioGitHubRepository(
  input: {
    repository: string;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGitHubResult> {
  const repository = normalizeGitHubRepositorySpecifier(input.repository);
  if (!repository) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub repository must be an owner/repo pair or GitHub URL.",
    };
  }
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GITHUB_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildGitHubAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  try {
    const result = await callGitHubApi({
      accessToken: authorization.accessToken,
      path: `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`,
      fetchImpl,
    });
    if (!result.response.ok || !result.body || typeof result.body !== "object") {
      const reconnectRequired = isGitHubReconnectRequired(result.response.status, result.body);
      const apiMessage = extractGitHubApiMessage(
        result.body,
        "GitHub rejected the repository request.",
      );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: GITHUB_CONNECTOR_ID,
        message: reconnectRequired
          ? "GitHub authorization is no longer valid. Reconnect GitHub in Apps."
          : apiMessage,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        apiMessage,
      };
    }
    const normalized = normalizeGitHubRepository(result.body as Record<string, unknown>);
    if (!normalized) {
      return {
        ok: false,
        status: "read_failed",
        connectorId: GITHUB_CONNECTOR_ID,
        message: "GitHub returned incomplete repository metadata.",
      };
    }
    return {
      ok: true,
      status: "repo",
      connectorId: GITHUB_CONNECTOR_ID,
      repository: normalized,
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub could not be reached right now. Try again in a moment.",
    };
  }
}

export async function listAlisioGitHubIssues(
  input: {
    repository: string;
    state?: "open" | "closed" | "all";
    limit?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGitHubResult> {
  const repository = normalizeGitHubRepositorySpecifier(input.repository);
  if (!repository) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub repository must be an owner/repo pair or GitHub URL.",
    };
  }
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GITHUB_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildGitHubAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const state = input.state ?? "open";
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(Math.max(1, Math.trunc(input.limit)), 100)
      : 20;

  try {
    const result = await callGitHubApi({
      accessToken: authorization.accessToken,
      path: `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues`,
      query: {
        state,
        per_page: limit,
      },
      fetchImpl,
    });
    if (!result.response.ok || !Array.isArray(result.body)) {
      const reconnectRequired = isGitHubReconnectRequired(result.response.status, result.body);
      const apiMessage = extractGitHubApiMessage(
        result.body,
        "GitHub rejected the issues request.",
      );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: GITHUB_CONNECTOR_ID,
        message: reconnectRequired
          ? "GitHub authorization is no longer valid. Reconnect GitHub in Apps."
          : apiMessage,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        apiMessage,
      };
    }
    return {
      ok: true,
      status: "issues_listed",
      connectorId: GITHUB_CONNECTOR_ID,
      repository: repository.fullName,
      issues: result.body.flatMap((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          "pull_request" in (entry as Record<string, unknown>)
        ) {
          return [];
        }
        const issue = normalizeGitHubIssue(entry as Record<string, unknown>);
        return issue ? [issue] : [];
      }),
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub could not be reached right now. Try again in a moment.",
    };
  }
}

export async function createAlisioGitHubIssue(
  input: {
    repository: string;
    title: string;
    body?: string;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGitHubResult> {
  const repository = normalizeGitHubRepositorySpecifier(input.repository);
  const title = input.title.trim();
  if (!repository) {
    return {
      ok: false,
      status: "write_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub repository must be an owner/repo pair or GitHub URL.",
    };
  }
  if (!title) {
    return {
      ok: false,
      status: "write_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub issue title is required.",
    };
  }
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GITHUB_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildGitHubAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  try {
    const result = await callGitHubApi({
      accessToken: authorization.accessToken,
      path: `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/issues`,
      method: "POST",
      body: {
        title,
        ...(input.body?.trim() ? { body: input.body.trim() } : {}),
      },
      fetchImpl,
    });
    if (!result.response.ok || !result.body || typeof result.body !== "object") {
      const reconnectRequired = isGitHubReconnectRequired(result.response.status, result.body);
      const apiMessage = extractGitHubApiMessage(
        result.body,
        "GitHub rejected the issue creation request.",
      );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "write_failed",
        connectorId: GITHUB_CONNECTOR_ID,
        message: reconnectRequired
          ? "GitHub authorization is no longer valid. Reconnect GitHub in Apps."
          : apiMessage,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        apiMessage,
      };
    }
    const issue = normalizeGitHubIssue(result.body as Record<string, unknown>);
    if (!issue) {
      return {
        ok: false,
        status: "write_failed",
        connectorId: GITHUB_CONNECTOR_ID,
        message: "GitHub returned incomplete issue metadata after creation.",
      };
    }
    return {
      ok: true,
      status: "issue_created",
      connectorId: GITHUB_CONNECTOR_ID,
      repository: repository.fullName,
      issue,
    };
  } catch {
    return {
      ok: false,
      status: "write_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub could not be reached right now. Try again in a moment.",
    };
  }
}

export async function listAlisioGitHubPullRequests(
  input: {
    repository: string;
    state?: "open" | "closed" | "all";
    limit?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGitHubResult> {
  const repository = normalizeGitHubRepositorySpecifier(input.repository);
  if (!repository) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub repository must be an owner/repo pair or GitHub URL.",
    };
  }
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GITHUB_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildGitHubAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const state = input.state ?? "open";
  const limit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? Math.min(Math.max(1, Math.trunc(input.limit)), 100)
      : 20;

  try {
    const result = await callGitHubApi({
      accessToken: authorization.accessToken,
      path: `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/pulls`,
      query: {
        state,
        per_page: limit,
      },
      fetchImpl,
    });
    if (!result.response.ok || !Array.isArray(result.body)) {
      const reconnectRequired = isGitHubReconnectRequired(result.response.status, result.body);
      const apiMessage = extractGitHubApiMessage(
        result.body,
        "GitHub rejected the pull request list request.",
      );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: GITHUB_CONNECTOR_ID,
        message: reconnectRequired
          ? "GitHub authorization is no longer valid. Reconnect GitHub in Apps."
          : apiMessage,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        apiMessage,
      };
    }
    return {
      ok: true,
      status: "pulls_listed",
      connectorId: GITHUB_CONNECTOR_ID,
      repository: repository.fullName,
      pullRequests: result.body.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const pullRequest = normalizeGitHubPullRequest(entry as Record<string, unknown>);
        return pullRequest ? [pullRequest] : [];
      }),
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub could not be reached right now. Try again in a moment.",
    };
  }
}

export async function readAlisioGitHubFile(
  input: {
    repository: string;
    path?: string;
    ref?: string;
    maxChars?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<AlisioGitHubResult> {
  const target = normalizeGitHubFileTarget(input);
  if (!target) {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub file reads need an owner/repo plus file path, or a GitHub blob URL.",
    };
  }
  const authorization = await resolveAlisioConnectorRuntimeAccess(
    [GITHUB_CONNECTOR_ID],
    env,
    fetchImpl,
  );
  if (!authorization.accessToken) {
    return buildGitHubAuthError({ reconnectRequired: authorization.reconnectRequired });
  }

  const maxChars =
    typeof input.maxChars === "number" && Number.isFinite(input.maxChars)
      ? Math.max(1, Math.trunc(input.maxChars))
      : 20000;
  const endpoint = `/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.name)}/contents/${encodeGitHubPath(target.path)}`;

  try {
    const metadataResult = await callGitHubApi({
      accessToken: authorization.accessToken,
      path: endpoint,
      query: target.ref ? { ref: target.ref } : undefined,
      fetchImpl,
    });
    if (
      !metadataResult.response.ok ||
      !metadataResult.body ||
      typeof metadataResult.body !== "object"
    ) {
      const reconnectRequired = isGitHubReconnectRequired(
        metadataResult.response.status,
        metadataResult.body,
      );
      const apiMessage = extractGitHubApiMessage(
        metadataResult.body,
        "GitHub rejected the file read request.",
      );
      return {
        ok: false,
        status: reconnectRequired ? "auth_required" : "read_failed",
        connectorId: GITHUB_CONNECTOR_ID,
        message: reconnectRequired
          ? "GitHub authorization is no longer valid. Reconnect GitHub in Apps."
          : apiMessage,
        ...(reconnectRequired ? { reconnectRequired: true } : {}),
        apiMessage,
      };
    }
    if (Array.isArray(metadataResult.body)) {
      return {
        ok: false,
        status: "read_failed",
        connectorId: GITHUB_CONNECTOR_ID,
        message: "GitHub path points to a directory. Pass a file path instead.",
      };
    }
    const metadata = metadataResult.body as Record<string, unknown>;
    if (readOptionalTrimmedString(metadata.type) !== "file") {
      return {
        ok: false,
        status: "read_failed",
        connectorId: GITHUB_CONNECTOR_ID,
        message: "GitHub path does not point to a file.",
      };
    }
    const inlineContent = readOptionalTrimmedString(metadata.content);
    const encoding = readOptionalTrimmedString(metadata.encoding);
    let text: string | null = null;
    if (encoding === "base64" && inlineContent) {
      text = Buffer.from(inlineContent.replace(/\n/g, ""), "base64").toString("utf8");
    } else {
      const rawResult = await callGitHubApi({
        accessToken: authorization.accessToken,
        path: endpoint,
        query: target.ref ? { ref: target.ref } : undefined,
        accept: "application/vnd.github.raw",
        fetchImpl,
      });
      if (!rawResult.response.ok || typeof rawResult.body !== "string") {
        const reconnectRequired = isGitHubReconnectRequired(
          rawResult.response.status,
          rawResult.body,
        );
        const apiMessage = extractGitHubApiMessage(
          rawResult.body,
          "GitHub rejected the raw file download request.",
        );
        return {
          ok: false,
          status: reconnectRequired ? "auth_required" : "read_failed",
          connectorId: GITHUB_CONNECTOR_ID,
          message: reconnectRequired
            ? "GitHub authorization is no longer valid. Reconnect GitHub in Apps."
            : apiMessage,
          ...(reconnectRequired ? { reconnectRequired: true } : {}),
          apiMessage,
        };
      }
      text = rawResult.body;
    }

    const normalized = normalizeGitHubText(text ?? "", maxChars);
    const size = readOptionalFiniteNumber(metadata.size);
    const sha = readOptionalTrimmedString(metadata.sha);
    const htmlUrl =
      readOptionalTrimmedString(metadata.html_url) ??
      `${target.url}/blob/${encodeURIComponent(target.ref ?? "HEAD")}/${target.path}`;
    return {
      ok: true,
      status: "file_read",
      connectorId: GITHUB_CONNECTOR_ID,
      repository: target.fullName,
      path: target.path,
      ...(target.ref ? { ref: target.ref } : {}),
      content: normalized.content,
      truncated: normalized.truncated,
      ...(size !== undefined ? { size } : {}),
      ...(sha ? { sha } : {}),
      url: htmlUrl,
    };
  } catch {
    return {
      ok: false,
      status: "read_failed",
      connectorId: GITHUB_CONNECTOR_ID,
      message: "GitHub could not be reached right now. Try again in a moment.",
    };
  }
}
