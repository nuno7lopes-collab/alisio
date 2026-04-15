import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createAlisioGitHubIssueMock,
  getAlisioGitHubProfileMock,
  listAlisioGitHubIssuesMock,
  listAlisioGitHubPullRequestsMock,
  listAlisioGitHubRepositoriesMock,
  readAlisioGitHubFileMock,
  readAlisioGitHubRepositoryMock,
} = vi.hoisted(() => ({
  createAlisioGitHubIssueMock: vi.fn(),
  getAlisioGitHubProfileMock: vi.fn(),
  listAlisioGitHubIssuesMock: vi.fn(),
  listAlisioGitHubPullRequestsMock: vi.fn(),
  listAlisioGitHubRepositoriesMock: vi.fn(),
  readAlisioGitHubFileMock: vi.fn(),
  readAlisioGitHubRepositoryMock: vi.fn(),
}));

vi.mock("../../infra/alisio-github.js", () => ({
  createAlisioGitHubIssue: createAlisioGitHubIssueMock,
  getAlisioGitHubProfile: getAlisioGitHubProfileMock,
  listAlisioGitHubIssues: listAlisioGitHubIssuesMock,
  listAlisioGitHubPullRequests: listAlisioGitHubPullRequestsMock,
  listAlisioGitHubRepositories: listAlisioGitHubRepositoriesMock,
  readAlisioGitHubFile: readAlisioGitHubFileMock,
  readAlisioGitHubRepository: readAlisioGitHubRepositoryMock,
}));

describe("createGitHubTool", () => {
  beforeEach(() => {
    vi.resetModules();
    createAlisioGitHubIssueMock.mockReset();
    getAlisioGitHubProfileMock.mockReset();
    listAlisioGitHubIssuesMock.mockReset();
    listAlisioGitHubPullRequestsMock.mockReset();
    listAlisioGitHubRepositoriesMock.mockReset();
    readAlisioGitHubFileMock.mockReset();
    readAlisioGitHubRepositoryMock.mockReset();
  });

  it("reads the connected profile", async () => {
    const { createGitHubTool } = await import("./github-tool.js");
    getAlisioGitHubProfileMock.mockResolvedValue({
      ok: true,
      status: "profile",
      connectorId: "github",
      profile: { login: "nuno", url: "https://github.com/nuno" },
    });

    const result = await createGitHubTool().execute?.("tool-1", { action: "profile" });

    expect(getAlisioGitHubProfileMock).toHaveBeenCalledWith();
    expect(result?.details).toMatchObject({
      status: "profile",
      connectorId: "github",
    });
  });

  it("lists repositories", async () => {
    const { createGitHubTool } = await import("./github-tool.js");
    listAlisioGitHubRepositoriesMock.mockResolvedValue({
      ok: true,
      status: "repos_listed",
      connectorId: "github",
      repositories: [],
    });

    const result = await createGitHubTool().execute?.("tool-1", {
      action: "list_repos",
      visibility: "private",
      limit: 5,
    });

    expect(listAlisioGitHubRepositoriesMock).toHaveBeenCalledWith({
      visibility: "private",
      limit: 5,
    });
    expect(result?.details).toMatchObject({
      status: "repos_listed",
      connectorId: "github",
    });
  });

  it("reads repository metadata", async () => {
    const { createGitHubTool } = await import("./github-tool.js");
    readAlisioGitHubRepositoryMock.mockResolvedValue({
      ok: true,
      status: "repo",
      connectorId: "github",
      repository: {
        owner: "nuno",
        name: "alisio",
        fullName: "nuno/alisio",
        private: false,
        url: "https://github.com/nuno/alisio",
      },
    });

    const result = await createGitHubTool().execute?.("tool-1", {
      action: "repo",
      repository: "nuno/alisio",
    });

    expect(readAlisioGitHubRepositoryMock).toHaveBeenCalledWith({
      repository: "nuno/alisio",
    });
    expect(result?.details).toMatchObject({
      status: "repo",
      connectorId: "github",
    });
  });

  it("lists issues", async () => {
    const { createGitHubTool } = await import("./github-tool.js");
    listAlisioGitHubIssuesMock.mockResolvedValue({
      ok: true,
      status: "issues_listed",
      connectorId: "github",
      repository: "nuno/alisio",
      issues: [],
    });

    const result = await createGitHubTool().execute?.("tool-1", {
      action: "list_issues",
      repository: "nuno/alisio",
      state: "all",
      limit: 12,
    });

    expect(listAlisioGitHubIssuesMock).toHaveBeenCalledWith({
      repository: "nuno/alisio",
      state: "all",
      limit: 12,
    });
    expect(result?.details).toMatchObject({
      status: "issues_listed",
      connectorId: "github",
    });
  });

  it("creates issues", async () => {
    const { createGitHubTool } = await import("./github-tool.js");
    createAlisioGitHubIssueMock.mockResolvedValue({
      ok: true,
      status: "issue_created",
      connectorId: "github",
      repository: "nuno/alisio",
      issue: {
        number: 77,
        title: "Investigate",
        state: "open",
        url: "https://github.com/nuno/alisio/issues/77",
        labels: [],
      },
    });

    const result = await createGitHubTool().execute?.("tool-1", {
      action: "create_issue",
      repository: "nuno/alisio",
      title: "Investigate",
      body: "Details",
    });

    expect(createAlisioGitHubIssueMock).toHaveBeenCalledWith({
      repository: "nuno/alisio",
      title: "Investigate",
      body: "Details",
    });
    expect(result?.details).toMatchObject({
      status: "issue_created",
      connectorId: "github",
    });
  });

  it("lists pull requests", async () => {
    const { createGitHubTool } = await import("./github-tool.js");
    listAlisioGitHubPullRequestsMock.mockResolvedValue({
      ok: true,
      status: "pulls_listed",
      connectorId: "github",
      repository: "nuno/alisio",
      pullRequests: [],
    });

    const result = await createGitHubTool().execute?.("tool-1", {
      action: "list_pulls",
      repository: "nuno/alisio",
      state: "closed",
      limit: 3,
    });

    expect(listAlisioGitHubPullRequestsMock).toHaveBeenCalledWith({
      repository: "nuno/alisio",
      state: "closed",
      limit: 3,
    });
    expect(result?.details).toMatchObject({
      status: "pulls_listed",
      connectorId: "github",
    });
  });

  it("reads repository files", async () => {
    const { createGitHubTool } = await import("./github-tool.js");
    readAlisioGitHubFileMock.mockResolvedValue({
      ok: true,
      status: "file_read",
      connectorId: "github",
      repository: "nuno/alisio",
      path: "README.md",
      content: "Hello",
      truncated: false,
      url: "https://github.com/nuno/alisio/blob/main/README.md",
    });

    const result = await createGitHubTool().execute?.("tool-1", {
      action: "read_file",
      repository: "nuno/alisio",
      path: "README.md",
      ref: "main",
      maxChars: 99,
    });

    expect(readAlisioGitHubFileMock).toHaveBeenCalledWith({
      repository: "nuno/alisio",
      path: "README.md",
      ref: "main",
      maxChars: 99,
    });
    expect(result?.details).toMatchObject({
      status: "file_read",
      connectorId: "github",
    });
  });
});
