import os from "node:os";

export type AlisioGpuBackend = "metal" | "cuda" | "vulkan" | "cpu";

export type AlisioModelHardwareProfile = {
  platform: NodeJS.Platform;
  architecture: string;
  totalMemoryGb: number;
  cpuCores: number;
  cpuArch?: string;
  ramTotalGb?: number;
  ramFreeGb?: number;
  vramTotalGb?: number;
  vramFreeGb?: number;
  vramUnifiedGb?: number;
  gpuBackend?: AlisioGpuBackend;
  gpuDevices?: string[];
  cpuFlags?: string[];
};

export type AlisioModelRecommendationGrade = "recommended" | "works" | "slow" | "unsupported";

export type AlisioModelRecommendation = {
  modelId: string;
  grade: AlisioModelRecommendationGrade;
  label: string;
  reason: string;
};

type RecommenderCatalogEntry = {
  id: string;
  name: string;
  memoryGb: number;
  parametersBillions: number;
  vramGb?: number;
};

type RuntimeHardwareProbe = {
  gpuBackend?: string | false;
  gpuDevices?: string[];
  systemInfo?: string;
  vram?: {
    total: number;
    free: number;
    unifiedSize: number;
  };
};

function roundGb(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Number((value / 1024 ** 3).toFixed(1));
}

function normalizeGpuBackend(value: string | false | undefined): AlisioGpuBackend | undefined {
  if (value === false) {
    return "cpu";
  }
  if (value === "metal" || value === "cuda" || value === "vulkan") {
    return value;
  }
  return undefined;
}

function parseSystemInfoFlags(systemInfo: string | undefined): string[] | undefined {
  const normalized = systemInfo?.trim();
  if (!normalized) {
    return undefined;
  }
  const flags = normalized
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const colonIndex = part.indexOf(":");
      const candidate = colonIndex >= 0 ? part.slice(colonIndex + 1).trim() : part;
      const match = candidate.match(/^([A-Z0-9_]+)\s*=\s*(\d+)$/i);
      if (!match || match[2] !== "1") {
        return [];
      }
      return [match[1]];
    });
  return flags.length > 0 ? [...new Set(flags)] : undefined;
}

export function inspectLocalModelHardwareProfile(): AlisioModelHardwareProfile {
  const totalMemoryGb = Number((os.totalmem() / 1024 ** 3).toFixed(1));
  const ramFreeGb = Number((os.freemem() / 1024 ** 3).toFixed(1));
  return {
    platform: process.platform,
    architecture: process.arch,
    totalMemoryGb,
    cpuCores: os.cpus().length,
    cpuArch: process.arch,
    ramTotalGb: totalMemoryGb,
    ramFreeGb,
  };
}

export function enrichLocalModelHardwareProfile(
  profile: AlisioModelHardwareProfile,
  probe: RuntimeHardwareProbe,
): AlisioModelHardwareProfile {
  const vramTotalGb = roundGb(probe.vram?.total);
  const vramFreeGb = roundGb(probe.vram?.free);
  const vramUnifiedGb = roundGb(probe.vram?.unifiedSize);
  const gpuDevices = probe.gpuDevices?.filter((value) => value.trim()).map((value) => value.trim());
  return {
    ...profile,
    cpuArch: profile.cpuArch ?? profile.architecture,
    ramTotalGb: profile.ramTotalGb ?? profile.totalMemoryGb,
    gpuBackend: normalizeGpuBackend(probe.gpuBackend) ?? profile.gpuBackend,
    vramTotalGb: vramTotalGb ?? profile.vramTotalGb,
    vramFreeGb: vramFreeGb ?? profile.vramFreeGb,
    vramUnifiedGb: vramUnifiedGb ?? profile.vramUnifiedGb,
    gpuDevices: gpuDevices && gpuDevices.length > 0 ? gpuDevices : profile.gpuDevices,
    cpuFlags: parseSystemInfoFlags(probe.systemInfo) ?? profile.cpuFlags,
  };
}

function resolveMemoryHeadroom(profile: AlisioModelHardwareProfile, requiredGb: number) {
  if (requiredGb <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return (profile.ramTotalGb ?? profile.totalMemoryGb) / requiredGb;
}

function resolveCpuHeadroom(profile: AlisioModelHardwareProfile, parametersBillions: number) {
  if (parametersBillions <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const divisor = parametersBillions >= 30 ? 4 : parametersBillions >= 8 ? 2 : 1;
  return profile.cpuCores / divisor;
}

function resolveVramHeadroom(profile: AlisioModelHardwareProfile, requiredGb?: number) {
  if (!requiredGb || requiredGb <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const availableGb = Math.max(profile.vramUnifiedGb ?? 0, profile.vramTotalGb ?? 0);
  if (availableGb <= 0) {
    return null;
  }
  return availableGb / requiredGb;
}

function formatRequiredResources(entry: RecommenderCatalogEntry) {
  const parts = [`~${entry.memoryGb} GB RAM`];
  if (typeof entry.vramGb === "number" && Number.isFinite(entry.vramGb) && entry.vramGb > 0) {
    parts.push(`~${entry.vramGb} GB VRAM`);
  }
  return parts.join(" / ");
}

function formatAvailableResources(profile: AlisioModelHardwareProfile) {
  const parts = [`${profile.ramTotalGb ?? profile.totalMemoryGb} GB RAM`];
  const effectiveVram = Math.max(profile.vramUnifiedGb ?? 0, profile.vramTotalGb ?? 0);
  if (effectiveVram > 0) {
    parts.push(`${effectiveVram} GB VRAM`);
  }
  return parts.join(" / ");
}

export function recommendModelForHardware(
  profile: AlisioModelHardwareProfile,
  entry: RecommenderCatalogEntry,
): AlisioModelRecommendation {
  const memoryHeadroom = resolveMemoryHeadroom(profile, entry.memoryGb);
  const cpuHeadroom = resolveCpuHeadroom(profile, entry.parametersBillions);
  const vramHeadroom = resolveVramHeadroom(profile, entry.vramGb);
  const requiredResources = formatRequiredResources(entry);
  const availableResources = formatAvailableResources(profile);

  if (memoryHeadroom < 0.85 || cpuHeadroom < 1) {
    return {
      modelId: entry.id,
      grade: "unsupported",
      label: "Not recommended",
      reason: `${entry.name} needs about ${requiredResources}. This computer currently has ${availableResources}.`,
    };
  }

  if (memoryHeadroom >= 1.5 && cpuHeadroom >= 4 && (vramHeadroom == null || vramHeadroom >= 1)) {
    return {
      modelId: entry.id,
      grade: "recommended",
      label: "Recommended",
      reason: `${entry.name} needs about ${requiredResources}. This computer has ${availableResources}, so it should run comfortably.`,
    };
  }

  if (memoryHeadroom >= 1.1 && cpuHeadroom >= 2 && (vramHeadroom == null || vramHeadroom >= 0.75)) {
    return {
      modelId: entry.id,
      grade: "works",
      label: "Works well",
      reason: `${entry.name} needs about ${requiredResources}. This computer should run it reliably.`,
    };
  }

  if (memoryHeadroom >= 0.85 && cpuHeadroom >= 1) {
    const vramNote =
      vramHeadroom != null && vramHeadroom < 0.75
        ? " VRAM is tight, so expect more CPU offloading."
        : "";
    return {
      modelId: entry.id,
      grade: "slow",
      label: "May be slow",
      reason: `${entry.name} needs about ${requiredResources}. It should work here, but expect slower responses or less headroom.${vramNote}`,
    };
  }

  return {
    modelId: entry.id,
    grade: "unsupported",
    label: "Not recommended",
    reason: `${entry.name} needs about ${requiredResources}. This computer currently has ${availableResources}.`,
  };
}

export function summarizeHardwareRecommendation(
  profile: AlisioModelHardwareProfile,
  catalog: readonly RecommenderCatalogEntry[],
) {
  const ranked = catalog
    .map((entry) => ({
      entry,
      recommendation: recommendModelForHardware(profile, entry),
    }))
    .toSorted((left, right) => {
      const gradeScore = {
        recommended: 4,
        works: 3,
        slow: 2,
        unsupported: 1,
      } as const;
      const gradeDiff =
        gradeScore[right.recommendation.grade] - gradeScore[left.recommendation.grade];
      if (gradeDiff !== 0) {
        return gradeDiff;
      }
      return right.entry.parametersBillions - left.entry.parametersBillions;
    });

  return {
    profile,
    recommendations: ranked.map((item) => item.recommendation),
    bestModel: ranked.find((item) => item.recommendation.grade !== "unsupported")?.entry ?? null,
  };
}
