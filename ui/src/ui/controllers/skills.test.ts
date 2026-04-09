import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, t } from "../../i18n/index.ts";
import {
  allowBundledSkill,
  executeMarketplaceSkillAction,
  enableSkillConfigPath,
  installMarketplaceSkillAction,
  resolveSkillConsentRequest,
  saveSkillApiKey,
  saveSkillEnv,
  skillEnvEditKey,
  updateSkillEdit,
  type SkillsState,
} from "./skills.ts";

function createState(overrides: Partial<SkillsState> = {}): SkillsState {
  return {
    client: null,
    connected: true,
    configFormDirty: false,
    skillsLoading: false,
    skillsReport: null,
    skillsError: null,
    skillsBusyKey: null,
    skillEdits: {},
    skillMessages: {},
    skillActionOutputs: {},
    skillConsentRequest: null,
    ...overrides,
  };
}

function createMarketplaceSkill() {
  return {
    name: "Demo Skill",
    description: "Marketplace demo",
    source: "alisio-managed",
    filePath: "/tmp/demo-skill",
    baseDir: "/tmp",
    skillKey: "demo",
    bundled: false,
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: false,
    requirements: {
      bins: [],
      anyBins: [],
      env: [],
      config: [],
      os: [],
    },
    missing: {
      bins: [],
      anyBins: [],
      env: [],
      config: [],
      os: [],
    },
    configChecks: [],
    install: [],
    manifestSource: "manifest" as const,
    manifestValid: true,
    marketplaceReady: true,
    permissions: {
      consent: "explicit" as const,
      sandbox: {
        mode: "isolated" as const,
        filesystem: "read-only" as const,
        network: "off" as const,
      },
    },
    outputs: {
      primary: "instructions" as const,
      formats: ["text/markdown"],
    },
    installable: true,
    removable: false,
    executable: true,
    installed: false,
  };
}

describe("skills controller", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("clears the edited API key after a successful save", async () => {
    const request = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      workspaceDir: "/tmp/workspace",
      managedSkillsDir: "/tmp/skills",
      skills: [],
    });
    const state = createState({
      client: {
        request,
      } as never,
      skillEdits: {
        demo: "sk-test",
      },
    });

    await saveSkillApiKey(state, "demo");

    expect(request).toHaveBeenNthCalledWith(1, "skills.update", {
      skillKey: "demo",
      apiKey: "sk-test",
    });
    expect(state.skillEdits).toEqual({});
    expect(state.skillMessages.demo).toEqual({
      kind: "success",
      message: t("alisio.capabilities.messages.saved"),
    });
  });

  it("keeps the edited API key when saving fails", async () => {
    const request = vi.fn().mockRejectedValue(new Error("save failed"));
    const state = createState({
      client: {
        request,
      } as never,
      skillEdits: {
        demo: "sk-test",
      },
    });

    await saveSkillApiKey(state, "demo");

    expect(state.skillEdits).toEqual({
      demo: "sk-test",
    });
    expect(state.skillMessages.demo).toEqual({
      kind: "error",
      message: "save failed",
    });
  });

  it("reports remaining setup when saving still leaves blockers", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/skills",
        skills: [
          {
            skillKey: "demo",
            eligible: false,
          },
        ],
      });
    const state = createState({
      client: {
        request,
      } as never,
      skillEdits: {
        demo: "sk-test",
      },
    });

    await saveSkillApiKey(state, "demo");

    expect(state.skillMessages.demo).toEqual({
      kind: "success",
      message: t("alisio.capabilities.messages.savedPartial"),
    });
  });

  it("saves generic env values through skills.update.env", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/skills",
        skills: [
          {
            skillKey: "demo",
            eligible: true,
          },
        ],
      });
    const envKey = skillEnvEditKey("demo", "TRELLO_TOKEN");
    const state = createState({
      client: {
        request,
      } as never,
      skillEdits: {
        [envKey]: "token-123",
      },
    });

    await saveSkillEnv(state, "demo", "TRELLO_TOKEN");

    expect(request).toHaveBeenNthCalledWith(1, "skills.update", {
      skillKey: "demo",
      env: {
        TRELLO_TOKEN: "token-123",
      },
    });
    expect(state.skillEdits).toEqual({});
    expect(state.skillMessages.demo).toEqual({
      kind: "success",
      message: t("alisio.capabilities.messages.saved"),
    });
  });

  it("enables simple config paths through config.patch", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        hash: "cfg-1",
        config: {},
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/skills",
        skills: [
          {
            skillKey: "demo",
            eligible: true,
          },
        ],
      });
    const state = createState({
      client: {
        request,
      } as never,
    });

    await enableSkillConfigPath(state, "demo", "plugins.entries.voice-call.enabled");

    expect(request).toHaveBeenNthCalledWith(1, "config.get", {});
    expect(request).toHaveBeenNthCalledWith(2, "config.patch", {
      raw: JSON.stringify({
        plugins: {
          entries: {
            "voice-call": {
              enabled: true,
            },
          },
        },
      }),
      baseHash: "cfg-1",
    });
    expect(state.skillMessages.demo).toEqual({
      kind: "success",
      message: t("alisio.capabilities.messages.updated"),
    });
  });

  it("allows bundled skills by patching skills.allowBundled", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        hash: "cfg-1",
        config: {
          skills: {
            allowBundled: ["peekaboo"],
          },
        },
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/skills",
        skills: [
          {
            skillKey: "github",
            eligible: true,
          },
        ],
      });
    const state = createState({
      client: {
        request,
      } as never,
    });

    await allowBundledSkill(state, "github");

    expect(request).toHaveBeenNthCalledWith(2, "config.patch", {
      raw: JSON.stringify({
        skills: {
          allowBundled: ["peekaboo", "github"],
        },
      }),
      baseHash: "cfg-1",
    });
    expect(state.skillMessages.github).toEqual({
      kind: "success",
      message: t("alisio.capabilities.messages.updated"),
    });
  });

  it("blocks config patches while there is a dirty config draft", async () => {
    const request = vi.fn();
    const state = createState({
      configFormDirty: true,
      client: {
        request,
      } as never,
    });

    await enableSkillConfigPath(state, "demo", "plugins.entries.voice-call.enabled");

    expect(request).not.toHaveBeenCalled();
    expect(state.skillMessages.demo).toEqual({
      kind: "error",
      message: t("alisio.capabilities.messages.configDraftDirty"),
    });
  });

  it("blocks allowlist changes while there is a dirty config draft", async () => {
    const request = vi.fn();
    const state = createState({
      configFormDirty: true,
      client: {
        request,
      } as never,
    });

    await allowBundledSkill(state, "demo");

    expect(request).not.toHaveBeenCalled();
    expect(state.skillMessages.demo).toEqual({
      kind: "error",
      message: t("alisio.capabilities.messages.configDraftDirty"),
    });
  });

  it("clears stale per-skill messages when the user edits the field again", () => {
    const state = createState({
      skillMessages: {
        demo: {
          kind: "error",
          message: "old error",
        },
      },
    });

    updateSkillEdit(state, "demo", "next");

    expect(state.skillEdits).toEqual({
      demo: "next",
    });
    expect(state.skillMessages).toEqual({});
  });

  it("stores a marketplace consent request when execution needs approval", async () => {
    const request = vi.fn().mockResolvedValue({
      status: "consent-required",
      action: "execute",
      skillName: "Demo Skill",
      request: {
        title: "Run Demo Skill?",
        description: "Declared permissions: sandbox=isolated/read-only/off.",
        permissions: createMarketplaceSkill().permissions,
        outputs: createMarketplaceSkill().outputs,
      },
    });
    const state = createState({
      client: {
        request,
      } as never,
      skillsReport: {
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/skills",
        skills: [],
        marketplaceCatalog: [createMarketplaceSkill()],
      },
    });

    await executeMarketplaceSkillAction(state, "demo");

    expect(request).toHaveBeenCalledWith("skills.marketplace.execute", {
      name: "Demo Skill",
    });
    expect(state.skillConsentRequest).toMatchObject({
      skillKey: "demo",
      skillName: "Demo Skill",
      action: "execute",
      title: "Run Demo Skill?",
    });
  });

  it("replays a consent decision and stores marketplace execution output", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        action: "execute",
        skillName: "Demo Skill",
        message: "Loaded Demo Skill.",
        instructions: "# Demo Skill\n\nDo the thing.",
      })
      .mockResolvedValueOnce({
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/skills",
        skills: [],
        marketplaceCatalog: [createMarketplaceSkill()],
      });
    const state = createState({
      client: {
        request,
      } as never,
      skillsReport: {
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/skills",
        skills: [],
        marketplaceCatalog: [createMarketplaceSkill()],
      },
      skillConsentRequest: {
        skillKey: "demo",
        skillName: "Demo Skill",
        action: "execute",
        title: "Run Demo Skill?",
        description: "Declared permissions: sandbox=isolated/read-only/off.",
      },
    });

    await resolveSkillConsentRequest(state, "allow-always");

    expect(request).toHaveBeenNthCalledWith(1, "skills.marketplace.execute", {
      name: "Demo Skill",
      consentDecision: "allow-always",
    });
    expect(request).toHaveBeenNthCalledWith(2, "skills.status", {});
    expect(state.skillConsentRequest).toBeNull();
    expect(state.skillActionOutputs.demo).toEqual({
      title: "Demo Skill",
      text: "# Demo Skill\n\nDo the thing.",
    });
    expect(state.skillMessages.demo).toEqual({
      kind: "success",
      message: "Loaded Demo Skill.",
    });
  });

  it("runs marketplace install and refreshes skill status", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        status: "completed",
        action: "install",
        skillName: "Demo Skill",
        message: "Installed Demo Skill.",
      })
      .mockResolvedValueOnce({
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/skills",
        skills: [],
        marketplaceCatalog: [
          {
            ...createMarketplaceSkill(),
            installed: true,
            installable: false,
            removable: true,
            eligible: true,
          },
        ],
      });
    const state = createState({
      client: {
        request,
      } as never,
      skillsReport: {
        workspaceDir: "/tmp/workspace",
        managedSkillsDir: "/tmp/skills",
        skills: [],
        marketplaceCatalog: [createMarketplaceSkill()],
      },
    });

    await installMarketplaceSkillAction(state, "demo");

    expect(request).toHaveBeenNthCalledWith(1, "skills.marketplace.install", {
      name: "Demo Skill",
    });
    expect(request).toHaveBeenNthCalledWith(2, "skills.status", {});
    expect(state.skillMessages.demo).toEqual({
      kind: "success",
      message: "Installed Demo Skill.",
    });
  });
});
