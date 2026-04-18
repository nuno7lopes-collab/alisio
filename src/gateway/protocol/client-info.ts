export const GATEWAY_CLIENT_IDS = {
  WEBCHAT_UI: "webchat-ui",
  CONTROL_UI: "alisio-control-ui",
  TUI: "alisio-tui",
  WEBCHAT: "webchat",
  CLI: "cli",
  GATEWAY_CLIENT: "gateway-client",
  MACOS_APP: "alisio-macos",
  NODE_HOST: "node-host",
  TEST: "test",
  FINGERPRINT: "fingerprint",
  PROBE: "alisio-probe",
} as const;

export type GatewayClientId = (typeof GATEWAY_CLIENT_IDS)[keyof typeof GATEWAY_CLIENT_IDS];
export const LEGACY_GATEWAY_CLIENT_ID_ALIASES = {
  "alisio-control-ui": GATEWAY_CLIENT_IDS.CONTROL_UI,
  "alisio-tui": GATEWAY_CLIENT_IDS.TUI,
  "alisio-probe": GATEWAY_CLIENT_IDS.PROBE,
  "alisio-macos": GATEWAY_CLIENT_IDS.MACOS_APP,
} as const;
export type LegacyGatewayClientId = keyof typeof LEGACY_GATEWAY_CLIENT_ID_ALIASES;
export type AcceptedGatewayClientId = GatewayClientId | LegacyGatewayClientId;

// Keep stale clients working across the Alisio -> Alisio client-id rename.
const LEGACY_GATEWAY_CLIENT_ID_SET = new Set<LegacyGatewayClientId>(
  Object.keys(LEGACY_GATEWAY_CLIENT_ID_ALIASES) as LegacyGatewayClientId[],
);
export const ACCEPTED_GATEWAY_CLIENT_ID_VALUES = [
  ...Object.values(GATEWAY_CLIENT_IDS),
  ...Object.keys(LEGACY_GATEWAY_CLIENT_ID_ALIASES),
];
const LEGACY_GATEWAY_CLIENT_ID_ALIAS_MAP: Record<string, GatewayClientId> = {
  ...LEGACY_GATEWAY_CLIENT_ID_ALIASES,
};

// Back-compat naming (internal): these values are IDs, not display names.
export const GATEWAY_CLIENT_NAMES = GATEWAY_CLIENT_IDS;
export type GatewayClientName = GatewayClientId;

export const GATEWAY_CLIENT_MODES = {
  WEBCHAT: "webchat",
  CLI: "cli",
  UI: "ui",
  BACKEND: "backend",
  NODE: "node",
  PROBE: "probe",
  TEST: "test",
} as const;

export type GatewayClientMode = (typeof GATEWAY_CLIENT_MODES)[keyof typeof GATEWAY_CLIENT_MODES];

export type GatewayClientInfo = {
  id: GatewayClientId;
  displayName?: string;
  version: string;
  platform: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  mode: GatewayClientMode;
  instanceId?: string;
};

export const GATEWAY_CLIENT_CAPS = {
  TOOL_EVENTS: "tool-events",
} as const;

export type GatewayClientCap = (typeof GATEWAY_CLIENT_CAPS)[keyof typeof GATEWAY_CLIENT_CAPS];

const GATEWAY_CLIENT_ID_SET = new Set<GatewayClientId>(Object.values(GATEWAY_CLIENT_IDS));
const GATEWAY_CLIENT_MODE_SET = new Set<GatewayClientMode>(Object.values(GATEWAY_CLIENT_MODES));

export function normalizeGatewayClientId(raw?: string | null): GatewayClientId | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (LEGACY_GATEWAY_CLIENT_ID_SET.has(normalized as LegacyGatewayClientId)) {
    return LEGACY_GATEWAY_CLIENT_ID_ALIAS_MAP[normalized];
  }
  return GATEWAY_CLIENT_ID_SET.has(normalized as GatewayClientId)
    ? (normalized as GatewayClientId)
    : undefined;
}

export function normalizeGatewayClientName(raw?: string | null): GatewayClientName | undefined {
  return normalizeGatewayClientId(raw);
}

export function normalizeGatewayClientMode(raw?: string | null): GatewayClientMode | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return GATEWAY_CLIENT_MODE_SET.has(normalized as GatewayClientMode)
    ? (normalized as GatewayClientMode)
    : undefined;
}

export function hasGatewayClientCap(
  caps: string[] | null | undefined,
  cap: GatewayClientCap,
): boolean {
  if (!Array.isArray(caps)) {
    return false;
  }
  return caps.includes(cap);
}
