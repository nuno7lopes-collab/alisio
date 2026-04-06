export const ALISIO_PLAN_VALUES = ["free", "plus"] as const;

export type AlisioPlan = (typeof ALISIO_PLAN_VALUES)[number];

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
