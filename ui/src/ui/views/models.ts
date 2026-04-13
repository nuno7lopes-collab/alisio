import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import {
  makeModelsOperationKey,
  type ModelProviderId,
  type ModelsOperationMap,
} from "../models-view-types.ts";
import type { AlisioAiState, AlisioBootstrapState, AlisioModelsState } from "../types.ts";
import {
  renderSkeletonButton,
  renderSkeletonLines,
  renderSkeletonListItem,
  renderSkeletonPill,
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
    ownedBy: t("alisio.settings.models.ownedBy"),
    recommendedUpTo: t("alisio.settings.models.recommendedUpTo"),
    memory: t("alisio.settings.models.memory"),
    disk: t("alisio.settings.models.disk"),
    defaultModel: t("alisio.settings.models.defaultModel"),
    chooseModel: t("alisio.settings.models.chooseModel"),
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

function formatHardwareSummary(target: LocalModelTarget) {
  const text = modelsText();
  if (!target.hardware) {
    return null;
  }
  return `${text.hardware} · ${target.hardware.totalMemoryGb} GB RAM · ${target.hardware.cpuCores} CPU`;
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

function resolveTargetRecommendationLabel(target: LocalModelTarget) {
  const text = modelsText();
  if (!target.bestModelName) {
    return null;
  }
  return `${text.recommendedUpTo} ${target.bestModelName}`;
}

function resolveModelRecommendation(
  target: LocalModelTarget,
  modelId: string,
): LocalModelTarget["recommendations"][number] | null {
  return target.recommendations.find((entry) => entry.modelId === modelId) ?? null;
}

function isOpenAiModelValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("openai-codex/") || normalized.startsWith("openai/");
}

function resolveOpenAiModelOptions(options: readonly ChatModelOption[]) {
  return options.filter((entry) => isOpenAiModelValue(entry.value));
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

function splitTargets(targets: readonly LocalModelTarget[]) {
  const currentTargets = targets.filter((target) => target.current);
  const linkedTargets = targets.filter((target) => !target.current);
  return {
    currentTargets,
    linkedTargets,
    currentTarget: currentTargets[0] ?? null,
  };
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

function resolveTargetModelsLabel(target: LocalModelTarget) {
  const text = modelsText();
  return target.supportsInstall ? text.installedModels : text.availableModels;
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
      } => Boolean(entry.recommendation && entry.recommendation.grade !== "unsupported"),
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
        diskGb: model.diskGb,
        recommendation: model.recommendation ?? resolveModelRecommendation(target, model.id),
      }))
      .filter((entry) => !entry.recommendation || entry.recommendation.grade !== "unsupported")
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
    diskGb: model.diskGb,
    recommendation: resolveModelRecommendation(target, model.id),
  }));
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
  const progressLabel =
    operation.action === "uninstall"
      ? text.uninstalling
      : progressPercent > 0
        ? `${text.installing} ${progressPercent}%`
        : text.installing;
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

function resolveCatalogEntryById(catalog: readonly TargetCatalogEntryView[], modelId: string) {
  const normalizedId = modelId.trim().toLowerCase();
  return catalog.find((entry) => entry.id.trim().toLowerCase() === normalizedId) ?? null;
}

function resolveInstalledModelDetail(entry: TargetCatalogEntryView | null) {
  if (!entry) {
    return "";
  }
  const parts = [
    typeof entry.parametersBillions === "number" ? `${entry.parametersBillions}B` : "",
    entry.quantization ?? "",
    entry.summary ?? "",
  ].filter(Boolean);
  return parts.join(" · ");
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
              <div class="list-sub">
                ${resolveInstalledModelDetail(catalogEntry) || text.installed}
              </div>
              ${model.running ? html`<div class="list-sub">${text.running}</div>` : nothing}
            </div>
            <div class="alisio-models__model-actions">
              ${props.onUpdateModel
                ? html`
                    <button
                      class="btn"
                      ?disabled=${busy}
                      @click=${() => props.onUpdateModel?.(props.target.targetId, model.id)}
                    >
                      ${operation?.action === "install" ? text.updating : text.update}
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
              <div class="list-title">${model.name}</div>
              ${model.summary ? html`<div class="list-sub">${model.summary}</div>` : nothing}
              <div class="alisio-models__model-facts">
                ${typeof model.parametersBillions === "number"
                  ? html`<span class="pill">${model.parametersBillions}B</span>`
                  : nothing}
                ${model.quantization
                  ? html`<span class="pill">${model.quantization}</span>`
                  : nothing}
                ${typeof model.memoryGb === "number"
                  ? html`<span class="pill">${text.memory} ${model.memoryGb} GB</span>`
                  : nothing}
                ${typeof model.diskGb === "number"
                  ? html`<span class="pill">${text.disk} ${model.diskGb} GB</span>`
                  : nothing}
              </div>
              ${recommendation
                ? html`<div class="list-sub">
                    ${recommendation.label} · ${recommendation.reason}
                  </div>`
                : nothing}
            </div>
            <div class="alisio-models__catalog-actions">
              <button
                class="btn primary"
                ?disabled=${props.busy || !props.target.connected || installBusy}
                @click=${() => props.onInstallModel(props.target.targetId, model.id)}
                title=${recommendation?.reason ?? ""}
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
  const targetManageCatalog = props.installCatalog
    ? resolveTargetAvailableCatalogEntries(props.target, props.installCatalog)
    : [];
  const hasInstallableCatalog = targetManageCatalog.length > 0;
  const statusLabel = !props.target.connected
    ? text.targetNotConnected
    : props.target.runtimeStatus === "ready"
      ? text.modelSourceReady
      : props.target.runtimeStatus === "not_configured"
        ? text.runtimeNotConfigured
        : text.runtimeError;
  const statusDetail = resolveTargetStatusDetail(props.target);
  const runtimeMessage =
    props.target.runtimeMessage && !isGenericRuntimeMessage(props.target.runtimeMessage)
      ? props.target.runtimeMessage
      : "";
  const title = props.target.current ? text.currentComputer : props.target.label;
  const subtitle = [
    resolveTargetRuntimeLabel(props.target),
    formatPlatformLabel(props.target.platform),
  ]
    .filter(Boolean)
    .join(" · ");
  return html`
    <div
      class="alisio-models__target ${props.target.current ? "is-current" : ""} ${!props.target
        .connected || props.target.runtimeStatus === "error"
        ? "is-error"
        : props.target.runtimeStatus === "ready"
          ? "is-ready"
          : ""}"
    >
      <div class="alisio-models__target-head">
        <div>
          <div class="list-title">${title}</div>
          <div class="list-sub">${subtitle}</div>
        </div>
        <div class="alisio-settings-ai__profile-badges">
          <span class="pill">${resolveTargetRuntimeLabel(props.target)}</span>
          ${props.target.current ? html`<span class="pill">${text.activeComputer}</span>` : nothing}
          ${props.target.access === "shared"
            ? html`<span class="pill">${text.readOnlyTarget}</span>`
            : nothing}
          ${!props.target.current && props.target.ownerLabel
            ? html`<span class="pill">${text.sharedTarget}</span>`
            : nothing}
          ${props.target.connected ? html`<span class="pill">${text.connected}</span>` : nothing}
        </div>
      </div>
      <div class="alisio-models__target-meta">
        <span
          class=${props.target.connected && props.target.runtimeStatus === "ready"
            ? "alisio-models__status is-ready"
            : "alisio-models__status"}
        >
          ${statusLabel}
        </span>
        ${!props.target.current && props.target.ownerLabel
          ? html`<span class="alisio-models__status"
              >${text.ownedBy.replace("{owner}", props.target.ownerLabel)}</span
            >`
          : nothing}
        ${formatHardwareSummary(props.target)
          ? html`<span class="alisio-models__status">${formatHardwareSummary(props.target)}</span>`
          : nothing}
      </div>
      ${statusDetail ? html`<div class="list-sub">${statusDetail}</div>` : nothing}
      ${runtimeMessage ? html`<div class="list-sub">${runtimeMessage}</div>` : nothing}
      ${resolveTargetRecommendationLabel(props.target)
        ? html`<div class="list-sub">${resolveTargetRecommendationLabel(props.target)}</div>`
        : nothing}
      <div class="alisio-models__installed">
        <div class="alisio-models__installed-title">${resolveTargetModelsLabel(props.target)}</div>
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
      hasInstallableCatalog
        ? html`
            <div class="alisio-models__installed">
              <div class="alisio-models__installed-title">${text.recommendedToInstall}</div>
              ${renderTargetCatalog({
                target: props.target,
                catalog: targetManageCatalog,
                operations: props.operations,
                busy: props.busy ?? false,
                onInstallModel: props.onInstallModel,
              })}
            </div>
          `
        : nothing}
    </div>
  `;
}

function renderOpenAiModelChooser(props: {
  modelOptions: readonly ChatModelOption[];
  defaultChatModelValue: string;
  defaultChatModelDisplay: string;
  defaultChatModelLabel: string;
  busy: boolean;
  onSelectDefaultModel: (value: string) => void;
}) {
  const text = modelsText();
  const openAiOptions = resolveOpenAiModelOptions(props.modelOptions);
  const defaultModelLabel = isOpenAiModelValue(props.defaultChatModelValue)
    ? props.defaultChatModelDisplay || props.defaultChatModelLabel
    : text.chooseModel;

  return html`
    <section class="alisio-models__chooser">
      <div class="alisio-models__chooser-head">
        <div class="alisio-models__chooser-title">${text.defaultModel}</div>
        <div class="list-sub">${defaultModelLabel}</div>
      </div>
      ${openAiOptions.length === 0
        ? html`<div class="list-sub">${text.noModelChoices}</div>`
        : html`
            <div class="alisio-models__model-chips">
              ${openAiOptions.map(
                (option) => html`
                  <button
                    class="alisio-models__model-chip ${option.value === props.defaultChatModelValue
                      ? "is-active"
                      : ""}"
                    ?disabled=${props.busy}
                    @click=${() => props.onSelectDefaultModel(option.value)}
                  >
                    ${option.label}
                  </button>
                `,
              )}
            </div>
          `}
    </section>
  `;
}

function renderProviderPicker(props: {
  selectedProviderId: ModelProviderId;
  loading: boolean;
  openAiTitle: string;
  openAiPrimary: string;
  openAiSecondary: string;
  localTitle: string;
  localPrimary: string;
  localSecondary: string;
  onSelectProvider: (providerId: ModelProviderId) => void;
}) {
  const cards: Array<{
    id: ModelProviderId;
    badge: string;
    title: string;
    primary: string;
    secondary: string;
  }> = [
    {
      id: "openai",
      badge: "O",
      title: props.openAiTitle,
      primary: props.openAiPrimary,
      secondary: props.openAiSecondary,
    },
    {
      id: "local",
      badge: "L",
      title: props.localTitle,
      primary: props.localPrimary,
      secondary: props.localSecondary,
    },
  ];

  return html`
    <div class="alisio-models__provider-grid">
      ${cards.map(
        (card) => html`
          <button
            type="button"
            class="alisio-models__provider-card ${props.selectedProviderId === card.id
              ? "is-selected"
              : ""}"
            ?disabled=${props.loading}
            @click=${() => props.onSelectProvider(card.id)}
            aria-pressed=${String(props.selectedProviderId === card.id)}
          >
            <span class="alisio-models__provider-badge">${card.badge}</span>
            <span class="alisio-models__provider-copy">
              <span class="alisio-models__provider-title">${card.title}</span>
              ${props.loading
                ? renderSkeletonLines(["medium", "short"], { compact: true })
                : html`
                    <span class="alisio-models__provider-primary">${card.primary}</span>
                    <span class="alisio-models__provider-secondary">${card.secondary}</span>
                  `}
            </span>
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
  return windows.map(
    (window) => html`
      <span class="alisio-models__usage-pill ${usageTone(window.remainingPercent)}">
        ${window.label} · ${Math.round(window.remainingPercent)}% ${text.available}
      </span>
    `,
  );
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
  modelOptions: readonly ChatModelOption[];
  defaultChatModelValue: string;
  defaultChatModelDisplay: string;
  defaultChatModelLabel: string;
  modelPickerBusy: boolean;
  onSelectDefaultModel: (value: string) => void;
  onToggleProfile: (profileId: string) => void;
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
  const activeProfileId = ai?.binding ? ai.activeProfileId : undefined;
  const expandedProfileId =
    typeof props.expandedProfileId === "undefined"
      ? (activeProfileId ?? profiles[0]?.profileId ?? null)
      : props.expandedProfileId &&
          profiles.some((profile) => profile.profileId === props.expandedProfileId)
        ? props.expandedProfileId
        : null;
  const showInitialLoading = props.aiLoading && profiles.length === 0 && !props.aiError;
  const showModelChooser = showInitialLoading || profiles.length > 0;

  return html`
    <article class="card alisio-settings-card alisio-models-section">
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
                ${profiles.length > 0
                  ? html`
                      <button class="btn" ?disabled=${props.aiLoading} @click=${props.onRefreshAll}>
                        ${text.refreshAll}
                      </button>
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
      ${showModelChooser
        ? renderOpenAiModelChooser({
            modelOptions: props.modelOptions,
            defaultChatModelValue: props.defaultChatModelValue,
            defaultChatModelDisplay: props.defaultChatModelDisplay,
            defaultChatModelLabel: props.defaultChatModelLabel,
            busy: props.modelPickerBusy,
            onSelectDefaultModel: props.onSelectDefaultModel,
          })
        : nothing}
      ${showInitialLoading
        ? html`
            <div role="status" aria-label=${sectionText.chatgptSubtitle}>
              <div class="loading-state__list">
                ${renderSkeletonListItem({ lines: ["medium", "long", "short"], aside: "button" })}
                ${renderSkeletonListItem({ lines: ["short", "medium", "long"], aside: "button" })}
              </div>
            </div>
          `
        : profiles.length === 0
          ? html`<div class="alisio-settings-ai__empty">${text.noProfiles}</div>`
          : html`
              <div class="alisio-settings-ai__profile-list">
                ${profiles.map((profile) =>
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
  const targets = props.models?.targets ?? [];
  const { currentTargets } = splitTargets(targets);
  const publishedModels = props.models?.catalog ?? [];

  return html`
    <article class="card alisio-settings-card alisio-models-section">
      <div class="alisio-models-section__header">
        <div>
          <div class="card-title">${text.localTitle}</div>
          <div class="card-sub">${text.localSubtitle}</div>
        </div>
        ${showInitialLoading
          ? renderSkeletonPill()
          : html`<span class="pill"
              >${text.backend} · ${props.models?.backend ?? "llama.cpp"}</span
            >`}
      </div>

      ${props.modelsError ? html`<div class="callout danger">${props.modelsError}</div>` : nothing}
      ${showInitialLoading
        ? html`
            <div role="status" aria-label=${text.localSubtitle}>
              <div class="loading-state__list">
                ${renderSkeletonListItem({ lines: ["medium", "long", "short"] })}
                ${renderSkeletonListItem({ lines: ["short", "medium", "long"] })}
                ${renderSkeletonListItem({ lines: ["long", "medium", "short"], aside: "button" })}
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

      ${!showInitialLoading && currentTargets.length === 0
        ? html`<div class="alisio-settings-ai__empty">${text.noTargets}</div>`
        : nothing}
      ${!showInitialLoading && publishedModels.length === 0
        ? html`<div class="alisio-settings-ai__empty">${text.noLocalModels}</div>`
        : nothing}
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
  modelOptions: readonly ChatModelOption[];
  defaultChatModelValue: string;
  defaultChatModelDisplay: string;
  defaultChatModelLabel: string;
  modelPickerBusy: boolean;
  onToggleProfile: (profileId: string) => void;
  onSelectProvider: (providerId: ModelProviderId) => void;
  onConnectAi: () => void;
  onRefreshAllAiProfiles: () => void;
  onSelectDefaultChatModel: (value: string) => void;
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
  const { currentTargets } = splitTargets(localTargets);
  const localCatalog = props.models?.catalog ?? [];
  const currentTargetDisplayModels = currentTargets.flatMap((target) =>
    resolveTargetDisplayModels(target, props.modelOptions, target.chatProviderId ?? null),
  );
  const localSuggestionsCount = currentTargets.reduce(
    (total, target) =>
      total +
      (target.supportsInstall
        ? resolveTargetAvailableCatalogEntries(target, localCatalog).length
        : 0),
    0,
  );
  const providerPickerLoading =
    (props.aiLoading && profiles.length === 0) || (props.modelsLoading && !props.models);
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
  const openAiPrimary =
    profiles.length > 0 && isOpenAiModelValue(props.defaultChatModelValue)
      ? props.defaultChatModelDisplay || props.defaultChatModelLabel
      : primaryOpenAiProfile
        ? resolveProfileTitle(primaryOpenAiProfile)
        : aiTextValues.noProfiles;
  const openAiSecondary = `${profiles.length} ${profiles.length === 1 ? aiTextValues.profile : aiTextValues.profiles}`;
  const selectedProviderId =
    props.selectedProviderId === "local" || props.selectedProviderId === "openai"
      ? props.selectedProviderId
      : providerPickerLoading
        ? "openai"
        : profiles.length > 0
          ? "openai"
          : currentTargets.length > 0 || localCatalog.length > 0
            ? "local"
            : "openai";

  return html`
    <section class="alisio-page alisio-models-page">
      <div class="alisio-models-layout">
        ${renderProviderPicker({
          selectedProviderId,
          loading: providerPickerLoading,
          openAiTitle: text.chatgptTitle,
          openAiPrimary,
          openAiSecondary,
          localTitle: text.localTitle,
          localPrimary,
          localSecondary,
          onSelectProvider: props.onSelectProvider,
        })}
        ${selectedProviderId === "openai"
          ? renderChatGptSection({
              bootstrap: props.bootstrap,
              aiLoading: props.aiLoading,
              aiError: props.aiError,
              expandedProfileId: props.expandedProfileId,
              modelOptions: props.modelOptions,
              defaultChatModelValue: props.defaultChatModelValue,
              defaultChatModelDisplay: props.defaultChatModelDisplay,
              defaultChatModelLabel: props.defaultChatModelLabel,
              modelPickerBusy: props.modelPickerBusy,
              onSelectDefaultModel: props.onSelectDefaultChatModel,
              onToggleProfile: props.onToggleProfile,
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
