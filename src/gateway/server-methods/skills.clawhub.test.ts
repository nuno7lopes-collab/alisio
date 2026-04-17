import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.fn(() => ({}));
const resolveDefaultAgentIdMock = vi.fn(() => "main");
const resolveAgentWorkspaceDirMock = vi.fn(() => "/tmp/workspace");
const installMarketplaceRegistrySkillMock = vi.fn();
const updateMarketplaceSkillsMock = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
  writeConfigFile: vi.fn(),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: vi.fn(() => ["main"]),
  resolveDefaultAgentId: () => resolveDefaultAgentIdMock(),
  resolveAgentWorkspaceDir: () => resolveAgentWorkspaceDirMock(),
}));

vi.mock("../../agents/skills-marketplace-remote.js", () => ({
  installMarketplaceRegistrySkill: (...args: unknown[]) =>
    installMarketplaceRegistrySkillMock(...args),
  updateMarketplaceSkills: (...args: unknown[]) => updateMarketplaceSkillsMock(...args),
}));

const { skillsHandlers } = await import("./skills.js");

describe("skills gateway handlers (marketplace)", () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
    resolveDefaultAgentIdMock.mockReset();
    resolveAgentWorkspaceDirMock.mockReset();
    installMarketplaceRegistrySkillMock.mockReset();
    updateMarketplaceSkillsMock.mockReset();

    loadConfigMock.mockReturnValue({});
    resolveDefaultAgentIdMock.mockReturnValue("main");
    resolveAgentWorkspaceDirMock.mockReturnValue("/tmp/workspace");
  });

  it("installs a Local Marketplace skill through skills.install", async () => {
    installMarketplaceRegistrySkillMock.mockResolvedValue({
      ok: true,
      slug: "calendar",
      version: "1.2.3",
      targetDir: "/tmp/workspace/skills/calendar",
    });

    let ok: boolean | null = null;
    let response: unknown;
    let error: unknown;
    await skillsHandlers["skills.install"]({
      params: {
        source: "clawhub",
        slug: "calendar",
        version: "1.2.3",
      },
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: {} as never,
      respond: (success, result, err) => {
        ok = success;
        response = result;
        error = err;
      },
    });

    expect(installMarketplaceRegistrySkillMock).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
      slug: "calendar",
      version: "1.2.3",
      force: false,
    });
    expect(ok).toBe(true);
    expect(error).toBeUndefined();
    expect(response).toMatchObject({
      ok: true,
      message: "Installed calendar@1.2.3",
      slug: "calendar",
      version: "1.2.3",
    });
  });

  it("updates Local Marketplace skills through skills.update", async () => {
    updateMarketplaceSkillsMock.mockResolvedValue([
      {
        ok: true,
        slug: "calendar",
        previousVersion: "1.2.2",
        version: "1.2.3",
        changed: true,
        targetDir: "/tmp/workspace/skills/calendar",
      },
    ]);

    let ok: boolean | null = null;
    let response: unknown;
    let error: unknown;
    await skillsHandlers["skills.update"]({
      params: {
        source: "clawhub",
        slug: "calendar",
      },
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: {} as never,
      respond: (success, result, err) => {
        ok = success;
        response = result;
        error = err;
      },
    });

    expect(updateMarketplaceSkillsMock).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
      slug: "calendar",
    });
    expect(ok).toBe(true);
    expect(error).toBeUndefined();
    expect(response).toMatchObject({
      ok: true,
      skillKey: "calendar",
      config: {
        source: "clawhub",
        results: [
          {
            ok: true,
            slug: "calendar",
            version: "1.2.3",
          },
        ],
      },
    });
  });

  it("rejects marketplace skills.update requests without slug or all", async () => {
    let ok: boolean | null = null;
    let error: { code?: string; message?: string } | undefined;
    await skillsHandlers["skills.update"]({
      params: {
        source: "clawhub",
      },
      req: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
      context: {} as never,
      respond: (success, _result, err) => {
        ok = success;
        error = err as { code?: string; message?: string } | undefined;
      },
    });

    expect(ok).toBe(false);
    expect(error?.message).toContain('requires "slug" or "all"');
    expect(updateMarketplaceSkillsMock).not.toHaveBeenCalled();
  });
});
