import { Type } from "@sinclair/typebox";
import {
  createAlisioGitHubIssue,
  getAlisioGitHubProfile,
  listAlisioGitHubIssues,
  listAlisioGitHubPullRequests,
  listAlisioGitHubRepositories,
  readAlisioGitHubFile,
  readAlisioGitHubRepository,
} from "../../infra/alisio-github.js";
import {
  payloadTextResult,
  readNumberParam,
  readStringParam,
  type AnyAgentTool,
  ToolInputError,
} from "./common.js";

const GitHubToolSchema = Type.Object({
  action: Type.String({
    description:
      'Action to run: "profile", "list_repos", "repo", "list_issues", "create_issue", "list_pulls", or "read_file".',
  }),
  repository: Type.Optional(
    Type.String({
      description: 'GitHub repository as "owner/repo" or a GitHub URL.',
    }),
  ),
  visibility: Type.Optional(
    Type.String({
      description:
        'Optional repository visibility for action="list_repos": "all", "public", "private", or "internal".',
    }),
  ),
  state: Type.Optional(
    Type.String({
      description:
        'Optional state for action="list_issues" or action="list_pulls": "open", "closed", or "all".',
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description:
        'Maximum items to return for action="list_repos", "list_issues", or "list_pulls". Defaults to 20.',
    }),
  ),
  title: Type.Optional(
    Type.String({
      description: 'Issue title for action="create_issue".',
    }),
  ),
  body: Type.Optional(
    Type.String({
      description: 'Optional issue body for action="create_issue".',
    }),
  ),
  path: Type.Optional(
    Type.String({
      description: 'Repository file path, raw URL, or blob URL for action="read_file".',
    }),
  ),
  ref: Type.Optional(
    Type.String({
      description: 'Optional branch, tag, or commit ref for action="read_file".',
    }),
  ),
  maxChars: Type.Optional(
    Type.Number({
      description: 'Maximum characters to return for action="read_file". Defaults to 20000.',
    }),
  ),
});

function readGitHubState(
  params: Record<string, unknown>,
  key: string,
): "open" | "closed" | "all" | undefined {
  const value = readStringParam(params, key);
  if (!value) {
    return undefined;
  }
  if (value === "open" || value === "closed" || value === "all") {
    return value;
  }
  throw new ToolInputError(`${key} must be "open", "closed", or "all"`);
}

function readGitHubVisibility(
  params: Record<string, unknown>,
): "all" | "public" | "private" | "internal" | undefined {
  const value = readStringParam(params, "visibility");
  if (!value) {
    return undefined;
  }
  if (value === "all" || value === "public" || value === "private" || value === "internal") {
    return value;
  }
  throw new ToolInputError('visibility must be "all", "public", "private", or "internal"');
}

export function createGitHubTool(): AnyAgentTool {
  return {
    label: "GitHub",
    name: "github",
    ownerOnly: true,
    displaySummary:
      "Inspect repositories, issues, pull requests, and files through the connected GitHub app.",
    description:
      "Inspect repositories, issues, pull requests, and files through the connected GitHub app. Prefer this over browser automation for GitHub work.",
    parameters: GitHubToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "profile") {
        return payloadTextResult(await getAlisioGitHubProfile());
      }
      if (action === "list_repos") {
        const limit = readNumberParam(params, "limit", {
          integer: true,
          strict: true,
        });
        if (limit !== undefined && limit <= 0) {
          throw new ToolInputError("limit must be greater than 0");
        }
        return payloadTextResult(
          await listAlisioGitHubRepositories({
            ...(readGitHubVisibility(params) ? { visibility: readGitHubVisibility(params) } : {}),
            ...(limit !== undefined ? { limit } : {}),
          }),
        );
      }
      if (action === "repo") {
        const repository = readStringParam(params, "repository", {
          required: true,
          label: "repository",
        });
        return payloadTextResult(await readAlisioGitHubRepository({ repository }));
      }
      if (action === "list_issues") {
        const repository = readStringParam(params, "repository", {
          required: true,
          label: "repository",
        });
        const state = readGitHubState(params, "state");
        const limit = readNumberParam(params, "limit", {
          integer: true,
          strict: true,
        });
        if (limit !== undefined && limit <= 0) {
          throw new ToolInputError("limit must be greater than 0");
        }
        return payloadTextResult(
          await listAlisioGitHubIssues({
            repository,
            ...(state ? { state } : {}),
            ...(limit !== undefined ? { limit } : {}),
          }),
        );
      }
      if (action === "create_issue") {
        const repository = readStringParam(params, "repository", {
          required: true,
          label: "repository",
        });
        const title = readStringParam(params, "title", {
          required: true,
          label: "title",
        });
        const body = readStringParam(params, "body", {
          trim: false,
          allowEmpty: true,
        });
        return payloadTextResult(
          await createAlisioGitHubIssue({
            repository,
            title,
            ...(body !== undefined ? { body } : {}),
          }),
        );
      }
      if (action === "list_pulls") {
        const repository = readStringParam(params, "repository", {
          required: true,
          label: "repository",
        });
        const state = readGitHubState(params, "state");
        const limit = readNumberParam(params, "limit", {
          integer: true,
          strict: true,
        });
        if (limit !== undefined && limit <= 0) {
          throw new ToolInputError("limit must be greater than 0");
        }
        return payloadTextResult(
          await listAlisioGitHubPullRequests({
            repository,
            ...(state ? { state } : {}),
            ...(limit !== undefined ? { limit } : {}),
          }),
        );
      }
      if (action === "read_file") {
        const repository = readStringParam(params, "repository", {
          required: true,
          label: "repository",
        });
        const path = readStringParam(params, "path", {
          trim: false,
          allowEmpty: true,
        });
        const ref = readStringParam(params, "ref");
        const maxChars = readNumberParam(params, "maxChars", {
          integer: true,
          strict: true,
        });
        if (maxChars !== undefined && maxChars <= 0) {
          throw new ToolInputError("maxChars must be greater than 0");
        }
        return payloadTextResult(
          await readAlisioGitHubFile({
            repository,
            ...(path !== undefined ? { path } : {}),
            ...(ref ? { ref } : {}),
            ...(maxChars !== undefined ? { maxChars } : {}),
          }),
        );
      }
      throw new ToolInputError(
        'action must be "profile", "list_repos", "repo", "list_issues", "create_issue", "list_pulls", or "read_file"',
      );
    },
  };
}
