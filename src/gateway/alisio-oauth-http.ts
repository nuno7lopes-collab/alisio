import type { IncomingMessage, ServerResponse } from "node:http";
import { AlisioAccountCloudError } from "../infra/alisio-account-cloud.js";
import { AlisioAiError } from "../infra/alisio-ai.js";
import {
  completeAlisioAccountGoogleAuthFromCallback,
  completeAlisioAiConnect,
  completeAlisioConnectorAuthorizationFromCallback,
} from "../infra/alisio-store.js";
import {
  buildAlisioAccountAuthCompletionScript,
  buildAlisioAccountAuthSignal,
} from "../shared/alisio-account-auth.js";
import {
  buildAlisioConnectorOAuthCompletionScript,
  buildAlisioConnectorOAuthSignal,
} from "../shared/alisio-connector-oauth.js";
import {
  buildAlisioOpenAiOAuthCompletionScript,
  buildAlisioOpenAiOAuthSignal,
} from "../shared/alisio-openai-oauth.js";

type SupportedProvider = "google" | "github" | "openai" | "account-google";
type HtmlTone = "success" | "error";

type HtmlDetail = {
  label: string;
  value: string;
};

type HtmlRenderOptions = {
  tone?: HtmlTone;
  eyebrow?: string;
  details?: HtmlDetail[];
  hint?: string;
};

function resolveProviderFromPath(pathname: string): SupportedProvider | null {
  if (pathname === "/oauth/google/callback") {
    return "google";
  }
  if (pathname === "/oauth/github/callback") {
    return "github";
  }
  if (pathname === "/__alisio/auth/openai/callback") {
    return "openai";
  }
  if (pathname === "/__alisio/auth/account/callback") {
    return "account-google";
  }
  return null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatProviderLabel(provider: SupportedProvider): string {
  switch (provider) {
    case "account-google":
      return "Google";
    case "github":
      return "GitHub";
    case "google":
      return "Google";
    case "openai":
      return "OpenAI";
  }
}

function sendHtml(
  res: ServerResponse,
  status: number,
  title: string,
  message: string,
  extraHeadNodes: string[] = [],
  options: HtmlRenderOptions = {},
) {
  const tone = options.tone ?? (status >= 400 ? "error" : "success");
  const safeEyebrow = escapeHtml(
    options.eyebrow ?? (tone === "error" ? "Connection failed" : "Connection completed"),
  );
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const safeHint = escapeHtml(options.hint ?? "You can close this window and return to Alisio.");
  const safeDetails = (options.details ?? [])
    .map(
      (detail) =>
        `<div class="detail"><dt>${escapeHtml(detail.label)}</dt><dd>${escapeHtml(detail.value)}</dd></div>`,
    )
    .join("");
  const statusLabel = tone === "error" ? "Action needed" : "Connected";
  const statusMessage =
    tone === "error"
      ? "Alisio could not finish this connection."
      : "Alisio finished the connection and already signaled the app.";
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    ${extraHeadNodes.join("\n")}
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b0e13;
        --bg-elevated: rgba(16, 20, 28, 0.88);
        --panel: rgba(14, 18, 26, 0.92);
        --panel-border: rgba(240, 181, 111, 0.16);
        --text: #f5f7fb;
        --muted: rgba(219, 226, 237, 0.76);
        --accent: #f0b56f;
        --accent-strong: #f7c98c;
        --accent-shadow: rgba(240, 181, 111, 0.22);
        --success-bg: rgba(240, 181, 111, 0.12);
        --success-border: rgba(240, 181, 111, 0.24);
        --error-bg: rgba(239, 68, 68, 0.12);
        --error-border: rgba(239, 68, 68, 0.24);
        --shadow: 0 28px 90px rgba(0, 0, 0, 0.42);
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px 18px;
        background:
          radial-gradient(circle at top, rgba(240, 181, 111, 0.18), transparent 34%),
          radial-gradient(circle at bottom left, rgba(73, 99, 160, 0.18), transparent 28%),
          linear-gradient(180deg, #0d1016 0%, var(--bg) 100%);
        color: var(--text);
        font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body::before {
        content: "";
        position: fixed;
        inset: 0;
        background-image:
          linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
        background-size: 40px 40px;
        mask-image: radial-gradient(circle at center, black 24%, transparent 82%);
        pointer-events: none;
      }
      main {
        position: relative;
        width: min(640px, 100%);
      }
      .card {
        position: relative;
        overflow: hidden;
        padding: 30px;
        border: 1px solid var(--panel-border);
        border-radius: 24px;
        background:
          linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 24%),
          var(--panel);
        box-shadow: var(--shadow);
        backdrop-filter: blur(14px);
      }
      .card::after {
        content: "";
        position: absolute;
        inset: -80px auto auto -80px;
        width: 220px;
        height: 220px;
        border-radius: 999px;
        background: radial-gradient(circle, var(--accent-shadow), transparent 70%);
        pointer-events: none;
      }
      .header {
        display: flex;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 20px;
      }
      .brand-mark {
        display: grid;
        place-items: center;
        width: 48px;
        height: 48px;
        border-radius: 14px;
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: #1b140d;
        font-size: 22px;
        font-weight: 700;
        box-shadow: 0 10px 30px var(--accent-shadow);
      }
      .eyebrow {
        display: inline-block;
        margin-bottom: 8px;
        color: var(--accent);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0;
        font-size: clamp(28px, 4vw, 38px);
        line-height: 1.05;
        letter-spacing: -0.03em;
      }
      .message {
        margin: 0 0 22px;
        max-width: 52ch;
        color: var(--muted);
        font-size: 17px;
      }
      .status {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 18px;
        padding: 16px 18px;
        border: 1px solid ${tone === "error" ? "var(--error-border)" : "var(--success-border)"};
        border-radius: 18px;
        background: ${tone === "error" ? "var(--error-bg)" : "var(--success-bg)"};
      }
      .status-label {
        display: inline-block;
        margin-bottom: 4px;
        font-size: 13px;
        font-weight: 700;
      }
      .status-copy {
        margin: 0;
        color: var(--muted);
        font-size: 14px;
      }
      .status-dot {
        width: 12px;
        height: 12px;
        margin-top: 4px;
        border-radius: 999px;
        background: ${tone === "error" ? "#ef4444" : "var(--accent)"};
        box-shadow: 0 0 0 6px ${tone === "error" ? "rgba(239, 68, 68, 0.14)" : "rgba(240, 181, 111, 0.14)"};
        flex: 0 0 auto;
      }
      .details {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin: 0 0 18px;
        padding: 0;
      }
      .detail {
        padding: 14px 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 16px;
        background: var(--bg-elevated);
      }
      dt {
        margin: 0 0 6px;
        color: rgba(219, 226, 237, 0.62);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }
      dd {
        margin: 0;
        color: var(--text);
        font-size: 15px;
        font-weight: 600;
        word-break: break-word;
      }
      .hint {
        margin: 0;
        color: rgba(219, 226, 237, 0.62);
        font-size: 14px;
      }
      @media (max-width: 640px) {
        body {
          padding: 18px;
        }
        .card {
          padding: 22px;
          border-radius: 20px;
        }
        .header {
          flex-direction: column;
          gap: 14px;
        }
        .details {
          grid-template-columns: 1fr;
        }
        .status {
          flex-direction: column-reverse;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="card">
        <div class="header">
          <div class="brand-mark">A</div>
          <div>
            <div class="eyebrow">${safeEyebrow}</div>
            <h1>${safeTitle}</h1>
          </div>
        </div>
        <p class="message">${safeMessage}</p>
        <div class="status">
          <div>
            <span class="status-label">${statusLabel}</span>
            <p class="status-copy">${statusMessage}</p>
          </div>
          <span class="status-dot" aria-hidden="true"></span>
        </div>
        ${safeDetails ? `<dl class="details">${safeDetails}</dl>` : ""}
        <p class="hint">${safeHint}</p>
      </section>
    </main>
  </body>
</html>`);
}

export async function handleAlisioOAuthHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  const url = new URL(req.url ?? "/", "http://localhost");
  const provider = resolveProviderFromPath(url.pathname);
  if (!provider) {
    return false;
  }
  if (method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return true;
  }

  if (provider === "openai") {
    try {
      const result = await completeAlisioAiConnect(
        {
          stateToken: url.searchParams.get("state"),
          code: url.searchParams.get("code"),
          error: url.searchParams.get("error"),
          errorDescription: url.searchParams.get("error_description"),
        },
        env,
        fetchImpl,
      );
      const label = result.email ?? "your OpenAI account";
      sendHtml(
        res,
        200,
        "Alisio is connected to OpenAI",
        `OpenAI is now connected for ${label}. You can return to Alisio.`,
        [
          `<script>${buildAlisioOpenAiOAuthCompletionScript(buildAlisioOpenAiOAuthSignal())}</script>`,
        ],
        {
          eyebrow: "OpenAI OAuth",
          details: [
            { label: "Provider", value: "OpenAI" },
            { label: "Account", value: label },
          ],
        },
      );
      return true;
    } catch (error) {
      const message =
        error instanceof AlisioAiError ? error.message : "OpenAI could not be connected.";
      sendHtml(res, 400, "Alisio could not connect OpenAI", message, [], {
        tone: "error",
        eyebrow: "OpenAI OAuth",
        details: [{ label: "Provider", value: "OpenAI" }],
      });
      return true;
    }
  }

  if (provider === "account-google") {
    try {
      await completeAlisioAccountGoogleAuthFromCallback(
        {
          stateToken: url.searchParams.get("account_state"),
          code: url.searchParams.get("code"),
          error: url.searchParams.get("error"),
          errorDescription: url.searchParams.get("error_description"),
        },
        env,
        fetchImpl,
      );
      sendHtml(
        res,
        200,
        "Alisio account connected",
        "Your Google account is now connected to Alisio. You can return to Alisio.",
        [
          `<script>${buildAlisioAccountAuthCompletionScript(
            buildAlisioAccountAuthSignal("google"),
          )}</script>`,
        ],
        {
          eyebrow: "Account setup",
          details: [
            { label: "Provider", value: "Google" },
            { label: "Destination", value: "Alisio account" },
          ],
        },
      );
      return true;
    } catch (error) {
      const message = error instanceof AlisioAccountCloudError ? error.message : String(error);
      sendHtml(res, 400, "Alisio account connection failed", message, [], {
        tone: "error",
        eyebrow: "Account setup",
        details: [{ label: "Provider", value: "Google" }],
      });
      return true;
    }
  }

  const result = await completeAlisioConnectorAuthorizationFromCallback(
    {
      provider,
      stateToken: url.searchParams.get("state"),
      code: url.searchParams.get("code"),
      error: url.searchParams.get("error"),
      errorDescription: url.searchParams.get("error_description"),
    },
    env,
    fetchImpl,
  );
  if (!result.ok) {
    sendHtml(res, 400, "Alisio connection failed", result.message, [], {
      tone: "error",
      eyebrow: `${formatProviderLabel(provider)} OAuth`,
      details: [{ label: "Provider", value: formatProviderLabel(provider) }],
    });
    return true;
  }

  const accountLabel =
    result.authorization.connectedAccount?.email ??
    result.authorization.connectedAccount?.label ??
    result.authorization.connectorId;
  sendHtml(
    res,
    200,
    "Alisio connection completed",
    `${result.authorization.connectorId} is now connected for ${accountLabel}. You can return to Alisio.`,
    [
      `<script>${buildAlisioConnectorOAuthCompletionScript(
        buildAlisioConnectorOAuthSignal({
          connectorId: result.authorization.connectorId,
          provider,
        }),
      )}</script>`,
    ],
    {
      eyebrow: `${formatProviderLabel(provider)} OAuth`,
      details: [
        { label: "Connector", value: result.authorization.connectorId },
        { label: "Account", value: accountLabel },
      ],
    },
  );
  return true;
}
