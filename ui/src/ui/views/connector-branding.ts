import { normalizeBasePath } from "../base-path.ts";

type BrandDefinition = {
  asset: string;
  accent: string;
  surface: string;
  border: string;
};

export type ConnectorBranding = {
  logoUrl: string;
  accent: string;
  surface: string;
  border: string;
};

function defineBrand(params: BrandDefinition): BrandDefinition {
  return params;
}

function brandAssetUrl(asset: string): string {
  const relative = `brand-icons/${asset}`;
  if (typeof window === "undefined") {
    return relative;
  }
  const configured = window.__ALISIO_CONTROL_UI_BASE_PATH__;
  if (typeof configured === "string" && configured.trim()) {
    const base = normalizeBasePath(configured);
    return base ? `${base}/${relative}` : relative;
  }
  return relative;
}

function resolveBranding(definition: BrandDefinition): ConnectorBranding {
  return {
    logoUrl: brandAssetUrl(definition.asset),
    accent: definition.accent,
    surface: definition.surface,
    border: definition.border,
  };
}

const CONNECTOR_BRANDING: Record<string, BrandDefinition> = {
  google: defineBrand({
    asset: "google.svg",
    accent: "#4285F4",
    surface: "rgba(66, 133, 244, 0.16)",
    border: "rgba(66, 133, 244, 0.28)",
  }),
  facebook: defineBrand({
    asset: "facebook.png",
    accent: "#1877F2",
    surface: "rgba(24, 119, 242, 0.16)",
    border: "rgba(24, 119, 242, 0.28)",
  }),
  instagram: defineBrand({
    asset: "instagram.png",
    accent: "#E4405F",
    surface: "rgba(228, 64, 95, 0.16)",
    border: "rgba(228, 64, 95, 0.28)",
  }),
  x: defineBrand({
    asset: "x.png",
    accent: "#E7E7E7",
    surface: "rgba(255, 255, 255, 0.08)",
    border: "rgba(255, 255, 255, 0.14)",
  }),
  tiktok: defineBrand({
    asset: "tiktok.png",
    accent: "#111111",
    surface: "rgba(17, 17, 17, 0.18)",
    border: "rgba(17, 17, 17, 0.28)",
  }),
  linkedin: defineBrand({
    asset: "linkedin.png",
    accent: "#0A66C2",
    surface: "rgba(10, 102, 194, 0.16)",
    border: "rgba(10, 102, 194, 0.28)",
  }),
  pinterest: defineBrand({
    asset: "pinterest.png",
    accent: "#E60023",
    surface: "rgba(230, 0, 35, 0.16)",
    border: "rgba(230, 0, 35, 0.28)",
  }),
  reddit: defineBrand({
    asset: "reddit.png",
    accent: "#FF4500",
    surface: "rgba(255, 69, 0, 0.16)",
    border: "rgba(255, 69, 0, 0.28)",
  }),
  "google-docs": defineBrand({
    asset: "google-docs.svg",
    accent: "#4285F4",
    surface: "rgba(66, 133, 244, 0.16)",
    border: "rgba(66, 133, 244, 0.28)",
  }),
  "google-sheets": defineBrand({
    asset: "google-sheets.svg",
    accent: "#34A853",
    surface: "rgba(52, 168, 83, 0.16)",
    border: "rgba(52, 168, 83, 0.28)",
  }),
  "google-forms": defineBrand({
    asset: "google-forms.svg",
    accent: "#7248B9",
    surface: "rgba(114, 72, 185, 0.16)",
    border: "rgba(114, 72, 185, 0.28)",
  }),
  "google-slides": defineBrand({
    asset: "google-slides.svg",
    accent: "#FBBC04",
    surface: "rgba(251, 188, 4, 0.16)",
    border: "rgba(251, 188, 4, 0.28)",
  }),
  youtube: defineBrand({
    asset: "youtube.png",
    accent: "#FF0000",
    surface: "rgba(255, 0, 0, 0.16)",
    border: "rgba(255, 0, 0, 0.28)",
  }),
  "gmail-read": defineBrand({
    asset: "gmail.svg",
    accent: "#EA4335",
    surface: "rgba(234, 67, 53, 0.16)",
    border: "rgba(234, 67, 53, 0.28)",
  }),
  "gmail-modify": defineBrand({
    asset: "gmail.svg",
    accent: "#EA4335",
    surface: "rgba(234, 67, 53, 0.16)",
    border: "rgba(234, 67, 53, 0.28)",
  }),
  "gmail-send": defineBrand({
    asset: "gmail.svg",
    accent: "#EA4335",
    surface: "rgba(234, 67, 53, 0.16)",
    border: "rgba(234, 67, 53, 0.28)",
  }),
  "google-calendar": defineBrand({
    asset: "google-calendar.svg",
    accent: "#4285F4",
    surface: "rgba(66, 133, 244, 0.16)",
    border: "rgba(66, 133, 244, 0.28)",
  }),
  "google-drive": defineBrand({
    asset: "google-drive.svg",
    accent: "#34A853",
    surface: "rgba(52, 168, 83, 0.16)",
    border: "rgba(52, 168, 83, 0.28)",
  }),
  "google-analytics": defineBrand({
    asset: "google-analytics.png",
    accent: "#E37400",
    surface: "rgba(227, 116, 0, 0.16)",
    border: "rgba(227, 116, 0, 0.28)",
  }),
  notion: defineBrand({
    asset: "notion.png",
    accent: "#E7E7E7",
    surface: "rgba(255, 255, 255, 0.08)",
    border: "rgba(255, 255, 255, 0.14)",
  }),
  github: defineBrand({
    asset: "github.png",
    accent: "#E7E7E7",
    surface: "rgba(255, 255, 255, 0.08)",
    border: "rgba(255, 255, 255, 0.14)",
  }),
  slack: defineBrand({
    asset: "slack.png",
    accent: "#4A154B",
    surface: "rgba(74, 21, 75, 0.16)",
    border: "rgba(74, 21, 75, 0.28)",
  }),
  freshdesk: defineBrand({
    asset: "freshdesk.png",
    accent: "#22C55E",
    surface: "rgba(34, 197, 94, 0.16)",
    border: "rgba(34, 197, 94, 0.28)",
  }),
  vercel: defineBrand({
    asset: "vercel.png",
    accent: "#E7E7E7",
    surface: "rgba(255, 255, 255, 0.08)",
    border: "rgba(255, 255, 255, 0.14)",
  }),
};

const PROVIDER_BRANDING: Record<string, BrandDefinition> = {
  google: CONNECTOR_BRANDING.google,
  meta: CONNECTOR_BRANDING.facebook,
  github: CONNECTOR_BRANDING.github,
  notion: CONNECTOR_BRANDING.notion,
  vercel: CONNECTOR_BRANDING.vercel,
  linkedin: CONNECTOR_BRANDING.linkedin,
  pinterest: CONNECTOR_BRANDING.pinterest,
  tiktok: CONNECTOR_BRANDING.tiktok,
  x: CONNECTOR_BRANDING.x,
  slack: CONNECTOR_BRANDING.slack,
  reddit: CONNECTOR_BRANDING.reddit,
};

const CHANNEL_BRANDING: Record<string, BrandDefinition> = {
  whatsapp: defineBrand({
    asset: "whatsapp.png",
    accent: "#25D366",
    surface: "rgba(37, 211, 102, 0.16)",
    border: "rgba(37, 211, 102, 0.28)",
  }),
  telegram: defineBrand({
    asset: "telegram.svg",
    accent: "#229ED9",
    surface: "rgba(34, 158, 217, 0.16)",
    border: "rgba(34, 158, 217, 0.28)",
  }),
  discord: defineBrand({
    asset: "discord.png",
    accent: "#5865F2",
    surface: "rgba(88, 101, 242, 0.16)",
    border: "rgba(88, 101, 242, 0.28)",
  }),
  googlechat: defineBrand({
    asset: "google-chat.svg",
    accent: "#34A853",
    surface: "rgba(52, 168, 83, 0.16)",
    border: "rgba(52, 168, 83, 0.28)",
  }),
  slack: CONNECTOR_BRANDING.slack,
  signal: defineBrand({
    asset: "signal.svg",
    accent: "#3A76F0",
    surface: "rgba(58, 118, 240, 0.16)",
    border: "rgba(58, 118, 240, 0.28)",
  }),
  imessage: defineBrand({
    asset: "imessage.png",
    accent: "#34C759",
    surface: "rgba(52, 199, 89, 0.16)",
    border: "rgba(52, 199, 89, 0.28)",
  }),
  line: defineBrand({
    asset: "line.png",
    accent: "#06C755",
    surface: "rgba(6, 199, 85, 0.16)",
    border: "rgba(6, 199, 85, 0.28)",
  }),
};

export function getConnectorBranding(
  connectorId: string,
  providerLabel: string,
): ConnectorBranding {
  const definition =
    CONNECTOR_BRANDING[connectorId] ?? PROVIDER_BRANDING[providerLabel.trim().toLowerCase()];
  if (!definition) {
    throw new Error(`Missing connector branding for ${connectorId}`);
  }
  return resolveBranding(definition);
}

export function getConnectorActionBranding(
  connectorId: string,
  providerLabel: string,
): ConnectorBranding {
  const provider = providerLabel.trim().toLowerCase();
  if (provider === "google") {
    return resolveBranding(CONNECTOR_BRANDING.google);
  }
  return getConnectorBranding(connectorId, providerLabel);
}

export function getChannelBranding(channelId: string): ConnectorBranding | null {
  const definition = CHANNEL_BRANDING[channelId];
  return definition ? resolveBranding(definition) : null;
}

export function connectorBrandStyle(branding: ConnectorBranding): string {
  return [
    `--connector-accent:${branding.accent}`,
    `--connector-surface:${branding.surface}`,
    `--connector-border:${branding.border}`,
  ].join(";");
}
