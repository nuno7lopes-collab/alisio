import type { Skill } from "@mariozechner/pi-coding-agent";

type SkillSourceCompat = Skill & {
  sourceInfo?: {
    source?: string;
  };
};

const RUNTIME_SKILL_SOURCE_ALIASES = new Map<string, string>([
  ["openclaw-bundled", "alisio-bundled"],
  ["openclaw-extra", "alisio-extra"],
  ["openclaw-managed", "alisio-managed"],
  ["openclaw-workspace", "alisio-workspace"],
]);

const TRUSTED_MARKETPLACE_INSTALL_SOURCES = new Set([
  "openclaw-bundled",
  "openclaw-managed",
  "openclaw-extra",
]);

export function resolveSkillSource(skill: Skill): string {
  const compatSkill = skill as SkillSourceCompat;
  const canonical = typeof compatSkill.source === "string" ? compatSkill.source.trim() : "";
  if (canonical) {
    return canonical;
  }
  const legacy =
    typeof compatSkill.sourceInfo?.source === "string" ? compatSkill.sourceInfo.source.trim() : "";
  return legacy || "unknown";
}

export function normalizeRuntimeSkillSource(source: string): string {
  return RUNTIME_SKILL_SOURCE_ALIASES.get(source) ?? source;
}

export function isBundledRuntimeSkillSource(source: string): boolean {
  return normalizeRuntimeSkillSource(source) === "alisio-bundled";
}

export function isTrustedMarketplaceInstallSource(source: string): boolean {
  return TRUSTED_MARKETPLACE_INSTALL_SOURCES.has(source);
}
