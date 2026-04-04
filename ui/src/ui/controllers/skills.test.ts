import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, t } from "../../i18n/index.ts";
import { saveSkillApiKey, updateSkillEdit, type SkillsState } from "./skills.ts";

function createState(overrides: Partial<SkillsState> = {}): SkillsState {
  return {
    client: null,
    connected: true,
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
