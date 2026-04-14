import type { SkillStatusEntry, SkillStatusReport } from "./types.ts";

function skillReportEntryKey(skill: Pick<SkillStatusEntry, "skillKey" | "name">): string {
  const skillKey = skill.skillKey.trim();
  if (skillKey.length > 0) {
    return skillKey;
  }
  return skill.name.trim().toLowerCase();
}

export function mergeSkillStatusEntries(
  report: SkillStatusReport | null | undefined,
): SkillStatusEntry[] {
  if (!report) {
    return [];
  }

  const order: string[] = [];
  const merged = new Map<string, SkillStatusEntry>();

  const upsert = (skill: SkillStatusEntry) => {
    const key = skillReportEntryKey(skill);
    if (!merged.has(key)) {
      order.push(key);
    }
    merged.set(key, skill);
  };

  for (const skill of report.skills ?? []) {
    upsert(skill);
  }
  for (const skill of report.marketplaceCatalog ?? []) {
    upsert(skill);
  }

  return order
    .map((key) => merged.get(key))
    .filter((skill): skill is SkillStatusEntry => skill != null);
}
