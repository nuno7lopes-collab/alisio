import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, t } from "../../i18n/index.ts";
import {
  allowBundledSkill,
  enableSkillConfigPath,
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
    ...overrides,
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
});
