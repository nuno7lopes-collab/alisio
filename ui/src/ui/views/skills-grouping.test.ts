import { beforeEach, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { SkillStatusEntry } from "../types.ts";
import { groupSkills } from "./skills-grouping.ts";

function createSkill(overrides: Partial<SkillStatusEntry> = {}): SkillStatusEntry {
  return {
    name: "Repo Skill",
    description: "Skill description",
    source: "\u006fpen\u0063law-workspace",
    filePath: "/tmp/skill",
    baseDir: "/tmp",
    skillKey: "repo-skill",
    bundled: false,
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
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
    ...overrides,
  };
}

describe("groupSkills", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("keeps project, personal, plugin, and extra skills out of the generic fallback group", () => {
    const groups = groupSkills([
      createSkill({ source: "agents-skills-project", skillKey: "project-skill" }),
      createSkill({ source: "agents-skills-personal", skillKey: "personal-skill" }),
      createSkill({ source: "\u006fpen\u0063law-plugin", skillKey: "plugin-skill" }),
      createSkill({ source: "\u006fpen\u0063law-extra", skillKey: "extra-skill" }),
    ]);

    expect(groups.map((group) => group.label)).toEqual([
      "Project Skills",
      "Personal Skills",
      "Plugin Skills",
      "Extra Skills",
    ]);
    expect(groups.find((group) => group.id === "other")).toBeUndefined();
  });
});
