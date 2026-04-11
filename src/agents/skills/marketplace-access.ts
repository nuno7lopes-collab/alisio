import { resolveCurrentAlisioPlan } from "../../infra/alisio-store.js";
import { ALISIO_PLAN_VALUES, type AlisioPlan } from "../../shared/alisio-billing.js";
import { parseBooleanValue } from "../../utils/boolean.js";
import type { SkillSubscriptionSpec } from "./types.js";

export type SkillMarketplaceAccessContext = {
  currentPlan?: AlisioPlan;
  enabledFeatureFlags?: Iterable<string>;
  env?: NodeJS.ProcessEnv;
};

export type SkillMarketplaceAccessIssueCode =
  | "subscription_plan_required"
  | "unsupported_subscription_plan"
  | "feature_flag_required";

export type SkillMarketplaceAccessIssue = {
  code: SkillMarketplaceAccessIssueCode;
  message: string;
};

export type SkillMarketplaceAccess = {
  allowed: boolean;
  required: boolean;
  currentPlan: AlisioPlan;
  plan?: string;
  featureFlag?: string;
  enabledFeatureFlags: string[];
  issues: SkillMarketplaceAccessIssue[];
};

type ResolvedMarketplaceAccessContext = {
  currentPlan: AlisioPlan;
  enabledFeatureFlags: Set<string>;
};

function normalizeFeatureFlag(flag: string): string {
  return flag.trim().toLowerCase();
}

function normalizeFeatureFlagEnvSuffix(flag: string): string {
  return flag
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

function addFeatureFlags(target: Set<string>, raw: string | undefined) {
  for (const value of raw?.split(",") ?? []) {
    const normalized = normalizeFeatureFlag(value);
    if (normalized) {
      target.add(normalized);
    }
  }
}

export function resolveEnabledMarketplaceFeatureFlags(
  params?: Pick<SkillMarketplaceAccessContext, "enabledFeatureFlags" | "env">,
): Set<string> {
  const resolved = new Set<string>();
  for (const featureFlag of params?.enabledFeatureFlags ?? []) {
    const normalized = normalizeFeatureFlag(String(featureFlag));
    if (normalized) {
      resolved.add(normalized);
    }
  }

  const env = params?.env ?? process.env;
  addFeatureFlags(resolved, env.ALISIO_SKILL_FEATURES);
  addFeatureFlags(resolved, env.ALISIO_SKILL_FEATURES);

  for (const [key, value] of Object.entries(env)) {
    const suffix = key.startsWith("ALISIO_FEATURE_")
      ? key.slice("ALISIO_FEATURE_".length)
      : key.startsWith("ALISIO_FEATURE_")
        ? key.slice("ALISIO_FEATURE_".length)
        : "";
    if (!suffix) {
      continue;
    }
    const enabled = parseBooleanValue(value);
    if (enabled === true) {
      resolved.add(normalizeFeatureFlag(suffix.replace(/_/g, "-")));
    }
  }

  return resolved;
}

export async function resolveSkillMarketplaceAccessContext(
  params?: SkillMarketplaceAccessContext,
): Promise<ResolvedMarketplaceAccessContext> {
  return {
    currentPlan: params?.currentPlan ?? (await resolveCurrentAlisioPlan(params?.env)),
    enabledFeatureFlags: resolveEnabledMarketplaceFeatureFlags(params),
  };
}

function evaluatePlanRequirement(params: {
  currentPlan: AlisioPlan;
  plan?: string;
  required: boolean;
}): SkillMarketplaceAccessIssue[] {
  if (!params.required) {
    return [];
  }

  const plan = params.plan?.trim().toLowerCase();
  if (!plan) {
    return [
      {
        code: "subscription_plan_required",
        message: "this skill requires a paid Alisio plan, but the manifest is missing a plan id.",
      },
    ];
  }

  if (!(ALISIO_PLAN_VALUES as readonly string[]).includes(plan)) {
    return [
      {
        code: "unsupported_subscription_plan",
        message: `this skill requires unsupported plan "${params.plan}".`,
      },
    ];
  }

  if (plan === "free") {
    return [];
  }

  if (params.currentPlan === "plus") {
    return [];
  }

  return [
    {
      code: "subscription_plan_required",
      message: `this skill requires Alisio ${plan}.`,
    },
  ];
}

export function evaluateSkillMarketplaceAccess(params: {
  subscription?: SkillSubscriptionSpec;
  currentPlan: AlisioPlan;
  enabledFeatureFlags?: Iterable<string>;
}): SkillMarketplaceAccess {
  const subscription = params.subscription;
  const enabledFeatureFlags = resolveEnabledMarketplaceFeatureFlags({
    enabledFeatureFlags: params.enabledFeatureFlags,
  });
  const issues = evaluatePlanRequirement({
    currentPlan: params.currentPlan,
    plan: subscription?.plan,
    required: subscription?.required === true,
  });

  const featureFlag = subscription?.featureFlag?.trim();
  if (featureFlag && !enabledFeatureFlags.has(normalizeFeatureFlag(featureFlag))) {
    issues.push({
      code: "feature_flag_required",
      message: `this skill requires feature flag "${featureFlag}".`,
    });
  }

  return {
    allowed: issues.length === 0,
    required: subscription?.required === true,
    currentPlan: params.currentPlan,
    ...(subscription?.plan ? { plan: subscription.plan } : {}),
    ...(featureFlag ? { featureFlag } : {}),
    enabledFeatureFlags: Array.from(enabledFeatureFlags).toSorted(),
    issues,
  };
}

export function formatSkillMarketplaceAccessError(
  skillName: string,
  access: SkillMarketplaceAccess,
): string {
  const detail = access.issues.map((issue) => issue.message).join(" ");
  return `Skill "${skillName}" is not available for the current Alisio account (${access.currentPlan}): ${detail}`;
}
