import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.fn(() => ({}));
const resolveDefaultAgentIdMock = vi.fn(() => "main");
const resolveAgentWorkspaceDirMock = vi.fn(() => "/tmp/workspace");
const buildWorkspaceSkillStatusMock = vi.fn(() => ({
  workspaceDir: "/tmp/workspace",
  managedSkillsDir: "/tmp/workspace/.managed-skills",
  skills: [],
}));
const resolveWorkspaceMarketplaceCatalogStatusMock = vi.fn();
const installMarketplaceSkillMock = vi.fn();
const removeMarketplaceSkillMock = vi.fn();
const executeMarketplaceSkillMock = vi.fn();
const resolveMarketplaceConsentMock = vi.fn();
const appendSkillAuditEntryMock = vi.fn();

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
  writeConfigFile: vi.fn(),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: vi.fn(() => ["main"]),
  resolveDefaultAgentId: () => resolveDefaultAgentIdMock(),
  resolveAgentWorkspaceDir: () => resolveAgentWorkspaceDirMock(),
}));

vi.mock("../../agents/skills-status.js", () => ({
  buildWorkspaceSkillStatus: () => buildWorkspaceSkillStatusMock(),
  resolveWorkspaceMarketplaceCatalogStatus: () => resolveWorkspaceMarketplaceCatalogStatusMock(),
}));

vi.mock("../../agents/skills.js", () => ({
  appendSkillAuditEntry: (params: unknown) => appendSkillAuditEntryMock(params),
  executeMarketplaceSkill: (params: unknown) => executeMarketplaceSkillMock(params),
  installMarketplaceSkill: (params: unknown) => installMarketplaceSkillMock(params),
  loadWorkspaceSkillEntries: vi.fn(() => []),
  removeMarketplaceSkill: (params: unknown) => removeMarketplaceSkillMock(params),
  resolveMarketplaceConsent: (params: unknown) => resolveMarketplaceConsentMock(params),
}));

vi.mock("../../infra/skills-remote.js", () => ({
  getRemoteSkillEligibility: vi.fn(() => undefined),
}));

const { skillsHandlers } = await import("./skills.js");

function createMarketplaceSkill(overrides: Record<string, unknown> = {}) {
  return {
    name: "Demo Skill",
    skillKey: "demo-skill",
    kind: "local-skill",
    manifestVersion: "1.0.0",
    permissions: {
      consent: "explicit",
      sandbox: {
        mode: "isolated",
        filesystem: "read-only",
        network: "off",
      },
    },
    outputs: {
      primary: "instructions",
      formats: ["text/markdown"],
    },
    access: {
      allowed: true,
      currentPlan: "free",
      issues: [],
    },
    ...overrides,
  };
}

async function invokeHandler(
  method: keyof typeof skillsHandlers,
  params: unknown,
  client: unknown = null,
) {
  let ok: boolean | null = null;
  let response: unknown;
  let error: unknown;

  await skillsHandlers[method]({
    params: params as never,
    req: {} as never,
    client: client as never,
    isWebchatConnect: () => false,
    context: {} as never,
    respond: (success, result, err) => {
      ok = success;
      response = result;
      error = err;
    },
  });

  return { ok, response, error };
}

describe("skills gateway handlers (marketplace)", () => {
  beforeEach(() => {
    loadConfigMock.mockReset();
    resolveDefaultAgentIdMock.mockReset();
    resolveAgentWorkspaceDirMock.mockReset();
    buildWorkspaceSkillStatusMock.mockReset();
    resolveWorkspaceMarketplaceCatalogStatusMock.mockReset();
    installMarketplaceSkillMock.mockReset();
    removeMarketplaceSkillMock.mockReset();
    executeMarketplaceSkillMock.mockReset();
    resolveMarketplaceConsentMock.mockReset();
    appendSkillAuditEntryMock.mockReset();

    loadConfigMock.mockReturnValue({});
    resolveDefaultAgentIdMock.mockReturnValue("main");
    resolveAgentWorkspaceDirMock.mockReturnValue("/tmp/workspace");
    buildWorkspaceSkillStatusMock.mockReturnValue({
      workspaceDir: "/tmp/workspace",
      managedSkillsDir: "/tmp/workspace/.managed-skills",
      skills: [],
    });
  });

  it("attaches marketplaceCatalog to skills.status", async () => {
    resolveWorkspaceMarketplaceCatalogStatusMock.mockResolvedValue([
      createMarketplaceSkill({
        name: "mcp:toolbox",
        skillKey: "mcp:toolbox",
        kind: "mcp-server",
      }),
    ]);

    const result = await invokeHandler("skills.status", {});

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.response).toMatchObject({
      workspaceDir: "/tmp/workspace",
      marketplaceCatalog: [
        {
          name: "mcp:toolbox",
          skillKey: "mcp:toolbox",
          kind: "mcp-server",
        },
      ],
    });
  });

  it("returns consent-required before executing a marketplace skill", async () => {
    const skill = createMarketplaceSkill();
    resolveWorkspaceMarketplaceCatalogStatusMock.mockResolvedValue([skill]);
    resolveMarketplaceConsentMock.mockResolvedValue({
      status: "consent-required",
      fingerprint: "fp-1",
      request: {
        action: "execute",
        title: "Run Demo Skill?",
        description: "Declared permissions: sandbox=isolated/read-only/off.",
        fingerprint: "fp-1",
        permissions: skill.permissions,
        outputs: skill.outputs,
      },
    });

    const result = await invokeHandler("skills.marketplace.execute", { name: "Demo Skill" });

    expect(result.ok).toBe(true);
    expect(result.response).toMatchObject({
      status: "consent-required",
      action: "execute",
      skillName: "Demo Skill",
      request: {
        title: "Run Demo Skill?",
      },
    });
    expect(executeMarketplaceSkillMock).not.toHaveBeenCalled();
  });

  it("installs a marketplace skill after consent and appends an audit entry", async () => {
    const skill = createMarketplaceSkill({
      installable: true,
      installed: false,
    });
    resolveWorkspaceMarketplaceCatalogStatusMock.mockResolvedValue([skill]);
    resolveMarketplaceConsentMock.mockResolvedValue({
      status: "granted",
      fingerprint: "fp-2",
      decision: "allow-once",
    });
    installMarketplaceSkillMock.mockResolvedValue({
      ok: true,
      skill: {
        name: "Demo Skill",
      },
      targetDir: "/tmp/workspace/skills/demo-skill",
      access: {
        allowed: true,
        currentPlan: "free",
      },
    });

    const result = await invokeHandler(
      "skills.marketplace.install",
      { name: "Demo Skill", consentDecision: "allow-once" },
      { connect: { client: { displayName: "Tester" } } },
    );

    expect(installMarketplaceSkillMock).toHaveBeenCalledWith({
      catalogWorkspaceDir: "/tmp/workspace",
      targetWorkspaceDir: "/tmp/workspace",
      skillName: "Demo Skill",
      config: {},
      force: false,
    });
    expect(appendSkillAuditEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceDir: "/tmp/workspace",
        skillName: "Demo Skill",
        action: "install",
        outcome: "completed",
        decision: "allow-once",
        actor: "Tester",
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.response).toMatchObject({
      status: "completed",
      action: "install",
      skillName: "Demo Skill",
      targetDir: "/tmp/workspace/skills/demo-skill",
    });
  });

  it("executes an MCP marketplace skill after consent and appends an audit entry", async () => {
    const skill = createMarketplaceSkill({
      name: "mcp:toolbox",
      skillKey: "mcp:toolbox",
      kind: "mcp-server",
      outputs: {
        primary: "tool",
        formats: ["application/json"],
      },
    });
    resolveWorkspaceMarketplaceCatalogStatusMock.mockResolvedValue([skill]);
    resolveMarketplaceConsentMock.mockResolvedValue({
      status: "granted",
      fingerprint: "fp-3",
      decision: "allow-always",
    });
    executeMarketplaceSkillMock.mockResolvedValue({
      ok: true,
      skill: {
        name: "mcp:toolbox",
        kind: "mcp-server",
      },
      instructions: "Tools (1)\nPrompts (1)\nResources (1)",
      sandbox: {
        mode: "isolated",
        filesystem: "read-only",
        network: "off",
      },
      mcp: {
        serverName: "toolbox",
        toolCount: 1,
        promptCount: 1,
        resourceCount: 1,
      },
      access: {
        allowed: true,
        currentPlan: "free",
      },
    });

    const result = await invokeHandler(
      "skills.marketplace.execute",
      { name: "mcp:toolbox", consentDecision: "allow-always" },
      { connect: { client: { displayName: "Tester" } } },
    );

    expect(executeMarketplaceSkillMock).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
      skillName: "mcp:toolbox",
      consent: true,
      config: {},
    });
    expect(appendSkillAuditEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceDir: "/tmp/workspace",
        skillName: "mcp:toolbox",
        action: "execute",
        outcome: "completed",
        decision: "allow-always",
        actor: "Tester",
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.response).toMatchObject({
      status: "completed",
      action: "execute",
      skillName: "mcp:toolbox",
      mcp: {
        serverName: "toolbox",
        toolCount: 1,
      },
    });
  });
});
