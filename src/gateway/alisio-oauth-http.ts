import type { IncomingMessage, ServerResponse } from "node:http";
import { AlisioAiError } from "../infra/alisio-ai.js";
import {
  completeAlisioAiConnect,
  completeAlisioConnectorAuthorizationFromCallback,
} from "../infra/alisio-store.js";

type SupportedProvider = "google" | "github" | "openai";

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

function sendHtml(res: ServerResponse, status: number, title: string, message: string) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #111217;
        color: #f3f5f8;
        font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(560px, calc(100vw - 32px));
        padding: 28px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 18px;
        background: rgba(18, 20, 28, 0.96);
        box-shadow: 0 18px 60px rgba(0,0,0,0.28);
      }
      h1 { margin: 0 0 10px; font-size: 22px; }
      p { margin: 0; color: rgba(243,245,248,0.78); }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
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
      );
      return true;
    } catch (error) {
      const message =
        error instanceof AlisioAiError ? error.message : "OpenAI could not be connected.";
      sendHtml(res, 400, "Alisio could not connect OpenAI", message);
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
    sendHtml(res, 400, "Alisio connection failed", result.message);
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
  );
  return true;
}
