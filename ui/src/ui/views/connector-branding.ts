type ConnectorBranding = {
  logoUrl: string;
  accent: string;
  surface: string;
  border: string;
};

const CONNECTOR_BRANDING: Record<string, ConnectorBranding> = {
  facebook: {
    logoUrl: "https://cdn.simpleicons.org/facebook/1877F2",
    accent: "#1877F2",
    surface: "rgba(24, 119, 242, 0.16)",
    border: "rgba(24, 119, 242, 0.28)",
  },
  instagram: {
    logoUrl: "https://cdn.simpleicons.org/instagram/E4405F",
    accent: "#E4405F",
    surface: "rgba(228, 64, 95, 0.16)",
    border: "rgba(228, 64, 95, 0.28)",
  },
  x: {
    logoUrl: "https://cdn.simpleicons.org/x/FFFFFF",
    accent: "#E7E7E7",
    surface: "rgba(255, 255, 255, 0.08)",
    border: "rgba(255, 255, 255, 0.14)",
  },
  tiktok: {
    logoUrl: "https://cdn.simpleicons.org/tiktok/FFFFFF",
    accent: "#FFFFFF",
    surface: "rgba(255, 255, 255, 0.08)",
    border: "rgba(255, 255, 255, 0.14)",
  },
  linkedin: {
    logoUrl: "https://cdn.simpleicons.org/linkedin/0A66C2",
    accent: "#0A66C2",
    surface: "rgba(10, 102, 194, 0.16)",
    border: "rgba(10, 102, 194, 0.28)",
  },
  pinterest: {
    logoUrl: "https://cdn.simpleicons.org/pinterest/BD081C",
    accent: "#BD081C",
    surface: "rgba(189, 8, 28, 0.16)",
    border: "rgba(189, 8, 28, 0.28)",
  },
  reddit: {
    logoUrl: "https://cdn.simpleicons.org/reddit/FF4500",
    accent: "#FF4500",
    surface: "rgba(255, 69, 0, 0.16)",
    border: "rgba(255, 69, 0, 0.28)",
  },
  "google-docs": {
    logoUrl: "https://cdn.simpleicons.org/googledocs/4285F4",
    accent: "#4285F4",
    surface: "rgba(66, 133, 244, 0.16)",
    border: "rgba(66, 133, 244, 0.28)",
  },
  "google-sheets": {
    logoUrl: "https://cdn.simpleicons.org/googlesheets/34A853",
    accent: "#34A853",
    surface: "rgba(52, 168, 83, 0.16)",
    border: "rgba(52, 168, 83, 0.28)",
  },
  "google-forms": {
    logoUrl: "https://cdn.simpleicons.org/googleforms/7248B9",
    accent: "#7248B9",
    surface: "rgba(114, 72, 185, 0.16)",
    border: "rgba(114, 72, 185, 0.28)",
  },
  "google-slides": {
    logoUrl: "https://cdn.simpleicons.org/googleslides/FBBC04",
    accent: "#FBBC04",
    surface: "rgba(251, 188, 4, 0.16)",
    border: "rgba(251, 188, 4, 0.28)",
  },
  youtube: {
    logoUrl: "https://cdn.simpleicons.org/youtube/FF0000",
    accent: "#FF0000",
    surface: "rgba(255, 0, 0, 0.16)",
    border: "rgba(255, 0, 0, 0.28)",
  },
  "gmail-read": {
    logoUrl: "https://cdn.simpleicons.org/gmail/EA4335",
    accent: "#EA4335",
    surface: "rgba(234, 67, 53, 0.16)",
    border: "rgba(234, 67, 53, 0.28)",
  },
  "gmail-modify": {
    logoUrl: "https://cdn.simpleicons.org/gmail/EA4335",
    accent: "#EA4335",
    surface: "rgba(234, 67, 53, 0.16)",
    border: "rgba(234, 67, 53, 0.28)",
  },
  "gmail-send": {
    logoUrl: "https://cdn.simpleicons.org/gmail/EA4335",
    accent: "#EA4335",
    surface: "rgba(234, 67, 53, 0.16)",
    border: "rgba(234, 67, 53, 0.28)",
  },
  "google-calendar": {
    logoUrl: "https://cdn.simpleicons.org/googlecalendar/4285F4",
    accent: "#4285F4",
    surface: "rgba(66, 133, 244, 0.16)",
    border: "rgba(66, 133, 244, 0.28)",
  },
  "google-drive": {
    logoUrl: "https://cdn.simpleicons.org/googledrive/34A853",
    accent: "#34A853",
    surface: "rgba(52, 168, 83, 0.16)",
    border: "rgba(52, 168, 83, 0.28)",
  },
  "google-analytics": {
    logoUrl: "https://cdn.simpleicons.org/googleanalytics/E37400",
    accent: "#E37400",
    surface: "rgba(227, 116, 0, 0.16)",
    border: "rgba(227, 116, 0, 0.28)",
  },
  notion: {
    logoUrl: "https://cdn.simpleicons.org/notion/FFFFFF",
    accent: "#FFFFFF",
    surface: "rgba(255, 255, 255, 0.08)",
    border: "rgba(255, 255, 255, 0.14)",
  },
  github: {
    logoUrl: "https://cdn.simpleicons.org/github/FFFFFF",
    accent: "#FFFFFF",
    surface: "rgba(255, 255, 255, 0.08)",
    border: "rgba(255, 255, 255, 0.14)",
  },
  slack: {
    logoUrl: "https://cdn.simpleicons.org/slack/FFFFFF",
    accent: "#FFFFFF",
    surface: "rgba(255, 255, 255, 0.08)",
    border: "rgba(255, 255, 255, 0.14)",
  },
  freshdesk: {
    logoUrl: "https://cdn.simpleicons.org/freshworks/49C556",
    accent: "#49C556",
    surface: "rgba(73, 197, 86, 0.16)",
    border: "rgba(73, 197, 86, 0.28)",
  },
  vercel: {
    logoUrl: "https://cdn.simpleicons.org/vercel/FFFFFF",
    accent: "#FFFFFF",
    surface: "rgba(255, 255, 255, 0.08)",
    border: "rgba(255, 255, 255, 0.14)",
  },
};

const PROVIDER_BRANDING: Record<string, ConnectorBranding> = {
  google: CONNECTOR_BRANDING["google-docs"],
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

export function getConnectorBranding(
  connectorId: string,
  providerLabel: string,
): ConnectorBranding {
  return (
    CONNECTOR_BRANDING[connectorId] ??
    PROVIDER_BRANDING[providerLabel.trim().toLowerCase()] ?? {
      logoUrl: "",
      accent: "#d4a574",
      surface: "rgba(212, 165, 116, 0.14)",
      border: "rgba(212, 165, 116, 0.24)",
    }
  );
}

export function connectorBrandStyle(branding: ConnectorBranding): string {
  return [
    `--connector-accent:${branding.accent}`,
    `--connector-surface:${branding.surface}`,
    `--connector-border:${branding.border}`,
  ].join(";");
}

export function connectorFallbackMonogram(title: string): string {
  const words = title
    .split(/[\s/+-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  if (words.length === 1) {
    return words[0].slice(0, 1).toUpperCase();
  }
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}
