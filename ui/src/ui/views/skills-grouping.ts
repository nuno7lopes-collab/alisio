import { legacySkillSources } from "../../brand-compat.ts";
import { t } from "../../i18n/index.ts";
import type { SkillStatusEntry } from "../types.ts";

export type SkillGroup = {
  id: string;
  label: string;
  skills: SkillStatusEntry[];
};

const SKILL_SOURCE_GROUPS: Array<{ id: string; labelKey: string; sources: string[] }> = [
  {
    id: "project",
    labelKey: "alisio.capabilities.groups.project",
    sources: ["agents-skills-project"],
  },
  {
    id: "workspace",
    labelKey: "alisio.capabilities.groups.workspace",
    sources: [legacySkillSources.workspace],
  },
  {
    id: "personal",
    labelKey: "alisio.capabilities.groups.personal",
    sources: ["agents-skills-personal"],
  },
  {
    id: "built-in",
    labelKey: "alisio.capabilities.groups.builtIn",
    sources: [legacySkillSources.bundled],
  },
  {
    id: "installed",
    labelKey: "alisio.capabilities.groups.installed",
    sources: [legacySkillSources.managed],
  },
  {
    id: "plugins",
    labelKey: "alisio.capabilities.groups.plugins",
    sources: [legacySkillSources.plugin],
  },
  {
    id: "extra",
    labelKey: "alisio.capabilities.groups.extra",
    sources: [legacySkillSources.extra],
  },
];

export function groupSkills(skills: SkillStatusEntry[]): SkillGroup[] {
  const groups = new Map<string, SkillGroup>();
  for (const def of SKILL_SOURCE_GROUPS) {
    groups.set(def.id, { id: def.id, label: t(def.labelKey), skills: [] });
  }
  const builtInGroup = SKILL_SOURCE_GROUPS.find((group) => group.id === "built-in");
  const other: SkillGroup = {
    id: "other",
    label: t("alisio.capabilities.groups.other"),
    skills: [],
  };
  for (const skill of skills) {
    const match = skill.bundled
      ? builtInGroup
      : SKILL_SOURCE_GROUPS.find((group) => group.sources.includes(skill.source));
    if (match) {
      groups.get(match.id)?.skills.push(skill);
    } else {
      other.skills.push(skill);
    }
  }
  const ordered = SKILL_SOURCE_GROUPS.map((group) => groups.get(group.id)).filter(
    (group): group is SkillGroup => Boolean(group && group.skills.length > 0),
  );
  if (other.skills.length > 0) {
    ordered.push(other);
  }
  return ordered;
}
