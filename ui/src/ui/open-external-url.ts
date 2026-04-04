const DATA_URL_PREFIX = "data:";
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "blob:"]);
const BLOCKED_DATA_IMAGE_MIME_TYPES = new Set(["image/svg+xml"]);

function isAllowedDataImageUrl(url: string): boolean {
  if (!url.toLowerCase().startsWith(DATA_URL_PREFIX)) {
    return false;
  }

  const commaIndex = url.indexOf(",");
  if (commaIndex < DATA_URL_PREFIX.length) {
    return false;
  }

  const metadata = url.slice(DATA_URL_PREFIX.length, commaIndex);
  const mimeType = metadata.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mimeType.startsWith("image/")) {
    return false;
  }

  return !BLOCKED_DATA_IMAGE_MIME_TYPES.has(mimeType);
}

function nullPopupOpener(popup: WindowProxy): void {
  try {
    popup.opener = null;
  } catch {
    // Some browser proxies expose opener as readonly; best effort only.
  }
}

function renderReservedPopupShell(popup: WindowProxy): void {
  try {
    popup.document?.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Opening authentication…</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #111111;
        color: #f3ede2;
        font: 14px/1.4 system-ui, sans-serif;
      }
      .card {
        padding: 24px 28px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 16px;
        background: rgba(255,255,255,0.04);
        box-shadow: 0 20px 60px rgba(0,0,0,0.35);
      }
      .title {
        font-size: 16px;
        font-weight: 600;
        margin: 0 0 6px;
      }
      .copy {
        margin: 0;
        color: rgba(243,237,226,0.72);
      }
    </style>
  </head>
  <body>
    <section class="card" aria-live="polite">
      <p class="title">Opening authentication…</p>
      <p class="copy">Waiting for Alisio to prepare the provider sign-in page.</p>
    </section>
  </body>
</html>`);
    popup.document?.close?.();
  } catch {
    // Cross-window shells are best effort only.
  }
}

export type ResolveSafeExternalUrlOptions = {
  allowDataImage?: boolean;
};

export function resolveSafeExternalUrl(
  rawUrl: string,
  baseHref: string,
  opts: ResolveSafeExternalUrlOptions = {},
): string | null {
  const candidate = rawUrl.trim();
  if (!candidate) {
    return null;
  }

  if (opts.allowDataImage === true && isAllowedDataImageUrl(candidate)) {
    return candidate;
  }

  if (candidate.toLowerCase().startsWith(DATA_URL_PREFIX)) {
    return null;
  }

  try {
    const parsed = new URL(candidate, baseHref);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol.toLowerCase()) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export type OpenExternalUrlSafeOptions = ResolveSafeExternalUrlOptions & {
  baseHref?: string;
};

export function reserveExternalPopup(): WindowProxy | null {
  const opened = window.open("about:blank", "_blank", "popup,width=520,height=720");
  if (opened) {
    renderReservedPopupShell(opened);
    nullPopupOpener(opened);
  }
  return opened;
}

export function navigateReservedExternalPopup(
  popup: WindowProxy | null,
  rawUrl: string,
  opts: OpenExternalUrlSafeOptions = {},
): boolean {
  if (!popup) {
    return false;
  }
  const baseHref = opts.baseHref ?? window.location.href;
  const safeUrl = resolveSafeExternalUrl(rawUrl, baseHref, opts);
  if (!safeUrl) {
    return false;
  }
  try {
    if (typeof popup.location.replace === "function") {
      popup.location.replace(safeUrl);
    } else {
      popup.location.href = safeUrl;
    }
    return true;
  } catch {
    return false;
  }
}

export function closeReservedExternalPopup(popup: WindowProxy | null): void {
  try {
    popup?.close?.();
  } catch {
    // Best effort only.
  }
}

export function openExternalUrlSafe(
  rawUrl: string,
  opts: OpenExternalUrlSafeOptions = {},
): WindowProxy | null {
  const baseHref = opts.baseHref ?? window.location.href;
  const safeUrl = resolveSafeExternalUrl(rawUrl, baseHref, opts);
  if (!safeUrl) {
    return null;
  }

  const opened = window.open(safeUrl, "_blank", "noopener,noreferrer");
  if (opened) {
    nullPopupOpener(opened);
  }
  return opened;
}
