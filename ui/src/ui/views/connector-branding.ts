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
    logoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/LinkedIn_icon.svg",
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
    logoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Slack_Logo_Icon.svg",
    accent: "#4A154B",
    surface: "rgba(74, 21, 75, 0.16)",
    border: "rgba(74, 21, 75, 0.28)",
  },
  freshdesk: {
    logoUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Freshworks-vector-logo.svg",
    accent: "#2EB67D",
    surface: "rgba(46, 182, 125, 0.16)",
    border: "rgba(46, 182, 125, 0.28)",
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
  const branding =
    CONNECTOR_BRANDING[connectorId] ?? PROVIDER_BRANDING[providerLabel.trim().toLowerCase()];
  if (!branding) {
    throw new Error(`Missing connector branding for ${connectorId}`);
  }
  return branding;
}

export function connectorBrandStyle(branding: ConnectorBranding): string {
  return [
    `--connector-accent:${branding.accent}`,
    `--connector-surface:${branding.surface}`,
    `--connector-border:${branding.border}`,
  ].join(";");
}
