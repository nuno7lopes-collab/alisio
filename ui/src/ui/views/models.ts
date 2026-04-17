import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import {
  DEFAULT_MODELS_AI_PROFILE_SORT,
  makeModelsOperationKey,
  type ModelProviderId,
  type ModelsAiProfileSort,
  type ModelsOperationMap,
} from "../models-view-types.ts";
import type { AlisioAiState, AlisioBootstrapState, AlisioModelsState } from "../types.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonPill,
  renderSurfaceEmptyState,
} from "./loading-skeleton.ts";

type AiProfile = NonNullable<AlisioAiState["profiles"]>[number];
type LocalModelTarget = NonNullable<AlisioModelsState["targets"]>[number];
type ChatModelOption = {
  value: string;
  label: string;
};
type TargetCatalogEntryView = {
  id: string;
  name: string;
  summary?: string;
  parametersBillions?: number;
  quantization?: string;
  memoryGb?: number;
  vramGb?: number;
  diskGb?: number;
  recommendation?: LocalModelTarget["recommendations"][number] | null;
};

function aiText() {
  return {
    noAccount: t("alisio.settings.ai.noAccount"),
    connectedOn: t("alisio.settings.ai.connectedOn"),
    resetsIn: t("alisio.settings.ai.resetsIn"),
    connectAnother: t("alisio.settings.ai.connectAnother"),
    connectOpenAi: t("alisio.settings.ai.connect"),
    profile: t("alisio.settings.ai.profile"),
    profiles: t("alisio.settings.ai.profiles"),
    noProfiles: t("alisio.settings.ai.noProfiles"),
    rename: t("alisio.settings.ai.rename"),
    renamePrompt: t("alisio.settings.ai.renamePrompt"),
    personal: t("alisio.settings.ai.personal"),
    team: t("alisio.settings.ai.team"),
    available: t("alisio.settings.ai.available"),
    recentlyConnected: t("alisio.settings.ai.recentlyConnected"),
    live: t("alisio.settings.ai.live"),
    now: t("alisio.settings.ai.now"),
    minutesSuffix: t("alisio.settings.ai.minutesSuffix"),
    hoursSuffix: t("alisio.settings.ai.hoursSuffix"),
    daysSuffix: t("alisio.settings.ai.daysSuffix"),
    ready: t("alisio.settings.ai.profileStatus.ready"),
    connected: t("alisio.settings.ai.profileStatus.connected"),
    connectedNoLimits: t("alisio.settings.ai.status.connectedNoLimits"),
    connecting: t("alisio.settings.ai.profileStatus.connecting"),
    expired: t("alisio.settings.ai.profileStatus.expired"),
    disconnected: t("alisio.settings.ai.profileStatus.disconnected"),
    active: t("alisio.settings.ai.active"),
    activeProfileButton: t("alisio.settings.ai.activeProfileButton"),
    activate: t("alisio.settings.ai.activate"),
    refresh: t("alisio.settings.ai.refresh"),
    remove: t("alisio.settings.ai.remove"),
    refreshAll: t("alisio.settings.ai.refreshAll"),
    emptyRefresh: t("alisio.settings.ai.emptyRefresh"),
    sortLabel: t("alisio.settings.ai.sort.label"),
    sortEmailAsc: t("alisio.settings.ai.sort.emailAsc"),
    sortRecent: t("alisio.settings.ai.sort.recent"),
    sortWeeklyResetAsc: t("alisio.settings.ai.sort.weeklyResetAsc"),
    sortWeeklyResetDesc: t("alisio.settings.ai.sort.weeklyResetDesc"),
  };
}

function modelsText() {
  return {
    title: t("alisio.settings.models.title"),
    subtitle: t("alisio.settings.models.subtitle"),
    chatgptTitle: t("alisio.settings.models.chatgptTitle"),
    chatgptSubtitle: t("alisio.settings.models.chatgptSubtitle"),
    localTitle: t("alisio.settings.models.localTitle"),
    localSubtitle: t("alisio.settings.models.localSubtitle"),
    currentComputer: t("alisio.settings.models.currentComputer"),
    activeComputer: t("alisio.settings.models.activeComputer"),
    connected: t("alisio.settings.models.connected"),
    sharedTarget: t("alisio.settings.models.sharedTarget"),
    readOnlyTarget: t("alisio.settings.models.readOnlyTarget"),
    modelSourceReady: t("alisio.settings.models.modelSourceReady"),
    modelSourcePending: t("alisio.settings.models.modelSourcePending"),
    noTargets: t("alisio.settings.models.noTargets"),
    noLocalModels: t("alisio.settings.models.noLocalModels"),
    install: t("alisio.settings.models.install"),
    installing: t("alisio.settings.models.installing"),
    update: t("alisio.settings.models.update"),
    updating: t("alisio.settings.models.updating"),
    installed: t("alisio.settings.models.installed"),
    uninstall: t("alisio.settings.models.uninstall"),
    uninstalling: t("alisio.settings.models.uninstalling"),
    running: t("alisio.settings.models.running"),
    backend: t("alisio.settings.models.backend"),
    installedModels: t("alisio.settings.models.installedModels"),
    availableModels: t("alisio.settings.models.availableModels"),
    noInstalledModels: t("alisio.settings.models.noInstalledModels"),
    runtimeNotConfigured: t("alisio.settings.models.runtimeNotConfigured"),
    runtimeError: t("alisio.settings.models.runtimeError"),
    targetNotConnected: t("alisio.settings.models.targetNotConnected"),
    currentComputerOffline: t("alisio.settings.models.currentComputerOffline"),
    linkedComputerOffline: t("alisio.settings.models.linkedComputerOffline"),
    localRuntimeHint: t("alisio.settings.models.localRuntimeHint"),
    linkedRuntimeHint: t("alisio.settings.models.linkedRuntimeHint"),
    openAiRuntimeHint: t("alisio.settings.models.openAiRuntimeHint"),
    runtimeErrorHint: t("alisio.settings.models.runtimeErrorHint"),
    hardware: t("alisio.settings.models.hardware"),
    hardwareFit: t("alisio.settings.models.hardwareFit"),
    ownedBy: t("alisio.settings.models.ownedBy"),
    recommendedUpTo: t("alisio.settings.models.recommendedUpTo"),
    memory: t("alisio.settings.models.memory"),
    disk: t("alisio.settings.models.disk"),
    cpu: t("alisio.settings.models.cpu"),
    compatibleToInstall: t("alisio.settings.models.compatibleToInstall"),
    installedNow: t("alisio.settings.models.installedNow"),
    installHint: t("alisio.settings.models.installHint"),
    noFurtherInstall: t("alisio.settings.models.noFurtherInstall"),
    fitRecommended: t("alisio.settings.models.fitRecommended"),
    fitWorks: t("alisio.settings.models.fitWorks"),
    fitSlow: t("alisio.settings.models.fitSlow"),
    fitUnsupported: t("alisio.settings.models.fitUnsupported"),
    fitSummaryUnavailable: t("alisio.settings.models.fitSummaryUnavailable"),
    blockedModelsHidden: t("alisio.settings.models.blockedModelsHidden"),
    blockedModelsHiddenSingle: t("alisio.settings.models.blockedModelsHiddenSingle"),
    installedCountSummary: t("alisio.settings.models.installedCountSummary"),
    runtime: t("alisio.settings.models.runtime"),
    noModelChoices: t("alisio.settings.models.noModelChoices"),
    modelsAvailable: t("alisio.settings.models.modelsAvailable"),
    suggestion: t("alisio.settings.models.suggestion"),
    suggestions: t("alisio.settings.models.suggestions"),
    recommendedToInstall: t("alisio.settings.models.recommendedToInstall"),
    confirmInstall: t("alisio.settings.models.confirmInstall"),
    confirmUpdate: t("alisio.settings.models.confirmUpdate"),
    confirmUninstall: t("alisio.settings.models.confirmUninstall"),
  };
}

const technicalLabelPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveProfileEmail(profile: AiProfile | null | undefined) {
  return profile?.email ?? profile?.identity.email;
}

function resolveProfileKindKey(profile: AiProfile | null | undefined) {
  if (profile?.scope === "organization" || profile?.ownerKey?.startsWith("organization:")) {
    return "team";
  }
  const plan = (profile?.planLabel ?? profile?.aggregatedTelemetry?.planType ?? "").toLowerCase();
  return /(team|business|enterprise|edu|organization|org|workspace)/.test(plan)
    ? "team"
    : "personal";
}

function resolveProfileKind(profile: AiProfile | null | undefined) {
  const text = aiText();
  return resolveProfileKindKey(profile) === "team" ? text.team : text.personal;
}

function profileSupportsRename(profile: AiProfile | null | undefined) {
  return resolveProfileKindKey(profile) === "team";
}

function resolveProfileCustomName(profile: AiProfile | null | undefined) {
  const label = profile?.label?.trim();
  const email = resolveProfileEmail(profile)?.toLowerCase();
  const technicalCandidates = new Set(
    [
      profile?.accountId,
      profile?.accountUserId,
      profile?.userId,
      profile?.identity.accountId,
      profile?.identity.accountUserId,
      profile?.identity.userId,
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim().toLowerCase()),
  );
  if (!label) {
    return undefined;
  }
  const normalizedLabel = label.toLowerCase();
  if (
    normalizedLabel === resolveProfileKind(profile).toLowerCase() ||
    (email && normalizedLabel === email) ||
    technicalCandidates.has(normalizedLabel) ||
    normalizedLabel.startsWith("alisio-openai:") ||
    normalizedLabel === "default" ||
    technicalLabelPattern.test(normalizedLabel)
  ) {
    return undefined;
  }
  return label;
}

function resolveProfileDisplayName(profile: AiProfile | null | undefined) {
  return resolveProfileCustomName(profile) ?? resolveProfileKind(profile);
}

function resolveProfileTitle(profile: AiProfile | null | undefined) {
  return resolveProfileEmail(profile) ?? profile?.label ?? aiText().noAccount;
}

function resolveProfilePlanLabel(profile: AiProfile | null | undefined) {
  const planLabel = profile?.planLabel?.trim();
  if (!planLabel) {
    return undefined;
  }
  const normalizedPlan = planLabel.toLowerCase();
  if (normalizedPlan === resolveProfileKind(profile).toLowerCase()) {
    return undefined;
  }
  const customName = resolveProfileCustomName(profile)?.toLowerCase();
  if (customName && normalizedPlan === customName) {
    return undefined;
  }
  return planLabel;
}

function resolveProfileEmailSortKey(profile: AiProfile | null | undefined) {
  return (resolveProfileEmail(profile) ?? resolveProfileTitle(profile)).trim().toLowerCase();
}

function resolveProfileUsageWindows(
  profile: AiProfile | null | undefined,
  ai: AlisioAiState | null | undefined,
  opts?: { allowActiveFallback?: boolean },
) {
  const telemetryWindows = [
    profile?.aggregatedTelemetry?.primaryWindow,
    profile?.aggregatedTelemetry?.secondaryWindow,
  ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  if (telemetryWindows.length > 0) {
    return telemetryWindows.map((window) => ({
      label: window.label,
      remainingPercent: window.remainingPercent,
      resetAt: window.resetAt,
    }));
  }
  const fallbackWindows = opts?.allowActiveFallback ? (ai?.limits?.windows ?? []) : [];
  return (profile?.limits?.windows ?? fallbackWindows).map((window) => ({
    label: window.label,
    remainingPercent: Math.max(0, Math.min(100, 100 - window.usedPercent)),
    resetAt: window.resetAt,
  }));
}

function formatReset(resetAt?: number) {
  const text = aiText();
  if (typeof resetAt !== "number") {
    return text.live;
  }
  const diffMs = resetAt - Date.now();
  if (diffMs <= 0) {
    return text.now;
  }
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffMinutes = Math.floor((diffMs % 3_600_000) / 60_000);
  if (diffHours <= 0) {
    return `${Math.max(diffMinutes, 1)}${text.minutesSuffix}`;
  }
  if (diffHours < 24) {
    return diffMinutes > 0
      ? `${diffHours}${text.hoursSuffix} ${diffMinutes}${text.minutesSuffix}`
      : `${diffHours}${text.hoursSuffix}`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}${text.daysSuffix}`;
}

function isWeeklyUsageWindow(label: string | null | undefined) {
  const normalized = String(label ?? "")
    .trim()
    .toLowerCase();
  return normalized === "week" || normalized === "weekly" || normalized === "7d";
}

function resolveWeeklyResetRemainingMs(
  profile: AiProfile,
  ai: AlisioAiState | null | undefined,
  active: boolean,
) {
  const weeklyWindow = resolveProfileUsageWindows(profile, ai, {
    allowActiveFallback: active,
  }).find((window) => isWeeklyUsageWindow(window.label));
  if (typeof weeklyWindow?.resetAt !== "number") {
    return null;
  }
  return Math.max(0, weeklyWindow.resetAt - Date.now());
}

function compareNullableAsc(left: number | null, right: number | null) {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return left - right;
}

function compareNullableDesc(left: number | null, right: number | null) {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  return right - left;
}

function sortAiProfiles(
  profiles: readonly AiProfile[],
  ai: AlisioAiState | null | undefined,
  activeProfileId: string | undefined,
  profileSort: ModelsAiProfileSort,
  recentProfileIds?: readonly string[],
) {
  const recentIndex = new Map(
    (recentProfileIds ?? []).map((profileId, index) => [profileId, index] as const),
  );
  return [...profiles].toSorted((left, right) => {
    const fallback = resolveProfileEmailSortKey(left).localeCompare(
      resolveProfileEmailSortKey(right),
    );
    if (profileSort === "recent") {
      if (left.profileId === activeProfileId) {
        return -1;
      }
      if (right.profileId === activeProfileId) {
        return 1;
      }
      const leftRecent = recentIndex.get(left.profileId);
      const rightRecent = recentIndex.get(right.profileId);
      if (typeof leftRecent === "number" || typeof rightRecent === "number") {
        if (typeof leftRecent !== "number") {
          return 1;
        }
        if (typeof rightRecent !== "number") {
          return -1;
        }
        if (leftRecent !== rightRecent) {
          return leftRecent - rightRecent;
        }
      }
      return fallback;
    }
    if (profileSort === "email-asc") {
      return fallback;
    }
    const leftReset = resolveWeeklyResetRemainingMs(left, ai, left.profileId === activeProfileId);
    const rightReset = resolveWeeklyResetRemainingMs(
      right,
      ai,
      right.profileId === activeProfileId,
    );
    const resetCompare =
      profileSort === "weekly-reset-desc"
        ? compareNullableDesc(leftReset, rightReset)
        : compareNullableAsc(leftReset, rightReset);
    return resetCompare || fallback;
  });
}

function formatConnectedAt(locale: string | undefined, value?: string) {
  const text = aiText();
  if (!value) {
    return text.recentlyConnected;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return text.recentlyConnected;
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  }).format(timestamp);
}

function usageTone(remainingPercent: number) {
  if (remainingPercent <= 15) {
    return "is-critical";
  }
  if (remainingPercent <= 40) {
    return "is-warm";
  }
  return "is-healthy";
}

function usageBarStyle(remainingPercent: number) {
  const clamped = Math.max(0, Math.min(100, remainingPercent));
  const hue = Math.round((clamped / 100) * 120);
  return `width:${clamped}%; background:hsl(${hue} 76% 52%);`;
}

function resolveEffectiveVramGb(target: Pick<LocalModelTarget, "hardware">) {
  if (!target.hardware) {
    return null;
  }
  const effective = Math.max(target.hardware.vramUnifiedGb ?? 0, target.hardware.vramTotalGb ?? 0);
  return effective > 0 ? effective : null;
}

function formatPlatformLabel(platform: string | null | undefined) {
  const normalized = String(platform ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "darwin" || normalized === "macos" || normalized === "mac") {
    return "macOS";
  }
  if (normalized === "win32" || normalized === "windows") {
    return "Windows";
  }
  if (normalized === "linux") {
    return "Linux";
  }
  if (normalized === "ios" || normalized === "iphone") {
    return "iPhone";
  }
  if (normalized === "ipados" || normalized === "ipad") {
    return "iPad";
  }
  if (normalized === "android") {
    return "Android";
  }
  return platform?.trim() ?? "";
}

function resolveModelRecommendation(
  target: LocalModelTarget,
  modelId: string,
): LocalModelTarget["recommendations"][number] | null {
  return target.recommendations.find((entry) => entry.modelId === modelId) ?? null;
}

function resolveProviderModelId(value: string, providerId: string | null | undefined) {
  const normalizedProviderId = providerId?.trim();
  if (!normalizedProviderId) {
    return "";
  }
  const normalizedValue = value.trim();
  if (!normalizedValue.toLowerCase().startsWith(`${normalizedProviderId.toLowerCase()}/`)) {
    return "";
  }
  return normalizedValue.slice(normalizedProviderId.length + 1);
}

function resolveProviderModelOptions(
  options: readonly ChatModelOption[],
  providerId: string | null | undefined,
) {
  const normalizedProviderId = providerId?.trim().toLowerCase();
  if (!normalizedProviderId) {
    return [];
  }
  return options.filter((option) =>
    option.value.trim().toLowerCase().startsWith(`${normalizedProviderId}/`),
  );
}

function resolveProviderFallbackModels(
  options: readonly ChatModelOption[],
  providerId: string | null | undefined,
) {
  const seen = new Set<string>();
  return resolveProviderModelOptions(options, providerId)
    .map((option) => {
      const id = resolveProviderModelId(option.value, providerId);
      const name = resolveScopedModelChipLabel(option.label);
      const key = id.trim().toLowerCase();
      if (!key || seen.has(key)) {
        return null;
      }
      seen.add(key);
      return { id, name: name || id };
    })
    .filter((entry): entry is { id: string; name: string } => Boolean(entry));
}

function resolveTargetDisplayModels(
  target: LocalModelTarget,
  options: readonly ChatModelOption[],
  providerId: string | null | undefined,
) {
  if (target.installedModels.length > 0) {
    return target.installedModels;
  }
  if (!target.supportsInstall && (target.availableModels?.length ?? 0) > 0) {
    return (target.availableModels ?? []).map((model) => ({
      id: model.id,
      name: model.name,
    }));
  }
  return target.supportsInstall
    ? target.installedModels
    : resolveProviderFallbackModels(options, providerId);
}

function resolveScopedModelChipLabel(label: string) {
  const trimmed = label.trim();
  if (!trimmed) {
    return "";
  }
  const separator = trimmed.indexOf(" · ");
  return separator > 0 ? trimmed.slice(0, separator) : trimmed;
}

function countUniqueInstalledModels(targets: readonly LocalModelTarget[]) {
  return new Set(
    targets.flatMap((target) =>
      target.installedModels.map((model) => model.id.trim().toLowerCase()),
    ),
  ).size;
}

function resolvePrimaryLocalSummary(
  targets: readonly LocalModelTarget[],
  catalog: readonly AlisioModelsState["catalog"][number][],
) {
  const installed = targets.flatMap((target) => target.installedModels);
  if (installed.length > 0) {
    return installed[0]?.name ?? "";
  }
  const discovered = targets
    .filter((target) => !target.supportsInstall)
    .flatMap((target) => target.availableModels ?? []);
  if (discovered.length > 0) {
    return discovered[0]?.name ?? "";
  }
  const recommended = targets.find((target) => target.bestModelName)?.bestModelName;
  if (recommended) {
    return recommended;
  }
  return catalog[0]?.name ?? "";
}

function formatCount(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function resolveCurrentTargets(targets: readonly LocalModelTarget[]) {
  return targets.filter((target) => target.current);
}

function resolveTargetRuntimeLabel(target: LocalModelTarget) {
  if (target.backend?.trim()) {
    return target.backend.trim();
  }
  if (target.runtimeLabel?.trim()) {
    return target.runtimeLabel.trim();
  }
  return "llama.cpp";
}

function resolveTargetEmptyModelsLabel(target: LocalModelTarget) {
  const text = modelsText();
  return target.supportsInstall ? text.noInstalledModels : text.noModelChoices;
}

function isGenericRuntimeMessage(message: string | null | undefined) {
  const normalized = message?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized === "local model runtime not configured on this computer" ||
    normalized === "no model source is configured on this computer" ||
    normalized === "failed to read local model runtime"
  );
}

function resolveTargetStatusDetail(target: LocalModelTarget) {
  const text = modelsText();
  if (!target.connected) {
    return target.current ? text.currentComputerOffline : text.linkedComputerOffline;
  }
  if (target.runtimeStatus === "not_configured") {
    return target.current ? text.localRuntimeHint : text.linkedRuntimeHint;
  }
  if (target.runtimeStatus === "error") {
    return text.runtimeErrorHint;
  }
  return "";
}

function recommendationWeight(grade: LocalModelTarget["recommendations"][number]["grade"]): number {
  switch (grade) {
    case "recommended":
      return 0;
    case "works":
      return 1;
    case "slow":
      return 2;
    default:
      return 3;
  }
}

function resolveSuggestedCatalogEntries(
  target: LocalModelTarget,
  catalog: readonly AlisioModelsState["catalog"][number][],
) {
  return catalog
    .filter(
      (model) => !target.installedModels.some((installedModel) => installedModel.id === model.id),
    )
    .map((model) => ({
      model,
      recommendation: resolveModelRecommendation(target, model.id),
    }))
    .filter(
      (
        entry,
      ): entry is {
        model: AlisioModelsState["catalog"][number];
        recommendation: NonNullable<ReturnType<typeof resolveModelRecommendation>>;
      } => Boolean(entry.recommendation),
    )
    .toSorted((left, right) => {
      const gradeDelta =
        recommendationWeight(left.recommendation.grade) -
        recommendationWeight(right.recommendation.grade);
      if (gradeDelta !== 0) {
        return gradeDelta;
      }
      return left.model.name.localeCompare(right.model.name);
    });
}

function resolveTargetAvailableCatalogEntries(
  target: LocalModelTarget,
  catalog: readonly AlisioModelsState["catalog"][number][],
): TargetCatalogEntryView[] {
  const targetCatalog = target.availableModels ?? [];
  if (targetCatalog.length > 0) {
    return targetCatalog
      .filter(
        (model) => !target.installedModels.some((installedModel) => installedModel.id === model.id),
      )
      .map((model) => ({
        id: model.id,
        name: model.name,
        summary: model.summary,
        parametersBillions: model.parametersBillions,
        quantization: model.quantization,
        memoryGb: model.memoryGb,
        vramGb: model.vramGb,
        diskGb: model.diskGb,
        recommendation: model.recommendation ?? resolveModelRecommendation(target, model.id),
      }))
      .toSorted((left, right) => {
        const leftWeight = left.recommendation
          ? recommendationWeight(left.recommendation.grade)
          : 3;
        const rightWeight = right.recommendation
          ? recommendationWeight(right.recommendation.grade)
          : 3;
        if (leftWeight !== rightWeight) {
          return leftWeight - rightWeight;
        }
        return left.name.localeCompare(right.name);
      });
  }

  return resolveSuggestedCatalogEntries(target, catalog).map(({ model, recommendation }) => ({
    id: model.id,
    name: model.name,
    summary: model.summary,
    parametersBillions: model.parametersBillions,
    quantization: model.quantization,
    memoryGb: model.memoryGb,
    vramGb: model.vramGb,
    diskGb: model.diskGb,
    recommendation,
  }));
}

function resolveTargetCatalogLookupEntries(
  target: LocalModelTarget,
  catalog: readonly AlisioModelsState["catalog"][number][],
): TargetCatalogEntryView[] {
  if ((target.availableModels?.length ?? 0) > 0) {
    return (target.availableModels ?? []).map((model) => ({
      id: model.id,
      name: model.name,
      summary: model.summary,
      parametersBillions: model.parametersBillions,
      quantization: model.quantization,
      memoryGb: model.memoryGb,
      vramGb: model.vramGb,
      diskGb: model.diskGb,
      recommendation: model.recommendation ?? resolveModelRecommendation(target, model.id),
    }));
  }

  return catalog.map((model) => ({
    id: model.id,
    name: model.name,
    summary: model.summary,
    parametersBillions: model.parametersBillions,
    quantization: model.quantization,
    memoryGb: model.memoryGb,
    vramGb: model.vramGb,
    diskGb: model.diskGb,
    recommendation: resolveModelRecommendation(target, model.id),
  }));
}

function resolveRecommendationCode(
  recommendation: LocalModelTarget["recommendations"][number] | null | undefined,
) {
  if (!recommendation) {
    return "insufficient" as const;
  }
  if (recommendation.reasonCode) {
    return recommendation.reasonCode;
  }
  switch (recommendation.grade) {
    case "recommended":
      return "comfortable" as const;
    case "works":
      return "supported" as const;
    case "slow":
      return "tight" as const;
    default:
      return "insufficient" as const;
  }
}

function formatRequiredResourcesLabel(params: { requiredRamGb?: number; requiredVramGb?: number }) {
  const parts = [];
  if (typeof params.requiredRamGb === "number" && Number.isFinite(params.requiredRamGb)) {
    parts.push(`~${params.requiredRamGb} GB RAM`);
  }
  if (typeof params.requiredVramGb === "number" && Number.isFinite(params.requiredVramGb)) {
    parts.push(`~${params.requiredVramGb} GB VRAM`);
  }
  return parts.join(" / ");
}

function formatAvailableResourcesLabel(target: LocalModelTarget) {
  if (!target.hardware) {
    return "";
  }
  const parts = [`${target.hardware.ramTotalGb ?? target.hardware.totalMemoryGb} GB RAM`];
  const effectiveVram = resolveEffectiveVramGb(target);
  if (typeof effectiveVram === "number") {
    parts.push(`${effectiveVram} GB VRAM`);
  }
  return parts.join(" / ");
}

function resolveRecommendationLabel(
  recommendation: LocalModelTarget["recommendations"][number] | null | undefined,
) {
  const text = modelsText();
  switch (resolveRecommendationCode(recommendation)) {
    case "comfortable":
      return text.fitRecommended;
    case "supported":
      return text.fitWorks;
    case "tight":
      return text.fitSlow;
    default:
      return text.fitUnsupported;
  }
}

function resolveRecommendationReason(params: {
  target: LocalModelTarget;
  model: Pick<TargetCatalogEntryView, "name" | "memoryGb" | "vramGb">;
  recommendation: LocalModelTarget["recommendations"][number] | null | undefined;
}) {
  const { target, model, recommendation } = params;
  const reasonCode = resolveRecommendationCode(recommendation);
  if (reasonCode === "comfortable") {
    return t("alisio.settings.models.fitReasonComfortable", { model: model.name });
  }
  if (reasonCode === "supported") {
    return t("alisio.settings.models.fitReasonSupported", { model: model.name });
  }
  if (reasonCode === "tight") {
    return t("alisio.settings.models.fitReasonTight", { model: model.name });
  }
  return t("alisio.settings.models.fitReasonInsufficient", {
    model: model.name,
    required: formatRequiredResourcesLabel({
      requiredRamGb: recommendation?.requiredRamGb ?? model.memoryGb,
      requiredVramGb: recommendation?.requiredVramGb ?? model.vramGb,
    }),
    available: formatAvailableResourcesLabel(target),
  });
}

function resolveRecommendationToneClass(
  recommendation: LocalModelTarget["recommendations"][number] | null | undefined,
) {
  switch (resolveRecommendationCode(recommendation)) {
    case "comfortable":
      return "is-recommended";
    case "supported":
      return "is-works";
    case "tight":
      return "is-slow";
    default:
      return "is-unsupported";
  }
}

function formatModelFacts(entry: TargetCatalogEntryView | null) {
  if (!entry) {
    return "";
  }
  const text = modelsText();
  return [
    typeof entry.parametersBillions === "number" ? `${entry.parametersBillions}B` : "",
    entry.quantization ?? "",
    typeof entry.memoryGb === "number" ? `${text.memory} ${entry.memoryGb} GB` : "",
    typeof entry.vramGb === "number" ? `VRAM ${entry.vramGb} GB` : "",
    typeof entry.diskGb === "number" ? `${text.disk} ${entry.diskGb} GB` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function resolveBestCatalogEntry(
  target: LocalModelTarget,
  catalog: readonly TargetCatalogEntryView[],
) {
  const normalizedBestId = target.bestModelId?.trim().toLowerCase();
  if (normalizedBestId) {
    const bestById = catalog.find((entry) => entry.id.trim().toLowerCase() === normalizedBestId);
    if (bestById) {
      return bestById;
    }
  }
  const normalizedBestName = target.bestModelName?.trim().toLowerCase();
  if (normalizedBestName) {
    const bestByName = catalog.find(
      (entry) => entry.name.trim().toLowerCase() === normalizedBestName,
    );
    if (bestByName) {
      return bestByName;
    }
  }
  return (
    catalog.find((entry) => entry.recommendation && entry.recommendation.grade !== "unsupported") ??
    null
  );
}

function resolveTargetCompatibilityState(
  target: LocalModelTarget,
  catalog: readonly AlisioModelsState["catalog"][number][],
) {
  const allChoices = resolveTargetAvailableCatalogEntries(target, catalog);
  const compatible = allChoices.filter(
    (entry) => (entry.recommendation?.grade ?? "unsupported") !== "unsupported",
  );
  const hiddenUnsupported = allChoices.filter(
    (entry) => (entry.recommendation?.grade ?? "unsupported") === "unsupported",
  );
  return {
    compatibleChoices: compatible.slice(0, 3),
    hiddenUnsupported,
  };
}

function resolveTargetFitSummary(
  recommendation: LocalModelTarget["recommendations"][number] | null | undefined,
  modelName: string,
) {
  switch (resolveRecommendationCode(recommendation)) {
    case "comfortable":
      return t("alisio.settings.models.fitSummaryComfortable", { model: modelName });
    case "supported":
      return t("alisio.settings.models.fitSummarySupported", { model: modelName });
    case "tight":
      return t("alisio.settings.models.fitSummaryTight", { model: modelName });
    default:
      return t("alisio.settings.models.fitSummaryUnavailable");
  }
}

function resolveHiddenModelsSummary(hiddenUnsupported: readonly TargetCatalogEntryView[]) {
  if (hiddenUnsupported.length === 0) {
    return "";
  }
  if (hiddenUnsupported.length === 1) {
    return t("alisio.settings.models.blockedModelsHiddenSingle", {
      model: hiddenUnsupported[0]?.name ?? "",
    });
  }
  return t("alisio.settings.models.blockedModelsHidden", {
    count: String(hiddenUnsupported.length),
  });
}

function resolveTargetDecision(params: {
  target: LocalModelTarget;
  catalog: readonly TargetCatalogEntryView[];
}) {
  const { target, catalog } = params;
  const text = modelsText();
  const bestEntry = resolveBestCatalogEntry(target, catalog);
  const bestRecommendation = bestEntry?.recommendation ?? null;
  const installedPrimary = target.installedModels[0] ?? null;
  const installedHasBest =
    Boolean(bestEntry) &&
    target.installedModels.some(
      (model) => model.id.trim().toLowerCase() === bestEntry!.id.trim().toLowerCase(),
    );
  const runtimeMessage =
    target.runtimeMessage && !isGenericRuntimeMessage(target.runtimeMessage)
      ? target.runtimeMessage
      : "";

  if (!target.connected) {
    return {
      tone: "blocked",
      headline: text.targetNotConnected,
      description: resolveTargetStatusDetail(target),
    } as const;
  }

  if (target.runtimeStatus === "error") {
    return {
      tone: "blocked",
      headline: text.runtimeError,
      description: runtimeMessage || resolveTargetStatusDetail(target),
    } as const;
  }

  if (installedPrimary) {
    return {
      tone: resolveRecommendationCode(bestRecommendation) === "tight" ? "caution" : "ready",
      headline:
        target.installedModels.length === 1
          ? installedPrimary.name
          : t("alisio.settings.models.installedCountSummary", {
              count: String(target.installedModels.length),
            }),
      description:
        bestEntry && !installedHasBest
          ? resolveTargetFitSummary(bestRecommendation, bestEntry.name)
          : text.noFurtherInstall,
    } as const;
  }

  if (bestEntry) {
    return {
      tone: resolveRecommendationCode(bestRecommendation) === "tight" ? "caution" : "ready",
      headline: resolveTargetFitSummary(bestRecommendation, bestEntry.name),
      description:
        runtimeMessage ||
        resolveTargetStatusDetail(target) ||
        resolveRecommendationReason({
          target,
          model: bestEntry,
          recommendation: bestRecommendation,
        }),
    } as const;
  }

  return {
    tone: "blocked",
    headline: text.fitSummaryUnavailable,
    description: runtimeMessage || resolveTargetStatusDetail(target) || text.installHint,
  } as const;
}

function resolveTargetHardwareStats(target: LocalModelTarget) {
  const text = modelsText();
  if (!target.hardware) {
    return [];
  }
  return [
    {
      label: text.memory,
      value: `${target.hardware.ramTotalGb ?? target.hardware.totalMemoryGb} GB`,
    },
    ...(typeof resolveEffectiveVramGb(target) === "number"
      ? [
          {
            label: "VRAM",
            value: `${resolveEffectiveVramGb(target)} GB`,
          },
        ]
      : []),
    {
      label: text.cpu,
      value: String(target.hardware.cpuCores),
    },
    {
      label: text.runtime,
      value: [resolveTargetRuntimeLabel(target), formatPlatformLabel(target.platform)]
        .filter(Boolean)
        .join(" · "),
    },
  ];
}

function formatModelBytes(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "";
  }
  const gb = value / 1_000_000_000;
  if (gb >= 1) {
    return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  }
  const mb = value / 1_000_000;
  return `${Math.max(1, Math.round(mb))} MB`;
}

function trimProgressVerb(label: string) {
  return label.replace(/(?:\.\.\.|…)\s*$/, "").trim();
}

function findTargetModelOperation(
  operations: ModelsOperationMap | undefined,
  targetId: string,
  modelId: string,
) {
  return operations?.[makeModelsOperationKey(targetId, modelId)] ?? null;
}

function renderModelOperationProgress(
  targetId: string,
  modelId: string,
  operation: {
    action: "install" | "uninstall";
    intent?: "install" | "update" | "uninstall";
    phase: "started" | "running" | "completed" | "failed";
    percent?: number;
    downloadedSize?: number;
    totalSize?: number;
    message?: string;
  } | null,
) {
  if (!operation || operation.phase === "completed" || operation.phase === "failed") {
    return nothing;
  }
  const text = modelsText();
  const progressPercent =
    typeof operation.percent === "number"
      ? Math.max(0, Math.min(100, operation.percent))
      : operation.action === "install"
        ? operation.phase === "started"
          ? 2
          : 10
        : operation.phase === "started"
          ? 35
          : 65;
  const installLabel =
    operation.intent === "update"
      ? progressPercent > 0
        ? `${trimProgressVerb(text.updating)} ${progressPercent}%`
        : text.updating
      : progressPercent > 0
        ? `${trimProgressVerb(text.installing)} ${progressPercent}%`
        : text.installing;
  const progressLabel = operation.action === "uninstall" ? text.uninstalling : installLabel;
  const meta =
    operation.action === "install" &&
    typeof operation.downloadedSize === "number" &&
    typeof operation.totalSize === "number" &&
    operation.totalSize > 0
      ? `${formatModelBytes(operation.downloadedSize)} / ${formatModelBytes(operation.totalSize)}`
      : operation.message?.trim() || "";

  return html`
    <div
      class="alisio-models__progress"
      data-target-id=${targetId}
      data-model-id=${modelId}
      aria-label=${progressLabel}
    >
      <div class="alisio-models__progress-head">
        <span class="alisio-models__progress-label">${progressLabel}</span>
        ${meta ? html`<span class="alisio-models__progress-meta">${meta}</span>` : nothing}
      </div>
      <div
        class="alisio-models__progress-bar"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${String(progressPercent)}
      >
        <span style=${`width:${progressPercent}%`}></span>
      </div>
    </div>
  `;
}

function resolveUpdateButtonLabel(
  operation: {
    action: "install" | "uninstall";
    intent?: "install" | "update" | "uninstall";
  } | null,
) {
  const text = modelsText();
  if (operation?.action !== "install") {
    return text.update;
  }
  return text.updating;
}

function resolveCatalogEntryById(catalog: readonly TargetCatalogEntryView[], modelId: string) {
  const normalizedId = modelId.trim().toLowerCase();
  return catalog.find((entry) => entry.id.trim().toLowerCase() === normalizedId) ?? null;
}

function renderTargetHardwareStats(target: LocalModelTarget) {
  const stats = resolveTargetHardwareStats(target);
  if (stats.length === 0) {
    return nothing;
  }
  return html`
    <div class="alisio-models__target-stats">
      ${stats.map(
        (stat) => html`
          <div class="alisio-models__target-stat">
            <span class="alisio-models__target-stat-label">${stat.label}</span>
            <strong class="alisio-models__target-stat-value">${stat.value}</strong>
          </div>
        `,
      )}
    </div>
  `;
}

function renderInstalledModelRows(props: {
  target: LocalModelTarget;
  catalog: readonly TargetCatalogEntryView[];
  operations?: ModelsOperationMap;
  busy: boolean;
  onUpdateModel?: (targetId: string, modelId: string) => void;
  onUninstallModel: (targetId: string, modelId: string) => void;
}) {
  const text = modelsText();
  if (props.target.installedModels.length === 0) {
    return html`<div class="list-sub">${resolveTargetEmptyModelsLabel(props.target)}</div>`;
  }
  return html`
    <div class="alisio-models__installed-rows">
      ${props.target.installedModels.map((model) => {
        const catalogEntry = resolveCatalogEntryById(props.catalog, model.id);
        const operation = findTargetModelOperation(
          props.operations,
          props.target.targetId,
          model.id,
        );
        const busy = props.busy || Boolean(operation);
        return html`
          <div class="alisio-models__model-row is-installed">
            <div class="alisio-models__model-main">
              <div class="list-title">${catalogEntry?.name ?? model.name}</div>
              <div class="alisio-models__catalog-facts">
                ${formatModelFacts(catalogEntry) || text.installed}
              </div>
              ${model.running
                ? html` <span class="alisio-models__fit-badge is-running">${text.running}</span> `
                : nothing}
            </div>
            <div class="alisio-models__model-actions">
              ${props.onUpdateModel
                ? html`
                    <button
                      class="btn"
                      ?disabled=${busy}
                      @click=${() => props.onUpdateModel?.(props.target.targetId, model.id)}
                    >
                      ${resolveUpdateButtonLabel(operation)}
                    </button>
                  `
                : nothing}
              <button
                class="btn danger"
                ?disabled=${busy}
                @click=${() => props.onUninstallModel(props.target.targetId, model.id)}
              >
                ${operation?.action === "uninstall" ? text.uninstalling : text.uninstall}
              </button>
            </div>
            ${renderModelOperationProgress(props.target.targetId, model.id, operation)}
          </div>
        `;
      })}
    </div>
  `;
}

function renderTargetCatalog(props: {
  target: LocalModelTarget;
  catalog: readonly TargetCatalogEntryView[];
  operations?: ModelsOperationMap;
  busy: boolean;
  onInstallModel: (targetId: string, modelId: string) => void;
}) {
  if (!props.target.supportsInstall || props.catalog.length === 0) {
    return nothing;
  }
  const text = modelsText();
  const suggestedCatalog = props.catalog;
  if (suggestedCatalog.length === 0) {
    return nothing;
  }

  return html`
    <div class="alisio-models__catalog">
      ${suggestedCatalog.map((model) => {
        const recommendation = model.recommendation ?? null;
        const operation = findTargetModelOperation(
          props.operations,
          props.target.targetId,
          model.id,
        );
        const installBusy = operation?.action === "install" && operation.phase !== "failed";
        return html`
          <div class="alisio-models__catalog-item">
            <div class="alisio-models__model-main">
              <div class="alisio-models__catalog-topline">
                <div class="list-title">${model.name}</div>
                ${recommendation
                  ? html`
                      <span
                        class="alisio-models__fit-badge ${resolveRecommendationToneClass(
                          recommendation,
                        )}"
                      >
                        ${resolveRecommendationLabel(recommendation)}
                      </span>
                    `
                  : nothing}
              </div>
              ${model.summary ? html`<div class="list-sub">${model.summary}</div>` : nothing}
              <div class="alisio-models__catalog-facts">${formatModelFacts(model)}</div>
              ${recommendation
                ? html`
                    <div class="list-sub">
                      ${resolveRecommendationReason({
                        target: props.target,
                        model,
                        recommendation,
                      })}
                    </div>
                  `
                : nothing}
            </div>
            <div class="alisio-models__catalog-actions">
              <button
                class="btn primary"
                ?disabled=${props.busy || !props.target.connected || installBusy}
                @click=${() => props.onInstallModel(props.target.targetId, model.id)}
                title=${recommendation
                  ? resolveRecommendationReason({
                      target: props.target,
                      model,
                      recommendation,
                    })
                  : ""}
              >
                ${installBusy ? text.installing : text.install}
              </button>
            </div>
            ${renderModelOperationProgress(props.target.targetId, model.id, operation)}
          </div>
        `;
      })}
    </div>
  `;
}

function renderTargetCard(props: {
  target: LocalModelTarget;
  installCatalog?: readonly AlisioModelsState["catalog"][number][];
  modelOptions?: readonly ChatModelOption[];
  operations?: ModelsOperationMap;
  busy?: boolean;
  onInstallModel?: (targetId: string, modelId: string) => void;
  onUpdateModel?: (targetId: string, modelId: string) => void;
  onUninstallModel?: (targetId: string, modelId: string) => void;
}) {
  const text = modelsText();
  const canManageInstalledModels = Boolean(props.onUninstallModel && props.target.supportsInstall);
  const targetProviderId = props.target.chatProviderId?.trim() || "";
  const targetDisplayModels = resolveTargetDisplayModels(
    props.target,
    props.modelOptions ?? [],
    targetProviderId,
  );
  const targetCatalogEntries = props.installCatalog
    ? resolveTargetCatalogLookupEntries(props.target, props.installCatalog)
    : [];
  const { compatibleChoices, hiddenUnsupported } = props.installCatalog
    ? resolveTargetCompatibilityState(props.target, props.installCatalog)
    : { compatibleChoices: [], hiddenUnsupported: [] };
  const decision = resolveTargetDecision({
    target: props.target,
    catalog: targetCatalogEntries,
  });
  const subtitle = [
    resolveTargetRuntimeLabel(props.target),
    formatPlatformLabel(props.target.platform),
    props.target.access === "shared" ? text.readOnlyTarget : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const hiddenUnsupportedSummary = resolveHiddenModelsSummary(hiddenUnsupported);
  return html`
    <div
      class="alisio-models__target ${props.target.current ? "is-current" : ""} ${!props.target
        .connected || props.target.runtimeStatus === "error"
        ? "is-error"
        : props.target.runtimeStatus === "ready"
          ? "is-ready"
          : ""}"
    >
      <div class="alisio-models__target-context">
        ${props.target.current ? text.currentComputer : props.target.label}
      </div>
      <div class="alisio-models__target-summary is-${decision.tone}">
        <div class="alisio-models__target-heading">${decision.headline}</div>
        <div class="alisio-models__target-subheading">${subtitle}</div>
        <div class="list-sub">${decision.description}</div>
      </div>
      ${renderTargetHardwareStats(props.target)}
      <div class="alisio-models__installed">
        <div class="alisio-models__installed-title">${text.installedNow}</div>
        ${canManageInstalledModels
          ? renderInstalledModelRows({
              target: props.target,
              catalog: targetCatalogEntries,
              operations: props.operations,
              busy: props.busy ?? false,
              onUpdateModel: props.onUpdateModel,
              onUninstallModel: props.onUninstallModel!,
            })
          : targetDisplayModels.length > 0
            ? html`
                <div class="alisio-models__installed-list">
                  ${targetDisplayModels.map(
                    (model) => html`<span class="pill">${model.name}</span>`,
                  )}
                </div>
              `
            : html`<div class="list-sub">${resolveTargetEmptyModelsLabel(props.target)}</div>`}
      </div>
      ${props.installCatalog &&
      props.onInstallModel &&
      props.target.supportsInstall &&
      compatibleChoices.length > 0
        ? html`
            <div class="alisio-models__installed">
              <div class="alisio-models__installed-title">${text.compatibleToInstall}</div>
              ${renderTargetCatalog({
                target: props.target,
                catalog: compatibleChoices,
                operations: props.operations,
                busy: props.busy ?? false,
                onInstallModel: props.onInstallModel,
              })}
            </div>
          `
        : nothing}
      ${hiddenUnsupportedSummary
        ? html`<div class="alisio-models__target-note">${hiddenUnsupportedSummary}</div>`
        : nothing}
    </div>
  `;
}

function renderTargetCardSkeleton(opts: { showActions?: boolean; showCatalog?: boolean } = {}) {
  const showActions = opts.showActions ?? true;
  const showCatalog = opts.showCatalog ?? true;
  return html`
    <div class="alisio-models__target alisio-models__target--skeleton" aria-hidden="true">
      <div class="alisio-models__target-head">
        <div class="alisio-models__target-skeleton-copy">
          ${renderSkeletonLines(["medium", "short"], { compact: true })}
        </div>
        <div class="alisio-models__target-skeleton-badges">
          ${renderSkeletonPill({ small: true })} ${renderSkeletonPill({ small: true })}
        </div>
      </div>
      <div class="alisio-models__target-meta">
        ${renderSkeletonPill({ small: true })}
        ${renderSkeletonLines(["medium"], {
          compact: true,
          className: "alisio-models__target-skeleton-status",
        })}
      </div>
      <div class="alisio-models__installed">
        <div
          class="skeleton skeleton-line skeleton-line--short alisio-models__section-skeleton-label"
        ></div>
        <div class="alisio-models__model-row alisio-models__model-row--skeleton">
          <div class="alisio-models__model-main">
            ${renderSkeletonLines(["medium", "long"], { compact: true })}
          </div>
          ${showActions
            ? html`
                <div class="alisio-models__model-actions">
                  ${renderSkeletonButton({ small: true })} ${renderSkeletonButton({ small: true })}
                </div>
              `
            : html`
                <div class="alisio-models__target-skeleton-badges">
                  ${renderSkeletonPill({ small: true })} ${renderSkeletonPill({ small: true })}
                </div>
              `}
        </div>
      </div>
      ${showCatalog
        ? html`
            <div class="alisio-models__installed">
              <div
                class="skeleton skeleton-line skeleton-line--short alisio-models__section-skeleton-label"
              ></div>
              <div class="alisio-models__catalog">
                <div class="alisio-models__catalog-item alisio-models__catalog-item--skeleton">
                  <div class="alisio-models__model-main">
                    ${renderSkeletonLines(["medium", "long"], { compact: true })}
                    <div class="alisio-models__model-facts">
                      ${renderSkeletonPill({ small: true })} ${renderSkeletonPill({ small: true })}
                      ${renderSkeletonPill({ small: true })}
                    </div>
                  </div>
                  <div class="alisio-models__catalog-actions">
                    ${renderSkeletonButton({ small: true })}
                  </div>
                </div>
              </div>
            </div>
          `
        : nothing}
    </div>
  `;
}

function renderAiProfileSkeleton() {
  return html`
    <article class="alisio-settings-ai__profile alisio-models__profile" aria-hidden="true">
      <div class="alisio-settings-ai__profile-head">
        <div class="alisio-models__target-skeleton-copy">
          ${renderSkeletonLines(["medium", "short"], { compact: true })}
        </div>
        <div class="alisio-models__target-skeleton-badges">
          ${renderSkeletonPill({ small: true })} ${renderSkeletonPill({ small: true })}
        </div>
      </div>
      <div class="alisio-models__profile-summary">
        ${renderSkeletonPill({ small: true })} ${renderSkeletonPill({ small: true })}
      </div>
    </article>
  `;
}

function renderProviderPicker(props: {
  selectedProviderId: ModelProviderId;
  cards: ReadonlyArray<{
    id: ModelProviderId;
    badge: string;
    title: string;
    primary: string;
    secondary: string;
    loading: boolean;
  }>;
  onSelectProvider: (providerId: ModelProviderId) => void;
}) {
  return html`
    <div class="alisio-models__provider-grid">
      ${props.cards.map(
        (card) => html`
          <button
            type="button"
            class="alisio-models__provider-card ${props.selectedProviderId === card.id
              ? "is-selected"
              : ""} ${card.loading ? "is-loading" : ""}"
            @click=${() => props.onSelectProvider(card.id)}
            aria-pressed=${String(props.selectedProviderId === card.id)}
            aria-busy=${String(card.loading)}
          >
            <span class="alisio-models__provider-badge">${card.badge}</span>
            <div class="alisio-models__provider-copy">
              <div class="alisio-models__provider-title">${card.title}</div>
              ${card.loading
                ? renderSkeletonLines(["medium", "short"], { compact: true })
                : html`
                    <div class="alisio-models__provider-primary">${card.primary}</div>
                    <div class="alisio-models__provider-secondary">${card.secondary}</div>
                  `}
            </div>
          </button>
        `,
      )}
    </div>
  `;
}

const profileRenameDrafts = new Map<string, string>();
const profileRenameEditingIds = new Set<string>();

function resolveEventTargetRoot(eventTarget: EventTarget | null): Document | ShadowRoot | null {
  if (!(eventTarget instanceof Node)) {
    return null;
  }
  const root = eventTarget.getRootNode();
  return root instanceof ShadowRoot || root instanceof Document ? root : null;
}

function hasRequestUpdateHost(value: unknown): value is { requestUpdate: () => void } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { requestUpdate?: unknown }).requestUpdate === "function"
  );
}

function requestModelsViewUpdate(eventTarget: EventTarget | null) {
  const root = resolveEventTargetRoot(eventTarget);
  if (!root || !("host" in root)) {
    return;
  }
  const host = root.host;
  if (hasRequestUpdateHost(host)) {
    host.requestUpdate();
  }
}

function focusInlineRenameInput(profileId: string, eventTarget: EventTarget | null) {
  const root = resolveEventTargetRoot(eventTarget);
  if (!root) {
    return;
  }
  requestAnimationFrame(() => {
    const input = root.querySelector<HTMLInputElement>(
      `[data-profile-rename-input="${profileId}"]`,
    );
    input?.focus();
    input?.select();
  });
}

function beginInlineRename(profile: AiProfile, eventTarget: EventTarget | null) {
  profileRenameEditingIds.add(profile.profileId);
  profileRenameDrafts.set(profile.profileId, resolveProfileDisplayName(profile));
  requestModelsViewUpdate(eventTarget);
  focusInlineRenameInput(profile.profileId, eventTarget);
}

function cancelInlineRename(profileId: string, eventTarget?: EventTarget | null) {
  profileRenameEditingIds.delete(profileId);
  profileRenameDrafts.delete(profileId);
  requestModelsViewUpdate(eventTarget ?? null);
}

function commitInlineRename(
  profile: AiProfile,
  onRenameProfile: (profileId: string, label: string) => void,
  eventTarget?: EventTarget | null,
) {
  const nextLabel = profileRenameDrafts.get(profile.profileId)?.trim() ?? "";
  cancelInlineRename(profile.profileId, eventTarget);
  if (!nextLabel || nextLabel === resolveProfileDisplayName(profile)) {
    return;
  }
  onRenameProfile(profile.profileId, nextLabel);
}

function handleInlineRenameInteraction(
  event: Event | KeyboardEvent,
  action: () => void,
  disabled: boolean,
) {
  if (disabled) {
    return;
  }
  if ("key" in event && event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  action();
}

function renderProfileSubtitle(
  profile: AiProfile,
  props: {
    loading: boolean;
    onRenameProfile: (profileId: string, label: string) => void;
  },
) {
  const subtitle = resolveProfileDisplayName(profile);
  if (!profileSupportsRename(profile)) {
    return subtitle;
  }
  const isEditing = profileRenameEditingIds.has(profile.profileId);
  const draftValue = profileRenameDrafts.get(profile.profileId) ?? subtitle;
  if (isEditing) {
    return html`
      <input
        class="alisio-models__profile-rename-input"
        data-profile-rename-input=${profile.profileId}
        .value=${draftValue}
        ?disabled=${props.loading}
        placeholder=${aiText().renamePrompt}
        @click=${(event: Event) => event.stopPropagation()}
        @input=${(event: InputEvent) => {
          profileRenameDrafts.set(profile.profileId, (event.target as HTMLInputElement).value);
          requestModelsViewUpdate(event.currentTarget);
        }}
        @blur=${(event: FocusEvent) =>
          commitInlineRename(profile, props.onRenameProfile, event.currentTarget)}
        @keydown=${(event: KeyboardEvent) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            commitInlineRename(profile, props.onRenameProfile, event.currentTarget);
            return;
          }
          if (event.key === "Escape") {
            cancelInlineRename(profile.profileId, event.currentTarget);
          }
        }}
      />
    `;
  }
  return html`
    <span class="alisio-models__profile-subtitle-wrap">
      <span class="alisio-models__profile-subtitle-text">${subtitle}</span>
      <button
        type="button"
        class="alisio-models__profile-rename-trigger"
        ?disabled=${props.loading}
        aria-label=${`${aiText().rename} ${subtitle}`}
        title=${aiText().rename}
        @click=${(event: Event) =>
          handleInlineRenameInteraction(
            event,
            () => beginInlineRename(profile, event.currentTarget),
            props.loading,
          )}
        @keydown=${(event: KeyboardEvent) =>
          handleInlineRenameInteraction(
            event,
            () => beginInlineRename(profile, event.currentTarget),
            props.loading,
          )}
      >
        ${icons.edit}
      </button>
    </span>
  `;
}

function resolveProfiles(ai: AlisioAiState | null | undefined) {
  const activeProfileId = ai?.binding ? ai.activeProfileId : undefined;
  return [...(ai?.profiles ?? [])].toSorted((left, right) => {
    if (left.profileId === activeProfileId) {
      return -1;
    }
    if (right.profileId === activeProfileId) {
      return 1;
    }
    return resolveProfileTitle(left).localeCompare(resolveProfileTitle(right));
  });
}

function syncInlineRenameState(profiles: readonly AiProfile[]) {
  const profileIds = new Set(profiles.map((profile) => profile.profileId));
  for (const profileId of profileRenameEditingIds) {
    if (!profileIds.has(profileId)) {
      profileRenameEditingIds.delete(profileId);
    }
  }
  for (const profileId of profileRenameDrafts.keys()) {
    if (!profileIds.has(profileId)) {
      profileRenameDrafts.delete(profileId);
    }
  }
}

function renderUsagePreview(
  profile: AiProfile,
  ai: AlisioAiState | null | undefined,
  active: boolean,
) {
  const windows = resolveProfileUsageWindows(profile, ai, {
    allowActiveFallback: active,
  }).slice(0, 2);
  const text = aiText();
  if (windows.length === 0) {
    return nothing;
  }
  return windows.map((window) => {
    const subtleReset =
      isWeeklyUsageWindow(window.label) && typeof window.resetAt === "number"
        ? formatReset(window.resetAt)
        : null;
    return html`
      <span class="alisio-models__usage-pill ${usageTone(window.remainingPercent)}">
        <span class="alisio-models__usage-pill-main"
          >${window.label} · ${Math.round(window.remainingPercent)}% ${text.available}</span
        >
        ${subtleReset
          ? html`
              <span
                class="alisio-models__usage-pill-reset"
                title=${`${text.resetsIn} ${subtleReset}`}
              >
                ${subtleReset}
              </span>
            `
          : nothing}
      </span>
    `;
  });
}

function renderAiProfileCard(
  profile: AiProfile,
  props: {
    ai: AlisioAiState | null | undefined;
    locale: string | undefined;
    active: boolean;
    expanded: boolean;
    loading: boolean;
    onToggleExpanded: () => void;
    onSelect: () => void;
    onRefresh: () => void;
    onDisconnect: () => void;
    onRenameProfile: (profileId: string, label: string) => void;
  },
) {
  const text = aiText();
  const statusLabel =
    profile.status === "connected"
      ? text.ready
      : profile.status === "limits_unavailable"
        ? text.connectedNoLimits
        : profile.status === "connecting"
          ? text.connecting
          : profile.status === "expired"
            ? text.expired
            : text.disconnected;
  const usageWindows = resolveProfileUsageWindows(profile, props.ai, {
    allowActiveFallback: props.active,
  });
  const planLabel = resolveProfilePlanLabel(profile);
  const showEmptyRefreshHint =
    props.active &&
    usageWindows.length === 0 &&
    (profile.status === "connected" || profile.status === "limits_unavailable");

  return html`
    <article
      class="alisio-settings-ai__profile alisio-models__profile ${props.active
        ? "is-active"
        : ""} ${props.expanded ? "is-expanded" : ""}"
    >
      <button
        type="button"
        class="alisio-models__profile-toggle"
        aria-expanded=${String(props.expanded)}
        @click=${props.onToggleExpanded}
      >
        <div class="alisio-settings-ai__profile-head">
          <div>
            <div class="alisio-settings-ai__profile-title">${resolveProfileTitle(profile)}</div>
            <div class="alisio-settings-ai__profile-subtitle">
              ${renderProfileSubtitle(profile, {
                loading: props.loading,
                onRenameProfile: props.onRenameProfile,
              })}
            </div>
          </div>
          <div class="alisio-settings-ai__profile-badges">
            ${planLabel ? html`<span class="pill">${planLabel}</span>` : nothing}
            ${props.active ? html`<span class="pill">${text.active}</span>` : nothing}
            <span class="pill ${profile.status === "expired" ? "danger" : ""}">${statusLabel}</span>
            <span class="alisio-models__profile-chevron" aria-hidden="true"
              >${icons.chevronDown}</span
            >
          </div>
        </div>
        <div class="alisio-models__profile-summary">
          <span class="alisio-models__meta">
            ${text.connectedOn} ${formatConnectedAt(props.locale, profile.connectedAt)}
          </span>
          ${props.expanded ? nothing : renderUsagePreview(profile, props.ai, props.active)}
        </div>
      </button>

      ${props.expanded
        ? html`
            <div class="alisio-models__profile-body">
              ${usageWindows.length > 0
                ? html`
                    <div class="alisio-settings-ai__windows">
                      ${usageWindows.map(
                        (window) => html`
                          <div
                            class="alisio-settings-ai__window ${usageTone(window.remainingPercent)}"
                          >
                            <div class="alisio-settings-ai__window-top">
                              <span>${window.label}</span>
                              <strong>${Math.round(window.remainingPercent)}%</strong>
                            </div>
                            <div class="alisio-settings-ai__window-bar">
                              <span style=${usageBarStyle(window.remainingPercent)}></span>
                            </div>
                            <div class="alisio-settings-ai__window-meta">
                              ${text.available} · ${text.resetsIn} ${formatReset(window.resetAt)}
                            </div>
                          </div>
                        `,
                      )}
                    </div>
                  `
                : nothing}
              ${showEmptyRefreshHint
                ? html`<div class="alisio-settings-ai__empty">${text.emptyRefresh}</div>`
                : nothing}
              <div class="alisio-settings-ai__profile-actions">
                ${props.active
                  ? html`<button class="btn" disabled>${text.activeProfileButton}</button>`
                  : html`
                      <button class="btn" ?disabled=${props.loading} @click=${props.onSelect}>
                        ${text.activate}
                      </button>
                    `}
                <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
                  ${text.refresh}
                </button>
                <button class="btn danger" ?disabled=${props.loading} @click=${props.onDisconnect}>
                  ${text.remove}
                </button>
              </div>
            </div>
          `
        : nothing}
    </article>
  `;
}

function renderChatGptSection(props: {
  bootstrap: AlisioBootstrapState | null;
  aiLoading: boolean;
  aiError: string | null;
  expandedProfileId: string | null | undefined;
  profileSort: ModelsAiProfileSort | undefined;
  profileRecentIds?: readonly string[];
  onToggleProfile: (profileId: string) => void;
  onProfileSortChange: (sort: ModelsAiProfileSort) => void;
  onConnect: () => void;
  onRefreshAll: () => void;
  onSelectProfile: (profileId: string) => void;
  onDisconnectProfile: (profileId: string) => void;
  onRefreshProfile: (profileId: string) => void;
  onRenameProfile: (profileId: string, label: string) => void;
}) {
  const sectionText = modelsText();
  const text = aiText();
  const ai = props.bootstrap?.ai;
  const profiles = resolveProfiles(ai);
  const profileSort = props.profileSort ?? DEFAULT_MODELS_AI_PROFILE_SORT;
  syncInlineRenameState(profiles);
  const activeProfileId = ai?.binding ? ai.activeProfileId : undefined;
  const sortedProfiles = sortAiProfiles(
    profiles,
    ai,
    activeProfileId,
    profileSort,
    props.profileRecentIds,
  );
  const expandedProfileId =
    typeof props.expandedProfileId === "undefined"
      ? null
      : props.expandedProfileId &&
          sortedProfiles.some((profile) => profile.profileId === props.expandedProfileId)
        ? props.expandedProfileId
        : null;
  const showInitialLoading = props.aiLoading && profiles.length === 0 && !props.aiError;
  const showReloading = props.aiLoading && !showInitialLoading;

  return html`
    <article
      class="card alisio-settings-card alisio-models-section"
      aria-busy=${String(props.aiLoading)}
    >
      <div class="alisio-models-section__header">
        <div>
          <div class="card-title">${sectionText.chatgptTitle}</div>
          <div class="card-sub">${sectionText.chatgptSubtitle}</div>
        </div>
        <div class="alisio-settings-ai__actions">
          ${showInitialLoading
            ? html` ${renderSkeletonPill()} ${renderSkeletonButton()} `
            : html`
                <span class="pill"
                  >${profiles.length} ${profiles.length === 1 ? text.profile : text.profiles}</span
                >
                ${showReloading
                  ? renderSkeletonPill({
                      small: true,
                      className: "alisio-models__refresh-indicator",
                    })
                  : nothing}
                ${profiles.length > 0
                  ? html`
                      <button class="btn" ?disabled=${props.aiLoading} @click=${props.onRefreshAll}>
                        ${text.refreshAll}
                      </button>
                    `
                  : nothing}
                ${profiles.length > 1
                  ? html`
                      <label class="alisio-settings-ai__sort-control">
                        <span class="sr-only">${text.sortLabel}</span>
                        <select
                          class="alisio-settings-ai__sort-select"
                          .value=${profileSort}
                          aria-label=${text.sortLabel}
                          @change=${(event: Event) =>
                            props.onProfileSortChange(
                              (event.currentTarget as HTMLSelectElement)
                                .value as ModelsAiProfileSort,
                            )}
                        >
                          <option value="email-asc">${text.sortEmailAsc}</option>
                          <option value="recent">${text.sortRecent}</option>
                          <option value="weekly-reset-asc">${text.sortWeeklyResetAsc}</option>
                          <option value="weekly-reset-desc">${text.sortWeeklyResetDesc}</option>
                        </select>
                      </label>
                    `
                  : nothing}
                <button
                  class="btn ${profiles.length === 0 ? "primary" : ""}"
                  ?disabled=${props.aiLoading}
                  @click=${props.onConnect}
                >
                  ${profiles.length === 0 ? text.connectOpenAi : text.connectAnother}
                </button>
              `}
        </div>
      </div>

      ${props.aiError ? html`<div class="callout danger">${props.aiError}</div>` : nothing}
      ${showInitialLoading
        ? html`
            <div role="status" aria-label=${sectionText.chatgptSubtitle}>
              <div class="alisio-settings-ai__profile-list">
                ${renderAiProfileSkeleton()} ${renderAiProfileSkeleton()}
              </div>
            </div>
          `
        : profiles.length === 0
          ? renderSurfaceEmptyState({
              title: text.noProfiles,
              body: sectionText.chatgptSubtitle,
              compact: true,
              centered: true,
            })
          : html`
              <div class="alisio-settings-ai__profile-list">
                ${sortedProfiles.map((profile) =>
                  renderAiProfileCard(profile, {
                    ai,
                    locale: props.bootstrap?.account?.preferences?.language,
                    active: profile.profileId === activeProfileId,
                    expanded: profile.profileId === expandedProfileId,
                    loading: props.aiLoading,
                    onToggleExpanded: () => props.onToggleProfile(profile.profileId),
                    onSelect: () => props.onSelectProfile(profile.profileId),
                    onRefresh: () => props.onRefreshProfile(profile.profileId),
                    onDisconnect: () => props.onDisconnectProfile(profile.profileId),
                    onRenameProfile: props.onRenameProfile,
                  }),
                )}
              </div>
            `}
    </article>
  `;
}

function renderLocalModelsSection(props: {
  models: AlisioModelsState | null;
  modelsLoading: boolean;
  modelsError: string | null;
  modelOptions: readonly ChatModelOption[];
  modelOperations?: ModelsOperationMap;
  onInstallModel: (targetId: string, modelId: string) => void;
  onUpdateModel: (targetId: string, modelId: string) => void;
  onUninstallModel: (targetId: string, modelId: string) => void;
}) {
  const text = modelsText();
  const showInitialLoading = props.modelsLoading && !props.models && !props.modelsError;
  const showReloading = props.modelsLoading && !showInitialLoading;
  const targets = props.models?.targets ?? [];
  const currentTargets = resolveCurrentTargets(targets);
  const publishedModels = props.models?.catalog ?? [];
  const emptyState =
    !showInitialLoading && currentTargets.length === 0
      ? renderSurfaceEmptyState({
          title: text.noTargets,
          body: publishedModels.length === 0 ? text.noLocalModels : text.localSubtitle,
          compact: true,
          centered: true,
        })
      : !showInitialLoading && publishedModels.length === 0
        ? renderSurfaceEmptyState({
            title: text.noLocalModels,
            body: text.localSubtitle,
            compact: true,
            centered: true,
          })
        : nothing;

  return html`
    <article
      class="card alisio-settings-card alisio-models-section"
      aria-busy=${String(props.modelsLoading)}
    >
      <div class="alisio-models-section__header">
        <div>
          <div class="card-title">${text.localTitle}</div>
          <div class="card-sub">${text.localSubtitle}</div>
        </div>
        ${showInitialLoading
          ? renderSkeletonPill()
          : html`
              <div class="alisio-models__section-status">
                <span class="pill">${text.backend} · ${props.models?.backend ?? "llama.cpp"}</span>
                ${showReloading
                  ? renderSkeletonPill({
                      small: true,
                      className: "alisio-models__refresh-indicator",
                    })
                  : nothing}
              </div>
            `}
      </div>

      ${props.modelsError ? html`<div class="callout danger">${props.modelsError}</div>` : nothing}
      ${showInitialLoading
        ? html`
            <div role="status" aria-label=${text.localSubtitle}>
              <div class="alisio-models__targets">
                ${renderTargetCardSkeleton()} ${renderTargetCardSkeleton({ showCatalog: false })}
              </div>
            </div>
          `
        : nothing}

      <div class="alisio-models__targets">
        ${currentTargets
          .toSorted(
            (left, right) =>
              Number(Boolean(right.installedModels.length)) -
                Number(Boolean(left.installedModels.length)) ||
              Number(Boolean(right.supportsInstall)) - Number(Boolean(left.supportsInstall)) ||
              resolveTargetRuntimeLabel(left).localeCompare(resolveTargetRuntimeLabel(right)),
          )
          .map((target) =>
            renderTargetCard({
              target,
              installCatalog: publishedModels,
              modelOptions: props.modelOptions,
              operations: props.modelOperations,
              busy: props.modelsLoading,
              onInstallModel: props.onInstallModel,
              onUpdateModel: props.onUpdateModel,
              onUninstallModel: props.onUninstallModel,
            }),
          )}
      </div>
      ${emptyState}
    </article>
  `;
}

export function renderModelsHub(props: {
  bootstrap: AlisioBootstrapState | null;
  models: AlisioModelsState | null;
  modelsLoading: boolean;
  modelsError: string | null;
  modelOperations?: ModelsOperationMap;
  aiLoading: boolean;
  aiError: string | null;
  expandedProfileId: string | null | undefined;
  selectedProviderId: ModelProviderId | null | undefined;
  profileSort?: ModelsAiProfileSort;
  profileRecentIds?: readonly string[];
  modelOptions: readonly ChatModelOption[];
  onToggleProfile: (profileId: string) => void;
  onProfileSortChange: (sort: ModelsAiProfileSort) => void;
  onSelectProvider: (providerId: ModelProviderId) => void;
  onConnectAi: () => void;
  onRefreshAllAiProfiles: () => void;
  onSelectAiProfile: (profileId: string) => void;
  onDisconnectAiProfile: (profileId: string) => void;
  onRefreshAiProfile: (profileId: string) => void;
  onRenameAiProfile: (profileId: string, label: string) => void;
  onInstallModel: (targetId: string, modelId: string) => void;
  onUpdateModel: (targetId: string, modelId: string) => void;
  onUninstallModel: (targetId: string, modelId: string) => void;
}) {
  const text = modelsText();
  const aiTextValues = aiText();
  const profiles = resolveProfiles(props.bootstrap?.ai);
  const localTargets = props.models?.targets ?? [];
  const currentTargets = resolveCurrentTargets(localTargets);
  const localCatalog = props.models?.catalog ?? [];
  const currentTargetDisplayModels = currentTargets.flatMap((target) =>
    resolveTargetDisplayModels(target, props.modelOptions, target.chatProviderId ?? null),
  );
  const localSuggestionsCount = currentTargets.reduce(
    (total, target) =>
      total +
      (target.supportsInstall
        ? resolveTargetAvailableCatalogEntries(target, localCatalog).filter(
            (entry) => (entry.recommendation?.grade ?? "unsupported") !== "unsupported",
          ).length
        : 0),
    0,
  );
  const uniqueInstalledModels = countUniqueInstalledModels(currentTargets);
  const localDisplayModelCount = currentTargetDisplayModels.length;
  const localPrimary = resolvePrimaryLocalSummary(currentTargets, localCatalog) || text.localTitle;
  const localSecondary = currentTargets.some((target) => !target.connected)
    ? text.targetNotConnected
    : localDisplayModelCount > 0 || uniqueInstalledModels > 0
      ? currentTargets.every((target) => !target.supportsInstall)
        ? text.availableModels
        : text.installedModels
      : localSuggestionsCount > 0
        ? formatCount(localSuggestionsCount, text.suggestion, text.suggestions)
        : text.noLocalModels;
  const primaryOpenAiProfile = profiles[0] ?? null;
  const openAiPrimary = primaryOpenAiProfile
    ? resolveProfileTitle(primaryOpenAiProfile)
    : aiTextValues.noProfiles;
  const openAiSecondary = `${profiles.length} ${profiles.length === 1 ? aiTextValues.profile : aiTextValues.profiles}`;
  const openAiCardLoading = props.aiLoading && profiles.length === 0 && !props.aiError;
  const localCardLoading = props.modelsLoading && !props.models && !props.modelsError;
  const selectedProviderId =
    props.selectedProviderId === "local" || props.selectedProviderId === "openai"
      ? props.selectedProviderId
      : profiles.length > 0 || openAiCardLoading
        ? "openai"
        : currentTargets.length > 0 || localCatalog.length > 0 || localCardLoading
          ? "local"
          : "openai";

  return html`
    <section class="alisio-page alisio-models-page">
      <div class="alisio-models-layout">
        ${renderProviderPicker({
          selectedProviderId,
          cards: [
            {
              id: "openai",
              badge: "O",
              title: text.chatgptTitle,
              primary: openAiPrimary,
              secondary: openAiSecondary,
              loading: openAiCardLoading,
            },
            {
              id: "local",
              badge: "L",
              title: text.localTitle,
              primary: localPrimary,
              secondary: localSecondary,
              loading: localCardLoading,
            },
          ],
          onSelectProvider: props.onSelectProvider,
        })}
        ${selectedProviderId === "openai"
          ? renderChatGptSection({
              bootstrap: props.bootstrap,
              aiLoading: props.aiLoading,
              aiError: props.aiError,
              expandedProfileId: props.expandedProfileId,
              profileSort: props.profileSort,
              profileRecentIds: props.profileRecentIds,
              onToggleProfile: props.onToggleProfile,
              onProfileSortChange: props.onProfileSortChange,
              onConnect: props.onConnectAi,
              onRefreshAll: props.onRefreshAllAiProfiles,
              onSelectProfile: props.onSelectAiProfile,
              onDisconnectProfile: props.onDisconnectAiProfile,
              onRefreshProfile: props.onRefreshAiProfile,
              onRenameProfile: props.onRenameAiProfile,
            })
          : nothing}
        ${selectedProviderId === "local"
          ? renderLocalModelsSection({
              models: props.models,
              modelsLoading: props.modelsLoading,
              modelsError: props.modelsError,
              modelOptions: props.modelOptions,
              modelOperations: props.modelOperations,
              onInstallModel: props.onInstallModel,
              onUpdateModel: props.onUpdateModel,
              onUninstallModel: props.onUninstallModel,
            })
          : nothing}
      </div>
    </section>
  `;
}
