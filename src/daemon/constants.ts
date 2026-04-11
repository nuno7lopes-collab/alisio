// Default service labels for canonical Alisio services.
export const GATEWAY_LAUNCH_AGENT_LABEL = "ai.alisio.gateway";
export const GATEWAY_SYSTEMD_SERVICE_NAME = "alisio-gateway";
export const GATEWAY_WINDOWS_TASK_NAME = "Alisio Gateway";
export const GATEWAY_SERVICE_MARKER = "alisio";
export const GATEWAY_SERVICE_KIND = "gateway";
export const NODE_LAUNCH_AGENT_LABEL = "ai.alisio.node";
export const NODE_SYSTEMD_SERVICE_NAME = "alisio-node";
export const NODE_WINDOWS_TASK_NAME = "Alisio Node";
export const NODE_SERVICE_MARKER = "alisio";
export const NODE_SERVICE_KIND = "node";
export const NODE_WINDOWS_TASK_SCRIPT_NAME = "node.cmd";
export const LEGACY_GATEWAY_LAUNCH_AGENT_LABELS: string[] = [];
export const LEGACY_GATEWAY_SYSTEMD_SERVICE_NAMES: string[] = [];
export const LEGACY_GATEWAY_WINDOWS_TASK_NAMES: string[] = [];

export function normalizeGatewayProfile(profile?: string): string | null {
  const trimmed = profile?.trim();
  if (!trimmed || trimmed.toLowerCase() === "default") {
    return null;
  }
  return trimmed;
}

export function resolveGatewayProfileSuffix(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  return normalized ? `-${normalized}` : "";
}

export function resolveGatewayLaunchAgentLabel(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return GATEWAY_LAUNCH_AGENT_LABEL;
  }
  return `ai.alisio.${normalized}`;
}

export function resolveLegacyGatewayLaunchAgentLabels(profile?: string): string[] {
  void profile;
  return LEGACY_GATEWAY_LAUNCH_AGENT_LABELS;
}

export function resolveGatewaySystemdServiceName(profile?: string): string {
  const suffix = resolveGatewayProfileSuffix(profile);
  if (!suffix) {
    return GATEWAY_SYSTEMD_SERVICE_NAME;
  }
  return `alisio-gateway${suffix}`;
}

export function resolveGatewayWindowsTaskName(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  if (!normalized) {
    return GATEWAY_WINDOWS_TASK_NAME;
  }
  return `Alisio Gateway (${normalized})`;
}

export function formatGatewayServiceDescription(params?: {
  profile?: string;
  version?: string;
}): string {
  const profile = normalizeGatewayProfile(params?.profile);
  const version = params?.version?.trim();
  const parts: string[] = [];
  if (profile) {
    parts.push(`profile: ${profile}`);
  }
  if (version) {
    parts.push(`v${version}`);
  }
  if (parts.length === 0) {
    return "Alisio Gateway";
  }
  return `Alisio Gateway (${parts.join(", ")})`;
}

export function resolveGatewayServiceDescription(params: {
  env: Record<string, string | undefined>;
  environment?: Record<string, string | undefined>;
  description?: string;
}): string {
  const profile = params.env.ALISIO_PROFILE;
  const environmentVersion =
    params.environment?.ALISIO_SERVICE_VERSION ?? params.env.ALISIO_SERVICE_VERSION;
  return (
    params.description ??
    formatGatewayServiceDescription({
      profile,
      version: environmentVersion,
    })
  );
}

export function resolveNodeLaunchAgentLabel(): string {
  return NODE_LAUNCH_AGENT_LABEL;
}

export function resolveNodeSystemdServiceName(): string {
  return NODE_SYSTEMD_SERVICE_NAME;
}

export function resolveNodeWindowsTaskName(): string {
  return NODE_WINDOWS_TASK_NAME;
}

export function formatNodeServiceDescription(params?: { version?: string }): string {
  const version = params?.version?.trim();
  if (!version) {
    return "Alisio Node Host";
  }
  return `Alisio Node Host (v${version})`;
}
