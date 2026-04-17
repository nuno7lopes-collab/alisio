import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCliRuntimeCapture } from "./test-runtime-capture.js";

const loadConfigMock = vi.fn(() => ({}));
const resolveDefaultAgentIdMock = vi.fn(() => "main");
const resolveAgentWorkspaceDirMock = vi.fn(() => "/tmp/workspace");
const searchSkillsFromMarketplaceMock = vi.fn();
const installMarketplaceRegistrySkillMock = vi.fn();
const updateMarketplaceSkillsMock = vi.fn();
const readTrackedMarketplaceSkillSlugsMock = vi.fn();

const { defaultRuntime, runtimeLogs, runtimeErrors, resetRuntimeCapture } =
  createCliRuntimeCapture();

vi.mock("../runtime.js", () => ({
  defaultRuntime,
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveDefaultAgentId: () => resolveDefaultAgentIdMock(),
  resolveAgentWorkspaceDir: () => resolveAgentWorkspaceDirMock(),
}));

vi.mock("../agents/skills-marketplace-remote.js", () => ({
  searchSkillsFromMarketplace: (...args: unknown[]) => searchSkillsFromMarketplaceMock(...args),
  installMarketplaceRegistrySkill: (...args: unknown[]) =>
    installMarketplaceRegistrySkillMock(...args),
  updateMarketplaceSkills: (...args: unknown[]) => updateMarketplaceSkillsMock(...args),
  readTrackedMarketplaceSkillSlugs: (...args: unknown[]) =>
    readTrackedMarketplaceSkillSlugsMock(...args),
}));

const { registerSkillsCli } = await import("./skills-cli.js");

describe("skills cli commands", () => {
  const createProgram = () => {
    const program = new Command();
    program.exitOverride();
    registerSkillsCli(program);
    return program;
  };

  const runCommand = (argv: string[]) => createProgram().parseAsync(argv, { from: "user" });

  beforeEach(() => {
    resetRuntimeCapture();
    loadConfigMock.mockReset();
    resolveDefaultAgentIdMock.mockReset();
    resolveAgentWorkspaceDirMock.mockReset();
    searchSkillsFromMarketplaceMock.mockReset();
    installMarketplaceRegistrySkillMock.mockReset();
    updateMarketplaceSkillsMock.mockReset();
    readTrackedMarketplaceSkillSlugsMock.mockReset();

    loadConfigMock.mockReturnValue({});
    resolveDefaultAgentIdMock.mockReturnValue("main");
    resolveAgentWorkspaceDirMock.mockReturnValue("/tmp/workspace");
    searchSkillsFromMarketplaceMock.mockResolvedValue([]);
    installMarketplaceRegistrySkillMock.mockResolvedValue({
      ok: false,
      error: "install disabled in test",
    });
    updateMarketplaceSkillsMock.mockResolvedValue([]);
    readTrackedMarketplaceSkillSlugsMock.mockResolvedValue([]);
  });

  it("searches Local Marketplace skills from the native CLI", async () => {
    searchSkillsFromMarketplaceMock.mockResolvedValue([
      {
        slug: "calendar",
        displayName: "Calendar",
        summary: "CalDAV helpers",
        version: "1.2.3",
      },
    ]);

    await runCommand(["skills", "search", "calendar"]);

    expect(searchSkillsFromMarketplaceMock).toHaveBeenCalledWith({
      query: "calendar",
      limit: undefined,
    });
    expect(runtimeLogs.some((line) => line.includes("calendar v1.2.3  Calendar"))).toBe(true);
  });

  it("installs a skill from Local Marketplace into the active workspace", async () => {
    installMarketplaceRegistrySkillMock.mockResolvedValue({
      ok: true,
      slug: "calendar",
      version: "1.2.3",
      targetDir: "/tmp/workspace/skills/calendar",
    });

    await runCommand(["skills", "install", "calendar", "--version", "1.2.3"]);

    expect(installMarketplaceRegistrySkillMock).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
      slug: "calendar",
      version: "1.2.3",
      force: false,
      logger: expect.any(Object),
    });
    expect(
      runtimeLogs.some((line) =>
        line.includes("Installed calendar@1.2.3 -> /tmp/workspace/skills/calendar"),
      ),
    ).toBe(true);
  });

  it("updates all tracked Local Marketplace skills", async () => {
    readTrackedMarketplaceSkillSlugsMock.mockResolvedValue(["calendar"]);
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

    await runCommand(["skills", "update", "--all"]);

    expect(readTrackedMarketplaceSkillSlugsMock).toHaveBeenCalledWith("/tmp/workspace");
    expect(updateMarketplaceSkillsMock).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
      slug: undefined,
      logger: expect.any(Object),
    });
    expect(runtimeLogs.some((line) => line.includes("Updated calendar: 1.2.2 -> 1.2.3"))).toBe(
      true,
    );
    expect(runtimeErrors).toEqual([]);
  });
});
