import type { Skill } from "@mariozechner/pi-coding-agent";

type SkillSourceCompat = Skill & {
  sourceInfo?: {
    source?: string;
  };
};

const TRUSTED_MARKETPLACE_INSTALL_SOURCES = new Set([
  "alisio-bundled",
  "alisio-managed",
  "alisio-extra",
]);

export function resolveSkillSource(skill: Skill): string {
  const compatSkill = skill as SkillSourceCompat;
  const source = typeof compatSkill.source === "string" ? compatSkill.source.trim() : "";
  if (source) {
    return source;
  }
  const sourceInfo =
    typeof compatSkill.sourceInfo?.source === "string" ? compatSkill.sourceInfo.source.trim() : "";
  return sourceInfo || "unknown";
}

export function normalizeRuntimeSkillSource(source: string): string {
  const normalized = source.trim();
  return normalized || "unknown";
}

export function isBundledRuntimeSkillSource(source: string): boolean {
  return normalizeRuntimeSkillSource(source) === "alisio-bundled";
}

export function isTrustedMarketplaceInstallSource(source: string): boolean {
  return TRUSTED_MARKETPLACE_INSTALL_SOURCES.has(source);
}
