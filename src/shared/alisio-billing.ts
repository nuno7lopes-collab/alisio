export const ALISIO_PLAN_VALUES = ["free", "plus"] as const;

export type AlisioPlan = (typeof ALISIO_PLAN_VALUES)[number];
export type AlisioPlanFeatureId = "connectors" | "organizations" | "sharing";

export type AlisioPlanEntitlements = {
  connectors: {
    maxConnected: number | null;
  };
  organizations: boolean;
  sharing: boolean;
};

const ALISIO_PLAN_ENTITLEMENTS: Record<AlisioPlan, AlisioPlanEntitlements> = {
  free: {
    connectors: {
      maxConnected: 1,
    },
    organizations: false,
    sharing: false,
  },
  plus: {
    connectors: {
      maxConnected: null,
    },
    organizations: true,
    sharing: true,
  },
};

export function isAlisioPlan(value: string): value is AlisioPlan {
  return (ALISIO_PLAN_VALUES as readonly string[]).includes(value);
}

export function isAlisioPaidPlan(plan: AlisioPlan): boolean {
  return plan === "plus";
}

export function normalizeAlisioPlan(value: string | null | undefined): AlisioPlan {
  const normalized = value?.trim().toLowerCase() || "";
  switch (normalized) {
    case "plus":
    case "plus plan":
      return "plus";
    case "free":
    case "free plan":
    default:
      return "free";
  }
}

export function alisioPlanTranslationKey(plan: AlisioPlan) {
  return plan === "plus" ? "alisio.settings.billing.plusPlan" : "alisio.settings.billing.freePlan";
}

export function getAlisioPlanEntitlements(plan: AlisioPlan): AlisioPlanEntitlements {
  return ALISIO_PLAN_ENTITLEMENTS[plan];
}

export function alisioConnectorLimit(plan: AlisioPlan): number | null {
  return getAlisioPlanEntitlements(plan).connectors.maxConnected;
}

export function alisioSupportsOrganizations(plan: AlisioPlan): boolean {
  return getAlisioPlanEntitlements(plan).organizations;
}

export function alisioSupportsSharing(plan: AlisioPlan): boolean {
  return getAlisioPlanEntitlements(plan).sharing;
}

export function alisioConnectorOccupiesPlanSlot(state: string | null | undefined): boolean {
  return state === "connected" || state === "needs_reconnect";
}

export function countAlisioConnectorPlanSlots(
  authorizations: Iterable<{
    state?: string | null | undefined;
  }>,
): number {
  let occupied = 0;
  for (const authorization of authorizations) {
    if (alisioConnectorOccupiesPlanSlot(authorization.state)) {
      occupied += 1;
    }
  }
  return occupied;
}

export function alisioConnectorUpgradeMessage(plan: AlisioPlan): string {
  const limit = alisioConnectorLimit(plan);
  if (limit == null) {
    return "This plan already includes multiple connected apps.";
  }
  const noun = limit === 1 ? "app" : "apps";
  return `Free includes ${limit} connected ${noun}. Open Settings -> Billing to upgrade before connecting more apps.`;
}

export function alisioOrganizationsUpgradeMessage(): string {
  return "Organizations currently require Plus and remain rollout-sensitive. Open Settings -> Billing before creating or joining a shared workspace.";
}

export function alisioSharingUpgradeMessage(): string {
  return "Device and model sharing are available on Plus. Open Settings -> Billing to upgrade before requesting or granting shared access.";
}
