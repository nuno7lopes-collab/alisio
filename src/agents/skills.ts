import type { AlisioConfig } from "../config/config.js";
import type { SkillsInstallPreferences } from "./skills/types.js";

export {
  hasBinary,
  isBundledSkillAllowed,
  isConfigPathTruthy,
  resolveBundledAllowlist,
  resolveConfigPath,
  resolveRuntimePlatform,
  resolveSkillConfig,
} from "./skills/config.js";
export {
  applySkillEnvOverrides,
  applySkillEnvOverridesFromSnapshot,
} from "./skills/env-overrides.js";
export type {
  LegacySkillMetadata,
  SkillEligibilityContext,
  SkillAuditEntry,
  SkillCommandSpec,
  SkillCompatibilitySpec,
  SkillConsentDecision,
  SkillConsentGrant,
  SkillConsentRequest,
  SkillEntry,
  SkillInstallSpec,
  SkillManifest,
  SkillManifestIssue,
  SkillMarketplaceActionKind,
  SkillManifestValidation,
  SkillOutputsSpec,
  SkillPermissionSpec,
  SkillSubscriptionSpec,
  SkillSnapshot,
  SkillsInstallPreferences,
} from "./skills/types.js";
export {
  buildSkillMarketplaceCatalog,
  executeMarketplaceSkill,
  installMarketplaceSkill,
  removeMarketplaceSkill,
  readMarketplaceSkillInstructions,
  resolveSkillMarketplaceCatalog,
} from "./skills/marketplace.js";
export type { ResolvedSkillCatalogEntry, SkillCatalogEntry } from "./skills/marketplace.js";
export type {
  SkillMarketplaceAccess,
  SkillMarketplaceAccessContext,
} from "./skills/marketplace-access.js";
export {
  appendSkillAuditEntry,
  listSkillAuditEntries,
  listSkillConsentGrants,
  resolveMarketplaceAuditLogPath,
  resolveMarketplaceConsent,
  resolveMarketplaceConsentFingerprint,
  resolveMarketplaceConsentStorePath,
} from "./skills/marketplace-consent.js";
export {
  buildWorkspaceSkillSnapshot,
  buildWorkspaceSkillsPrompt,
  buildWorkspaceSkillCommandSpecs,
  filterWorkspaceSkillEntries,
  loadWorkspaceSkillEntries,
  resolveSkillsPromptForRun,
  syncSkillsToWorkspace,
} from "./skills/workspace.js";

export function resolveSkillsInstallPreferences(config?: AlisioConfig): SkillsInstallPreferences {
  const raw = config?.skills?.install;
  const preferBrew = raw?.preferBrew ?? true;
  const managerRaw = typeof raw?.nodeManager === "string" ? raw.nodeManager.trim() : "";
  const manager = managerRaw.toLowerCase();
  const nodeManager: SkillsInstallPreferences["nodeManager"] =
    manager === "pnpm" || manager === "yarn" || manager === "bun" || manager === "npm"
      ? manager
      : "npm";
  return { preferBrew, nodeManager };
}
