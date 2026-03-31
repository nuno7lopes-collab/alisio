import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import { loadAuthProfileStoreForRuntime } from "../../../src/agents/auth-profiles.ts";
import {
  bindWorkerAiCredential,
  connectOpenAICodexCredential,
  rebuildAiAccountState,
  resolveBoundWorkerAiCredential,
} from "./ai-accounts.js";
import { runChatTurn, buildTranscript, type ChatEngineDeps } from "./chat-engine.js";
import { renderOpenAICodexLaunchPage } from "./oauth-launch-page.js";
import { buildOpenAICodexSettingsPatch, OpenAICodexOAuthManager } from "./openai-codex-oauth.js";
import { createMockSession, DesktopWorkerStorage, mergeSettings } from "./storage.js";
import { invokeToolAlias } from "./tool-aliases.js";
import {
  DEFAULT_WORKER_PORT,
  DESKTOP_BRAND_NAME,
  type InvokeAliasParams,
  type PersistedDesktopState,
  type WorkerRuntimeState,
  type WorkerServerHandle,
  type WorkerServerOptions,
  type WorkerStatus,
} from "./types.js";

const RegisterBodySchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
});

const SettingsBodySchema = z.object({
  provider: z.enum(["openai", "openai-codex"]).optional(),
  openAiApiKey: z.string().optional().default(""),
  model: z.string().trim().min(1).optional(),
});

const ChatBodySchema = z.object({
  content: z.string().trim().min(1),
});

const AliasBodySchema = z.object({
  alias: z.literal("system.whoami"),
  input: z.record(z.string(), z.unknown()).optional(),
});

const OAuthManualBodySchema = z.object({
  value: z.string().trim().min(1),
});

const RuntimeBindingBodySchema = z.object({
  workerAiCredentialId: z.string().uuid(),
});

type OAuthSnapshotReader = Pick<OpenAICodexOAuthManager, "getSnapshot">;
type OAuthManagerLike = Pick<OpenAICodexOAuthManager, "getSnapshot" | "start" | "submitManual">;

type WorkerServerDeps = ChatEngineDeps & {
  invokeToolAlias?: typeof invokeToolAlias;
  oauth?: OAuthManagerLike;
};

function resolveEffectiveSettings(
  current: PersistedDesktopState,
  oauth: OAuthSnapshotReader,
): PersistedDesktopState["settings"] & { openAiCodexAuthProfileId?: string } {
  const boundCredential = resolveBoundWorkerAiCredential(current);
  const snapshot = oauth.getSnapshot({
    preferredAuthProfileId: boundCredential?.authProfileId,
  });
  if (
    current.settings.provider === "openai" &&
    !current.settings.openAiApiKey &&
    (boundCredential?.authProfileId || snapshot.profileId)
  ) {
    return {
      ...current.settings,
      provider: "openai-codex",
      openAiCodexAuthProfileId: boundCredential?.authProfileId ?? snapshot.profileId,
    };
  }
  if (current.settings.provider === "openai-codex") {
    return {
      ...current.settings,
      openAiCodexAuthProfileId: boundCredential?.authProfileId ?? snapshot.profileId,
    };
  }
  return current.settings;
}

function syncStateWithRuntime(
  current: PersistedDesktopState,
  oauth: OAuthSnapshotReader,
): PersistedDesktopState {
  let next = rebuildAiAccountState(current, loadAuthProfileStoreForRuntime());
  const boundCredential = resolveBoundWorkerAiCredential(next);
  if (boundCredential || next.settings.provider !== "openai-codex" || !next.session) {
    return next;
  }
  const snapshot = oauth.getSnapshot();
  if (!snapshot.connected || !snapshot.profileId) {
    return next;
  }
  next = connectOpenAICodexCredential({
    state: next,
    authProfileId: snapshot.profileId,
    email: snapshot.email,
    accountId: snapshot.accountId,
    reason: "legacy_profile_adopted",
  });
  return rebuildAiAccountState(next, loadAuthProfileStoreForRuntime());
}

function serializeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function renderPreviewHtml(preview: {
  status: WorkerStatus;
  initialState: {
    session: PersistedDesktopState["session"];
    settings: {
      provider: PersistedDesktopState["settings"]["provider"];
      model: string;
      hasOpenAiApiKey: boolean;
      oauth: ReturnType<OpenAICodexOAuthManager["getSnapshot"]>;
      runtimeBinding: PersistedDesktopState["runtimeBinding"];
      aiProfiles: PersistedDesktopState["aiProfiles"];
      workerAiCredentials: PersistedDesktopState["workerAiCredentials"];
    };
    transcript: ReturnType<typeof buildTranscript>;
  };
}): string {
  const { status } = preview;
  const initialStateJson = serializeInlineJson({
    status,
    session: preview.initialState.session,
    settings: preview.initialState.settings,
    transcript: preview.initialState.transcript,
  });
  return `<!doctype html>
<html lang="pt-PT">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${DESKTOP_BRAND_NAME} Preview</title>
  <style>
    :root {
      color-scheme: light;
      --bg-a: #f6f4ef;
      --bg-b: #f3f1ec;
      --bg-c: #eeebe4;
      --surface: rgba(255, 255, 255, 0.72);
      --surface-strong: rgba(255, 255, 255, 0.88);
      --surface-soft: rgba(255, 255, 255, 0.62);
      --line: rgba(15, 23, 42, 0.08);
      --line-soft: rgba(15, 23, 42, 0.10);
      --ink: #16181d;
      --ink-soft: rgba(22, 24, 29, 0.58);
      --accent: #2f5bea;
      --accent-2: #215b52;
      --ok: #215b52;
      --warn: #9b6a1c;
      --danger: #bf4b39;
      --shadow: 0 14px 34px rgba(15, 23, 42, 0.05);
      --radius-xl: 22px;
      --radius-lg: 18px;
      --radius-md: 14px;
      --radius-pill: 999px;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: "Manrope", "Avenir Next", "Segoe UI", ui-sans-serif, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(47, 91, 234, 0.07), transparent 22%),
        radial-gradient(circle at 88% 16%, rgba(33, 91, 82, 0.06), transparent 18%),
        linear-gradient(135deg, var(--bg-a), var(--bg-b) 52%, var(--bg-c));
      overflow: hidden;
    }
    h1, h2, h3, p { margin: 0; }
    button, input, textarea {
      font: inherit;
    }
    .app-shell {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      gap: 16px;
      height: 100vh;
      padding: 16px;
    }
    .glass {
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(255, 255, 255, 0.92));
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    .sidebar {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 18px;
      border-radius: var(--radius-xl);
      overflow: auto;
      min-height: 0;
    }
    .sidebar::-webkit-scrollbar,
    .tab-page::-webkit-scrollbar,
    .messages::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    .sidebar::-webkit-scrollbar-thumb,
    .tab-page::-webkit-scrollbar-thumb,
    .messages::-webkit-scrollbar-thumb {
      background: rgba(52, 120, 246, 0.44);
      border-radius: var(--radius-pill);
    }
    .sidebar::-webkit-scrollbar-track,
    .tab-page::-webkit-scrollbar-track,
    .messages::-webkit-scrollbar-track {
      background: rgba(19, 35, 58, 0.04);
      border-radius: var(--radius-pill);
    }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-mark {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: var(--accent);
      color: white;
      display: grid;
      place-items: center;
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.03em;
      flex: 0 0 auto;
    }
    .eyebrow {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: rgba(52, 120, 246, 0.82);
    }
    .brand-copy h1,
    .hero-copy h2,
    .section-title h2,
    .panel-header h3 {
      font-family: "Space Grotesk", "Avenir Next", "Segoe UI", sans-serif;
      letter-spacing: -0.03em;
    }
    .brand-copy h1 {
      font-size: 22px;
      margin-top: 0;
      margin-bottom: 0;
    }
    .muted {
      color: var(--ink-soft);
      line-height: 1.5;
    }
    .status-row,
    .summary-grid,
    .meta-grid,
    .quick-grid,
    .top-cards,
    .detail-grid,
    .settings-grid,
    .checklist,
    .nav-list {
      display: grid;
      gap: 10px;
    }
    .status-row {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: fit-content;
      max-width: 100%;
      padding: 8px 12px;
      border-radius: var(--radius-pill);
      border: 1px solid transparent;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.2;
      background: rgba(255, 255, 255, 0.54);
    }
    .pill.ok {
      color: var(--ok);
      background: rgba(33, 91, 82, 0.08);
      border-color: rgba(33, 91, 82, 0.16);
    }
    .pill.primary {
      color: var(--accent);
      background: rgba(47, 91, 234, 0.09);
      border-color: rgba(47, 91, 234, 0.16);
    }
    .pill.warn {
      color: var(--warn);
      background: rgba(155, 106, 28, 0.10);
      border-color: rgba(155, 106, 28, 0.16);
    }
    .pill.danger {
      color: var(--danger);
      background: rgba(191, 75, 57, 0.10);
      border-color: rgba(191, 75, 57, 0.16);
    }
    .nav-list {
      margin-top: 4px;
    }
    .nav-button {
      border: 1px solid rgba(15, 23, 42, 0.05);
      background: rgba(255, 255, 255, 0.44);
      border-radius: 14px;
      padding: 12px 14px;
      color: var(--ink);
      text-align: left;
      cursor: pointer;
      transition: 180ms ease;
    }
    .nav-button:hover {
      transform: translateY(-1px);
      border-color: rgba(47, 91, 234, 0.18);
    }
    .nav-button.active {
      background: rgba(47, 91, 234, 0.08);
      border-color: rgba(47, 91, 234, 0.16);
    }
    .nav-label {
      display: block;
      font-weight: 700;
      font-size: 15px;
    }
    .summary-card,
    .meta-card,
    .metric-card,
    .panel-card,
    .composer-card {
      border-radius: 18px;
      border: 1px solid var(--line);
      background: var(--surface-strong);
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.035);
    }
    .summary-card,
    .meta-card,
    .metric-card,
    .panel-card {
      padding: 14px;
    }
    .summary-card h3,
    .panel-card h3,
    .composer-card h3 {
      font-size: 17px;
      margin-bottom: 12px;
    }
    .summary-item {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 0;
      font-size: 13px;
    }
    .summary-item strong {
      font-size: 13px;
    }
    .sidebar-actions {
      margin-top: auto;
      display: grid;
      gap: 12px;
    }
    .content-shell {
      min-width: 0;
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 14px;
      min-height: 0;
      overflow: hidden;
      position: relative;
    }
    .content-shell.chat-mode .topbar {
      display: none;
    }
    .topbar {
      padding: 14px;
      border-radius: var(--radius-xl);
      display: grid;
      gap: 10px;
    }
    .topbar-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }
    .sync-status {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: var(--radius-pill);
      background: rgba(255, 255, 255, 0.58);
      border: 1px solid rgba(19, 35, 58, 0.10);
      color: var(--ink-soft);
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 4;
    }
    .sync-status.visible {
      display: inline-flex;
    }
    .sync-status.error {
      color: var(--danger);
      border-color: rgba(192, 70, 72, 0.18);
      background: rgba(255, 241, 241, 0.92);
    }
    .sync-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      animation: pulse 1.1s ease-in-out infinite;
      flex: 0 0 auto;
    }
    .sync-status.error .sync-dot {
      background: var(--danger);
      animation: none;
    }
    .hero-copy h2 {
      font-size: 20px;
      margin-top: 4px;
      margin-bottom: 0;
    }
    .top-cards {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .metric-card {
      min-height: 0;
    }
    .metric-label {
      font-size: 13px;
      color: var(--ink-soft);
      margin-bottom: 10px;
    }
    .metric-value {
      font-family: "Space Grotesk", "Avenir Next", sans-serif;
      font-size: 24px;
      font-weight: 700;
      line-height: 1.05;
      letter-spacing: -0.03em;
      margin-bottom: 0;
    }
    .metric-caption {
      font-size: 13px;
      color: var(--ink-soft);
      line-height: 1.45;
      display: none;
    }
    .pages {
      min-height: 0;
      overflow: hidden;
      border-radius: var(--radius-xl);
    }
    .tab-page {
      display: none;
      height: 100%;
      overflow: auto;
      padding-right: 6px;
    }
    .tab-page.active {
      display: block;
    }
    .chat-page {
      overflow: hidden;
      padding-right: 0;
    }
    .page-stack {
      display: grid;
      gap: 14px;
      min-height: 100%;
    }
    .chat-layout {
      display: grid;
      grid-template-rows: auto 1fr auto;
      gap: 10px;
      min-height: 100%;
      height: 100%;
    }
    .chat-auth {
      max-width: 560px;
    }
    .chat-stream-card {
      min-height: 0;
      padding: 12px 10px 12px 12px;
      display: flex;
      overflow: hidden;
    }
    .chat-stream {
      width: 100%;
      min-height: 0;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      gap: 10px;
      overflow: auto;
      padding-right: 6px;
    }
    .panel-card {
      display: grid;
      gap: 12px;
    }
    .panel-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 14px;
    }
    .panel-header h3 {
      font-size: 18px;
      margin-bottom: 0;
    }
    .quick-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .prompt-chip,
    .model-chip {
      border: 1px solid rgba(47, 91, 234, 0.14);
      background: rgba(47, 91, 234, 0.08);
      color: var(--ink);
      border-radius: 14px;
      padding: 10px 12px;
      cursor: pointer;
      text-align: left;
    }
    .prompt-chip:hover,
    .model-chip:hover {
      border-color: rgba(52, 120, 246, 0.30);
      transform: translateY(-1px);
    }
    .auth-layout,
    .settings-layout {
      display: grid;
      gap: 14px;
    }
    label {
      display: grid;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      color: var(--ink);
    }
    input,
    textarea {
      width: 100%;
      border: 1px solid var(--line-soft);
      border-radius: 14px;
      padding: 12px 14px;
      color: var(--ink);
      background: rgba(255, 255, 255, 0.8);
      outline: none;
      transition: 160ms ease;
    }
    input:focus,
    textarea:focus {
      border-color: rgba(47, 91, 234, 0.34);
      box-shadow: 0 0 0 3px rgba(47, 91, 234, 0.08);
    }
    textarea {
      min-height: 104px;
      resize: vertical;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    button.primary,
    button.secondary,
    .link-button {
      border: 0;
      border-radius: 14px;
      padding: 11px 16px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: 160ms ease;
    }
    button.primary {
      background: linear-gradient(135deg, var(--accent), #648df5);
      color: white;
      box-shadow: 0 10px 24px rgba(47, 91, 234, 0.18);
    }
    button.secondary,
    .link-button {
      background: rgba(255, 255, 255, 0.7);
      color: var(--ink);
      border: 1px solid rgba(15, 23, 42, 0.08);
    }
    button:hover,
    .link-button:hover {
      transform: translateY(-1px);
    }
    .link-button.disabled {
      opacity: 0.55;
      pointer-events: none;
      transform: none;
    }
    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      transform: none;
    }
    .messages {
      display: grid;
      gap: 10px;
      padding-right: 6px;
    }
    .empty-state {
      padding: 16px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.62);
      border: 1px solid rgba(15, 23, 42, 0.06);
      color: var(--ink-soft);
      line-height: 1.5;
      margin-top: auto;
    }
    .bubble {
      padding: 14px 15px;
      border-radius: 18px;
      border: 1px solid rgba(15, 23, 42, 0.05);
      white-space: pre-wrap;
      box-shadow: 0 6px 18px rgba(15, 23, 42, 0.04);
    }
    .bubble.user {
      margin-left: 96px;
      background: rgba(47, 91, 234, 0.08);
    }
    .bubble.assistant {
      margin-right: 140px;
      background: rgba(255, 255, 255, 0.86);
    }
    .bubble.tool {
      margin-right: 180px;
      background: rgba(238, 246, 244, 0.92);
    }
    .bubble.system {
      margin-right: 180px;
      background: rgba(244, 242, 235, 0.92);
    }
    .bubble.error {
      border-color: rgba(192, 70, 72, 0.30);
    }
    .bubble-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .bubble-meta {
      display: inline-flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .bubble-time {
      font-size: 12px;
      color: rgba(19, 35, 58, 0.56);
      font-weight: 600;
    }
    .checklist {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .check-item {
      display: flex;
      gap: 12px;
      padding: 14px;
      border-radius: 16px;
      border: 1px solid rgba(15, 23, 42, 0.05);
      background: rgba(255, 255, 255, 0.6);
    }
    .check-bullet {
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-size: 13px;
      font-weight: 800;
    }
    .check-bullet.ok {
      color: var(--ok);
      background: rgba(20, 134, 109, 0.12);
    }
    .check-bullet.warn {
      color: var(--warn);
      background: rgba(192, 138, 43, 0.12);
    }
    .detail-grid,
    .settings-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .account-list {
      display: grid;
      gap: 10px;
    }
    .account-row {
      width: 100%;
      border: 1px solid rgba(15, 23, 42, 0.07);
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.6);
      padding: 13px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      text-align: left;
      cursor: pointer;
      transition: 160ms ease;
    }
    .account-row:hover {
      transform: translateY(-1px);
      border-color: rgba(183, 86, 42, 0.18);
    }
    .account-row.active {
      background: rgba(183, 86, 42, 0.08);
      border-color: rgba(183, 86, 42, 0.18);
    }
    .account-row:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .account-copy {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .account-title {
      font-size: 15px;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .account-meta {
      font-size: 13px;
      color: var(--ink-soft);
      line-height: 1.4;
    }
    .detail-card {
      padding: 14px;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.62);
      border: 1px solid rgba(15, 23, 42, 0.05);
    }
    .detail-label {
      font-size: 13px;
      color: var(--ink-soft);
      margin-bottom: 8px;
    }
    .detail-value {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.4;
    }
    .banner {
      padding: 13px 14px;
      border-radius: 16px;
      background: rgba(255, 248, 227, 0.94);
      color: #6b4d14;
      border: 1px solid rgba(192, 138, 43, 0.20);
      line-height: 1.45;
      font-size: 14px;
    }
    .danger-panel {
      background: rgba(255, 241, 241, 0.92);
      border-color: rgba(192, 70, 72, 0.18);
      color: #7a1f23;
    }
    .composer-card {
      padding: 16px;
      display: grid;
      gap: 14px;
    }
    .composer-dock {
      border-radius: 18px;
      border: 1px solid var(--line);
      background: var(--surface-strong);
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
      padding: 10px 10px 10px 14px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: flex-end;
    }
    .composer-dock textarea {
      min-height: 24px;
      max-height: 144px;
      resize: none;
      border: 0;
      padding: 8px 0;
      background: transparent;
      box-shadow: none;
      line-height: 1.5;
      overflow-y: auto;
    }
    .composer-dock textarea:focus {
      border-color: transparent;
      box-shadow: none;
    }
    .composer-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      align-self: flex-end;
    }
    .composer-actions .primary {
      min-width: 96px;
      padding: 11px 16px;
    }
    .hidden { display: none !important; }
    .skeleton-text {
      position: relative;
      display: inline-block;
      min-width: 88px;
      min-height: 1em;
      color: transparent !important;
      user-select: none;
    }
    .skeleton-text::after,
    .skeleton-block::after {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        90deg,
        rgba(255, 255, 255, 0) 0%,
        rgba(255, 255, 255, 0.82) 50%,
        rgba(255, 255, 255, 0) 100%
      );
      transform: translateX(-100%);
      animation: shimmer 1.35s infinite;
    }
    .skeleton-block {
      position: relative;
      overflow: hidden;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.52);
      min-height: 84px;
    }
    .skeleton-message {
      min-height: 96px;
      border-radius: 18px;
    }
    .skeleton-message.user {
      margin-left: 96px;
    }
    .skeleton-message.assistant {
      margin-right: 140px;
    }
    .footer-note {
      font-size: 13px;
      color: var(--ink-soft);
      line-height: 1.5;
    }
    @keyframes shimmer {
      100% {
        transform: translateX(100%);
      }
    }
    @keyframes pulse {
      0%, 100% {
        opacity: 0.45;
        transform: scale(0.9);
      }
      50% {
        opacity: 1;
        transform: scale(1);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .sync-dot,
      .skeleton-text::after,
      .skeleton-block::after {
        animation: none !important;
      }
      button,
      .link-button,
      .prompt-chip,
      .model-chip {
        transition: none !important;
      }
    }
    @media (max-width: 1160px) {
      .app-shell {
        grid-template-columns: 1fr;
        height: auto;
        min-height: 100vh;
      }
      body {
        overflow: auto;
      }
      .content-shell,
      .pages,
      .tab-page {
        overflow: visible;
        height: auto;
      }
      .top-cards,
      .status-row,
      .quick-grid,
      .checklist,
      .detail-grid,
      .settings-grid {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 720px) {
      .app-shell {
        padding: 14px;
        gap: 14px;
      }
      .sidebar,
      .topbar {
        padding: 16px;
      }
      .panel-card,
      .metric-card,
      .summary-card,
      .meta-card,
      .composer-card {
        padding: 16px;
      }
      .composer-dock {
        grid-template-columns: 1fr;
      }
      .composer-actions {
        width: 100%;
      }
      .composer-actions .primary {
        width: 100%;
      }
      .bubble.user,
      .bubble.assistant,
      .bubble.tool,
      .bubble.system {
        margin-left: 0;
        margin-right: 0;
      }
      .sync-status {
        top: 10px;
        right: 10px;
      }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <aside class="glass sidebar">
      <div class="brand-row">
        <div class="brand-mark">L</div>
        <div class="brand-copy">
          <h1>${DESKTOP_BRAND_NAME}</h1>
        </div>
      </div>

      <div class="status-row">
        <div id="sidebar-worker-chip" class="pill ${status.state === "ready" ? "ok" : "warn"}">${status.state === "ready" ? "Worker pronto" : "Worker " + status.state}</div>
        <div id="sidebar-model-chip" class="pill primary">${status.model}</div>
      </div>

      <div class="nav-list">
        <button class="nav-button active" data-section="chat">
          <span class="nav-label">Conversa</span>
        </button>
        <button class="nav-button" data-section="worker">
          <span class="nav-label">Worker</span>
        </button>
        <button class="nav-button" data-section="settings">
          <span class="nav-label">Definições</span>
        </button>
      </div>

      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-item"><span class="muted">Sessão</span><strong id="sidebar-session">Sem sessão</strong></div>
          <div class="summary-item"><span class="muted">Mensagens</span><strong id="sidebar-messages">0 no histórico</strong></div>
          <div class="summary-item"><span class="muted">Porta</span><strong id="sidebar-port">localhost:${String(status.port)}</strong></div>
        </div>
      </div>

      <div class="sidebar-actions">
        <button id="logout" class="secondary hidden">Terminar sessão</button>
      </div>
    </aside>
    <main class="content-shell chat-mode">
      <div id="sync-status" class="sync-status" role="status" aria-live="polite">
        <span class="sync-dot"></span>
        <span id="sync-status-text">A sincronizar</span>
      </div>
      <header class="glass topbar">
        <div class="topbar-header">
          <div class="hero-copy">
            <h2 id="topbar-title">Worker</h2>
          </div>
        </div>
        <div class="top-cards">
          <div class="metric-card">
            <div class="metric-label">Worker</div>
            <div id="worker-state" class="metric-value">${status.state}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Porta local</div>
            <div id="worker-port" class="metric-value">localhost:${String(status.port)}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Modelo</div>
            <div id="worker-model" class="metric-value">${status.model}</div>
          </div>
        </div>
      </header>

      <div class="pages">
        <section id="chat" class="tab-page chat-page active">
          <div class="chat-layout">
            <div id="auth-card" class="panel-card auth-layout chat-auth">
              <div>
                <h3>Entrar neste dispositivo</h3>
                <p class="muted">Sessão local simples para começares a usar o worker.</p>
              </div>
              <label>Nome
                <input id="auth-name" placeholder="Nuno" />
              </label>
              <label>Email
                <input id="auth-email" placeholder="nuno@example.com" />
              </label>
              <div class="actions">
                <button id="auth-submit" class="primary">Criar sessão local</button>
              </div>
            </div>

            <div class="panel-card chat-stream-card">
              <div id="messages" class="messages chat-stream"></div>
            </div>

            <div class="composer-dock">
              <textarea id="composer" rows="1" placeholder="Pergunta qualquer coisa..."></textarea>
              <div class="composer-actions">
                <button id="send-message" class="primary">Enviar</button>
              </div>
            </div>
          </div>
        </section>

        <section id="worker" class="tab-page">
          <div class="page-stack">
            <div class="panel-card">
              <div class="panel-header">
                <div>
                  <h3>Worker</h3>
                </div>
                <div id="worker-page-state" class="pill ${status.state === "ready" ? "ok" : "warn"}">${status.state === "ready" ? "Pronto" : status.state}</div>
              </div>
              <div class="top-cards">
                <div class="metric-card">
                  <div class="metric-label">Estado</div>
                  <div id="worker-card-state" class="metric-value">${status.state}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Porta</div>
                  <div id="worker-card-port" class="metric-value">${String(status.port)}</div>
                </div>
                <div class="metric-card">
                  <div class="metric-label">Modelo</div>
                  <div id="worker-card-model" class="metric-value">${status.model}</div>
                </div>
              </div>
            </div>

            <div class="panel-card">
              <div class="panel-header">
                <div>
                  <h3>Estado</h3>
                </div>
              </div>
              <div id="worker-checklist" class="checklist"></div>
            </div>

            <div class="panel-card">
              <div class="panel-header">
                <div>
                  <h3>Detalhes</h3>
                </div>
              </div>
              <div id="worker-details" class="detail-grid"></div>
            </div>

            <div id="worker-error" class="panel-card danger-panel hidden">
              <div class="panel-header">
                <div>
                  <h3>Erro</h3>
                </div>
              </div>
              <p id="worker-error-text"></p>
            </div>
          </div>
        </section>

        <section id="settings" class="tab-page">
          <div class="page-stack">
            <div class="panel-card">
              <div class="panel-header">
                <div>
                  <h3>Definições</h3>
                </div>
                <div id="settings-provider-pill" class="pill primary">provider</div>
              </div>
              <div class="settings-grid">
                <div class="detail-card">
                  <div class="detail-label">Modo ativo</div>
                  <div id="provider-hint" class="detail-value">A carregar</div>
                </div>
                <div class="detail-card">
                  <div class="detail-label">Chave OpenAI</div>
                  <div id="settings-key-state" class="detail-value">A validar</div>
                </div>
                <div class="detail-card">
                  <div class="detail-label">Modelo atual</div>
                  <div id="settings-model-current" class="detail-value">${status.model}</div>
                </div>
                <div class="detail-card">
                  <div class="detail-label">OAuth</div>
                  <div id="settings-oauth-state" class="detail-value">Ainda não ligado</div>
                </div>
                <div class="detail-card">
                  <div class="detail-label">Conta AI ativa</div>
                  <div id="settings-account-state" class="detail-value">A carregar</div>
                </div>
              </div>
            </div>

            <div class="panel-card settings-layout">
              <div class="panel-header">
                <div>
                  <h3>Conta AI</h3>
                </div>
              </div>
              <div id="oauth-status" class="banner hidden"></div>
              <div class="actions">
                <a id="connect-oauth" class="link-button" href="/auth/openai-codex/launch" target="_blank" rel="noopener">Ligar OpenAI OAuth</a>
                <button id="open-oauth-url" class="secondary hidden">Reabrir login</button>
              </div>
              <div id="oauth-manual" class="settings-layout hidden">
                <p id="oauth-manual-text" class="muted"></p>
                <label>Código manual
                  <input id="oauth-manual-input" placeholder="Cole aqui o código devolvido pela OpenAI" />
                </label>
                <div class="actions">
                  <button id="oauth-manual-submit" class="secondary">Concluir login manual</button>
                </div>
              </div>
              <div id="account-list" class="account-list"></div>
            </div>

            <div class="panel-card settings-layout">
              <div class="panel-header">
                <div>
                  <h3>API key</h3>
                  <p class="muted">Opcional. Só é usada neste dispositivo.</p>
                </div>
              </div>
              <label>OpenAI API key
                <input id="settings-api-key" placeholder="sk-..." />
              </label>
            </div>

            <div class="panel-card settings-layout">
              <div class="panel-header">
                <div>
                  <h3>Modelo</h3>
                </div>
              </div>
              <label>Modelo
                <input id="settings-model" value="${status.model}" />
              </label>
              <div class="actions">
                <button class="model-chip" data-model="gpt-5.4">Usar gpt-5.4</button>
                <button class="model-chip" data-model="gpt-5.4-mini">Usar gpt-5.4-mini</button>
              </div>
              <div class="actions">
                <button id="save-settings" class="primary">Guardar settings</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>

  <script id="initial-state" type="application/json">${initialStateJson}</script>
  <script>
    function readInitialState() {
      const node = document.getElementById("initial-state");
      if (!node) {
        return {
          session: null,
          settings: null,
          status: null,
          transcript: [],
        };
      }
      try {
        const payload = JSON.parse(node.textContent || "{}");
        return {
          session: payload.session || null,
          settings: payload.settings || null,
          status: payload.status || null,
          transcript: Array.isArray(payload.transcript) ? payload.transcript : [],
        };
      } catch {
        return {
          session: null,
          settings: null,
          status: null,
          transcript: [],
        };
      }
    }

    const bootstrap = readInitialState();
    const state = {
      session: bootstrap.session,
      settings: bootstrap.settings,
      status: bootstrap.status,
      transcript: bootstrap.transcript,
    };
    let oauthPollTimer = null;
    let refreshCounter = 0;
    let pendingAssistantBubble = false;
    let shouldStickToLatest = true;
    let hasHydrated = Boolean(state.status && state.settings);
    let syncIndicatorTimer = null;

    const loadingState = {
      bootstrap: !hasHydrated,
      refresh: false,
      error: "",
      visible: false,
    };

    const mutationState = {
      auth: false,
      send: false,
      saveSettings: false,
      oauthManual: false,
      activateBinding: false,
      logout: false,
    };

    const ui = {
      contentShell: document.querySelector(".content-shell"),
      topbarTitle: document.getElementById("topbar-title"),
      syncStatus: document.getElementById("sync-status"),
      syncStatusText: document.getElementById("sync-status-text"),
      authCard: document.getElementById("auth-card"),
      authName: document.getElementById("auth-name"),
      authEmail: document.getElementById("auth-email"),
      authSubmit: document.getElementById("auth-submit"),
      composer: document.getElementById("composer"),
      sendMessage: document.getElementById("send-message"),
      logout: document.getElementById("logout"),
      messages: document.getElementById("messages"),
      sidebarWorkerChip: document.getElementById("sidebar-worker-chip"),
      sidebarModelChip: document.getElementById("sidebar-model-chip"),
      sidebarSession: document.getElementById("sidebar-session"),
      sidebarMessages: document.getElementById("sidebar-messages"),
      sidebarPort: document.getElementById("sidebar-port"),
      workerPort: document.getElementById("worker-port"),
      workerState: document.getElementById("worker-state"),
      workerModel: document.getElementById("worker-model"),
      workerPageState: document.getElementById("worker-page-state"),
      workerCardState: document.getElementById("worker-card-state"),
      workerCardPort: document.getElementById("worker-card-port"),
      workerCardModel: document.getElementById("worker-card-model"),
      workerChecklist: document.getElementById("worker-checklist"),
      workerDetails: document.getElementById("worker-details"),
      workerError: document.getElementById("worker-error"),
      workerErrorText: document.getElementById("worker-error-text"),
      settingsApiKey: document.getElementById("settings-api-key"),
      settingsModel: document.getElementById("settings-model"),
      providerHint: document.getElementById("provider-hint"),
      settingsProviderPill: document.getElementById("settings-provider-pill"),
      settingsKeyState: document.getElementById("settings-key-state"),
      settingsModelCurrent: document.getElementById("settings-model-current"),
      settingsOauthState: document.getElementById("settings-oauth-state"),
      settingsAccountState: document.getElementById("settings-account-state"),
      oauthStatus: document.getElementById("oauth-status"),
      connectOauth: document.getElementById("connect-oauth"),
      openOauthUrl: document.getElementById("open-oauth-url"),
      oauthManual: document.getElementById("oauth-manual"),
      oauthManualText: document.getElementById("oauth-manual-text"),
      oauthManualInput: document.getElementById("oauth-manual-input"),
      oauthManualSubmit: document.getElementById("oauth-manual-submit"),
      accountList: document.getElementById("account-list"),
      saveSettings: document.getElementById("save-settings"),
      navButtons: Array.from(document.querySelectorAll("[data-section]")),
      sections: Array.from(document.querySelectorAll(".tab-page")),
      promptButtons: Array.from(document.querySelectorAll("[data-prompt]")),
      modelButtons: Array.from(document.querySelectorAll("[data-model]")),
    };

    function describeError(error) {
      if (error instanceof Error && error.message) {
        return error.message;
      }
      return String(error || "O pedido falhou.");
    }

    async function request(path, options) {
      const response = await fetch(path, {
        headers: { "content-type": "application/json" },
        ...options,
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(payload.error || text || "Pedido falhou.");
      }
      return payload;
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }

    function isMutationBusy() {
      return mutationState.auth
        || mutationState.send
        || mutationState.saveSettings
        || mutationState.oauthManual
        || mutationState.activateBinding
        || mutationState.logout;
    }

    function isBusy() {
      return loadingState.bootstrap || loadingState.refresh || isMutationBusy();
    }

    function syncLabel() {
      if (mutationState.send) {
        return "A enviar";
      }
      if (mutationState.auth) {
        return "A criar";
      }
      if (mutationState.saveSettings) {
        return "A guardar";
      }
      if (mutationState.oauthManual) {
        return "A validar";
      }
      if (mutationState.activateBinding) {
        return "A ligar";
      }
      if (mutationState.logout) {
        return "A terminar";
      }
      if (loadingState.bootstrap) {
        return "A carregar";
      }
      return "A sincronizar";
    }

    function updateSyncIndicatorVisibility() {
      if (loadingState.error) {
        if (syncIndicatorTimer) {
          clearTimeout(syncIndicatorTimer);
          syncIndicatorTimer = null;
        }
        loadingState.visible = true;
        return;
      }
      if (!isBusy()) {
        if (syncIndicatorTimer) {
          clearTimeout(syncIndicatorTimer);
          syncIndicatorTimer = null;
        }
        loadingState.visible = false;
        return;
      }
      if (loadingState.visible || syncIndicatorTimer) {
        return;
      }
      syncIndicatorTimer = setTimeout(() => {
        syncIndicatorTimer = null;
        if (isBusy()) {
          loadingState.visible = true;
          renderSyncStatus();
        }
      }, 160);
    }

    function renderSyncStatus() {
      updateSyncIndicatorVisibility();
      const show = loadingState.error || loadingState.visible;
      ui.syncStatus.classList.toggle("visible", Boolean(show));
      ui.syncStatus.classList.toggle("error", Boolean(loadingState.error));
      ui.syncStatusText.textContent = loadingState.error ? "Erro" : syncLabel();
      ui.syncStatus.title = loadingState.error || syncLabel();
      if (ui.contentShell) {
        ui.contentShell.setAttribute("aria-busy", isBusy() ? "true" : "false");
      }
    }

    function setButtonBusy(button, busy, busyLabel) {
      if (!button) {
        return;
      }
      if (!button.dataset.idleLabel) {
        button.dataset.idleLabel = button.textContent ? button.textContent.trim() : "";
      }
      button.textContent = busy ? busyLabel : button.dataset.idleLabel;
    }

    function buildMessageSkeletons() {
      return [
        '<div class="bubble assistant skeleton-block skeleton-message assistant" aria-hidden="true"></div>',
        '<div class="bubble user skeleton-block skeleton-message user" aria-hidden="true"></div>',
        '<div class="bubble assistant skeleton-block skeleton-message assistant" aria-hidden="true"></div>',
      ].join("");
    }

    function buildChecklistSkeletons() {
      return [
        '<div class="check-item skeleton-block" aria-hidden="true"></div>',
        '<div class="check-item skeleton-block" aria-hidden="true"></div>',
        '<div class="check-item skeleton-block" aria-hidden="true"></div>',
        '<div class="check-item skeleton-block" aria-hidden="true"></div>',
      ].join("");
    }

    function buildDetailSkeletons() {
      return [
        '<div class="detail-card skeleton-block" aria-hidden="true"></div>',
        '<div class="detail-card skeleton-block" aria-hidden="true"></div>',
        '<div class="detail-card skeleton-block" aria-hidden="true"></div>',
        '<div class="detail-card skeleton-block" aria-hidden="true"></div>',
      ].join("");
    }

    function applySkeletons(active) {
      const textTargets = [
        ui.sidebarSession,
        ui.sidebarMessages,
        ui.workerState,
        ui.workerPort,
        ui.workerModel,
        ui.workerPageState,
        ui.workerCardState,
        ui.workerCardPort,
        ui.workerCardModel,
        ui.providerHint,
        ui.settingsKeyState,
        ui.settingsModelCurrent,
        ui.settingsOauthState,
        ui.settingsAccountState,
      ];
      textTargets.forEach((node) => {
        if (node) {
          node.classList.toggle("skeleton-text", active);
        }
      });
      if (active) {
        ui.messages.innerHTML = buildMessageSkeletons();
        ui.workerChecklist.innerHTML = buildChecklistSkeletons();
        ui.workerDetails.innerHTML = buildDetailSkeletons();
      }
    }

    function updateActionStates() {
      const hasSession = Boolean(state.session);
      const hasSettings = Boolean(state.settings);
      const hasOauthUrl = Boolean(state.settings?.oauth?.authUrl);
      const hasManualCode = Boolean(ui.oauthManualInput.value.trim());
      const hasDraft = Boolean(ui.composer.value.trim());
      const hasAuthName = Boolean(ui.authName.value.trim());
      const hasAuthEmail = Boolean(ui.authEmail.value.trim());
      const lockUi = loadingState.bootstrap || mutationState.logout;

      ui.authName.disabled = mutationState.auth || lockUi;
      ui.authEmail.disabled = mutationState.auth || lockUi;
      ui.settingsApiKey.disabled = mutationState.saveSettings || lockUi;
      ui.settingsModel.disabled = mutationState.saveSettings || lockUi;
      ui.oauthManualInput.disabled = mutationState.oauthManual || lockUi;
      ui.composer.disabled = !hasSession || mutationState.send || lockUi;

      ui.authSubmit.disabled = mutationState.auth || lockUi || !hasAuthName || !hasAuthEmail;
      ui.sendMessage.disabled = !hasSession || mutationState.send || lockUi || !hasDraft;
      ui.logout.disabled = !hasSession || mutationState.logout || loadingState.bootstrap;
      ui.saveSettings.disabled = !hasSettings || mutationState.saveSettings || lockUi;
      ui.oauthManualSubmit.disabled = !hasManualCode || mutationState.oauthManual || lockUi;
      ui.openOauthUrl.disabled = !hasOauthUrl || lockUi;
      ui.accountList.querySelectorAll("[data-credential-id]").forEach((button) => {
        button.disabled = mutationState.activateBinding || lockUi;
      });

      ui.modelButtons.forEach((button) => {
        button.disabled = mutationState.saveSettings || lockUi;
      });

      ui.connectOauth.classList.toggle("disabled", lockUi);

      setButtonBusy(ui.authSubmit, mutationState.auth, "A criar");
      setButtonBusy(ui.sendMessage, mutationState.send, "A enviar");
      setButtonBusy(ui.saveSettings, mutationState.saveSettings, "A guardar");
      setButtonBusy(ui.oauthManualSubmit, mutationState.oauthManual, "A validar");
      setButtonBusy(ui.logout, mutationState.logout, "A terminar");
      renderSyncStatus();
    }

    function resizeComposer() {
      if (!(ui.composer instanceof HTMLTextAreaElement)) {
        return;
      }
      ui.composer.style.height = "0px";
      const nextHeight = Math.min(Math.max(ui.composer.scrollHeight, 40), 144);
      ui.composer.style.height = String(nextHeight) + "px";
    }

    function setSection(id) {
      if (ui.contentShell) {
        ui.contentShell.classList.toggle("chat-mode", id === "chat");
      }
      if (ui.topbarTitle) {
        ui.topbarTitle.textContent = id === "settings" ? "Definições" : "Worker";
      }
      for (const button of ui.navButtons) {
        const isActive = button.dataset.section === id;
        button.classList.toggle("active", isActive);
        if (isActive) {
          button.setAttribute("aria-current", "page");
        } else {
          button.removeAttribute("aria-current");
        }
      }
      for (const section of ui.sections) {
        section.classList.toggle("active", section.id === id);
      }
      if (id === "chat") {
        queueScrollToLatest(true);
      }
    }

    function isChatSectionActive() {
      const chatSection = document.getElementById("chat");
      return Boolean(chatSection && chatSection.classList.contains("active"));
    }

    function isNearLatest() {
      const remaining = ui.messages.scrollHeight - ui.messages.scrollTop - ui.messages.clientHeight;
      return remaining < 40;
    }

    function queueScrollToLatest(force) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!force && !isChatSectionActive()) {
            return;
          }
          ui.messages.scrollTop = ui.messages.scrollHeight;
          shouldStickToLatest = true;
        });
      });
    }

    function countRole(role) {
      return state.transcript.filter((message) => message.role === role).length;
    }

    function latestMessage(role) {
      for (let index = state.transcript.length - 1; index >= 0; index -= 1) {
        if (state.transcript[index].role === role) {
          return state.transcript[index];
        }
      }
      return null;
    }

    function normalizeTimestamp(value) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 10000) {
        return null;
      }
      return value < 100000000000 ? value * 1000 : value;
    }

    function formatClock(value) {
      const normalized = normalizeTimestamp(value);
      if (!normalized) {
        return "agora";
      }
      const date = new Date(normalized);
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return hours + ":" + minutes;
    }

    function formatRelative(value) {
      const normalized = normalizeTimestamp(value);
      if (!normalized) {
        return "Atividade recente";
      }
      const diff = Date.now() - normalized;
      const minutes = Math.max(0, Math.floor(diff / 60000));
      if (minutes < 1) {
        return "Agora mesmo";
      }
      if (minutes < 60) {
        return "Há " + minutes + " min";
      }
      const hours = Math.floor(minutes / 60);
      if (hours < 24) {
        return "Há " + hours + " h";
      }
      return "Há " + Math.floor(hours / 24) + " dias";
    }

    function formatDuration(startedAt) {
      const normalized = normalizeTimestamp(startedAt);
      if (!normalized) {
        return "a iniciar";
      }
      const diff = Math.max(0, Date.now() - normalized);
      const minutes = Math.floor(diff / 60000);
      if (minutes < 1) {
        return "agora";
      }
      if (minutes < 60) {
        return minutes + " min";
      }
      const hours = Math.floor(minutes / 60);
      if (hours < 24) {
        return hours + " h";
      }
      return Math.floor(hours / 24) + " dias";
    }

    function roleLabel(role) {
      switch (role) {
        case "user":
          return "Tu";
        case "assistant":
          return "Lume";
        case "tool":
          return "Ferramenta";
        case "system":
          return "Sistema";
        default:
          return role || "Mensagem";
      }
    }

    function roleTone(role, isError) {
      if (isError) {
        return "danger";
      }
      switch (role) {
        case "assistant":
          return "ok";
        case "user":
        case "tool":
          return "primary";
        default:
          return "warn";
      }
    }

    function getRuntimeBinding() {
      return state.settings?.runtimeBinding || null;
    }

    function getAiProfiles() {
      return Array.isArray(state.settings?.aiProfiles) ? state.settings.aiProfiles : [];
    }

    function getWorkerAiCredentials() {
      return Array.isArray(state.settings?.workerAiCredentials) ? state.settings.workerAiCredentials : [];
    }

    function getActiveCredential() {
      const binding = getRuntimeBinding();
      if (!binding) {
        return null;
      }
      return getWorkerAiCredentials().find((credential) => credential.id === binding.workerAiCredentialId) || null;
    }

    function getActiveProfile() {
      const activeCredential = getActiveCredential();
      if (!activeCredential) {
        return null;
      }
      return getAiProfiles().find((profile) => profile.id === activeCredential.aiProfileId) || null;
    }

    function credentialStateLabel(runtimeState) {
      switch (runtimeState) {
        case "active":
          return "Ativa";
        case "authenticated":
        case "standby":
          return "Disponível";
        case "cooldown":
          return "Em pausa";
        case "expired":
          return "Expirada";
        case "error":
          return "Com erro";
        default:
          return "Desconhecido";
      }
    }

    function oauthPhaseLabel(oauth) {
      if (oauth.connected) {
        return "Ligado";
      }
      switch (oauth.phase) {
        case "starting":
          return "A preparar";
        case "waiting_browser":
          return "No browser";
        case "waiting_manual":
          return "Manual";
        case "error":
          return "Com erro";
        default:
          return "Desligado";
      }
    }

    function stopOauthPolling() {
      if (oauthPollTimer) {
        clearInterval(oauthPollTimer);
        oauthPollTimer = null;
      }
    }

    function syncOauthPolling() {
      const phase = state.settings?.oauth?.phase;
      const shouldPoll = phase === "starting" || phase === "waiting_browser" || phase === "waiting_manual";
      if (!shouldPoll) {
        stopOauthPolling();
        return;
      }
      if (!oauthPollTimer) {
        oauthPollTimer = setInterval(() => {
          if (document.hidden) {
            return;
          }
          refresh({ visual: "silent", reportError: false }).catch((error) => {
            stopOauthPolling();
            ui.oauthStatus.classList.remove("hidden");
            ui.oauthStatus.textContent = describeError(error);
          });
        }, 2000);
      }
    }

    function buildMessageHtml(message) {
      const role = message.role || "assistant";
      const tone = roleTone(role, message.isError);
      const tool = message.toolAlias
        ? '<div class="pill primary">' + escapeHtml(message.toolAlias) + '</div>'
        : "";
      return ""
        + '<div class="bubble ' + role + (message.isError ? " error" : "") + '">'
        + '  <div class="bubble-top">'
        + '    <div class="bubble-meta">'
        + '      <div class="pill ' + tone + '">' + escapeHtml(roleLabel(role)) + "</div>"
        +        tool
        + "    </div>"
        + '    <div class="bubble-time">' + escapeHtml(formatClock(message.createdAt)) + "</div>"
        + "  </div>"
        + "  <div>" + escapeHtml(message.text || "") + "</div>"
        + "</div>";
    }

    function renderMessages() {
      const shouldAutoScroll = shouldStickToLatest || isNearLatest() || pendingAssistantBubble;
      if (!state.transcript.length && !pendingAssistantBubble) {
        ui.messages.innerHTML = '<div class="empty-state">' + (loadingState.error && !hasHydrated ? "Não foi possível carregar." : "Ainda sem mensagens.") + "</div>";
        if (shouldAutoScroll) {
          queueScrollToLatest(true);
        }
        return;
      }

      const html = state.transcript.map((message) => buildMessageHtml(message));
      if (pendingAssistantBubble) {
        html.push('<div class="bubble assistant skeleton-block skeleton-message assistant" aria-hidden="true"></div>');
      }
      ui.messages.innerHTML = html.join("");
      if (shouldAutoScroll) {
        queueScrollToLatest(true);
      }
    }

    function renderStatus() {
      if (!state.status) {
        return;
      }
      ui.workerState.textContent = state.status.state;
      ui.workerPort.textContent = "localhost:" + String(state.status.port);
      ui.workerModel.textContent = state.status.model;
      ui.sidebarWorkerChip.textContent = state.status.state === "ready" ? "Worker pronto" : "Worker " + state.status.state;
      ui.sidebarWorkerChip.className = "pill " + (state.status.state === "ready" ? "ok" : "warn");
      ui.sidebarModelChip.textContent = state.status.model;
      ui.sidebarPort.textContent = "localhost:" + String(state.status.port);
      ui.workerPageState.textContent = state.status.state === "ready" ? "Pronto" : state.status.state;
      ui.workerPageState.className = "pill " + (state.status.state === "ready" ? "ok" : "warn");
      ui.workerCardState.textContent = state.status.state;
      ui.workerCardPort.textContent = String(state.status.port);
      ui.workerCardModel.textContent = state.status.model;

      const checklist = [
        {
          ok: state.status.state === "ready",
          title: "Worker",
          detail: state.status.state === "ready" ? "Pronto" : "A iniciar",
        },
        {
          ok: state.status.hasSession,
          title: "Sessão",
          detail: state.status.hasSession ? "OK" : "Em falta",
        },
        {
          ok: Boolean(state.status.model),
          title: "Modelo",
          detail: state.status.model || "Sem modelo definido.",
        },
        {
          ok: state.status.hasOpenAiApiKey || state.status.hasActiveAiCredential,
          title: "Credencial",
          detail: state.status.hasActiveAiCredential
            ? (state.status.activeAiProfileLabel || "Conta OAuth ativa")
            : state.status.hasOpenAiApiKey
              ? "API key local"
              : "Em falta",
        },
      ];

      ui.workerChecklist.innerHTML = checklist.map((item) => ""
        + '<div class="check-item">'
        + '  <div class="check-bullet ' + (item.ok ? "ok" : "warn") + '">' + (item.ok ? "OK" : "!") + "</div>"
        + "  <div>"
        + "    <strong>" + escapeHtml(item.title) + "</strong>"
        + '    <p class="muted">' + escapeHtml(item.detail) + "</p>"
        + "  </div>"
        + "</div>"
      ).join("");

      ui.workerDetails.innerHTML = [
        ["Marca do worker", state.status.brandName],
        ["Sessão criada", state.status.hasSession ? "Sim, sessão local pronta." : "Não, autenticação local em falta."],
        ["Conta AI ativa", state.status.activeAiProfileLabel || "Ainda não ligada."],
        ["Credencial OpenAI", state.status.hasOpenAiApiKey ? "API key local presente." : state.status.hasActiveAiCredential ? "OAuth local ligado." : "Ainda não configurada."],
        ["Ligação HTTP", "http://127.0.0.1:" + String(state.status.port)],
        ["PID", String(state.status.pid)],
        ["Arranque", formatDuration(state.status.startedAt)],
      ].map(([label, value]) => ""
        + '<div class="detail-card">'
        + '  <div class="detail-label">' + escapeHtml(label) + "</div>"
        + '  <div class="detail-value">' + escapeHtml(value) + "</div>"
        + "</div>"
      ).join("");

      ui.workerError.classList.toggle("hidden", !state.status.lastError);
      ui.workerErrorText.textContent = state.status.lastError || "";
    }

    function renderSession() {
      const hasSession = Boolean(state.session);
      ui.authCard.classList.toggle("hidden", hasSession);
      ui.logout.classList.toggle("hidden", !hasSession);
      ui.sidebarSession.textContent = hasSession ? state.session.email : "Sem sessão";
      ui.sidebarMessages.textContent = String(state.transcript.length) + " no histórico";
    }

    function renderAccountList() {
      const credentials = getWorkerAiCredentials();
      const profiles = getAiProfiles();
      const binding = getRuntimeBinding();

      if (!credentials.length) {
        ui.accountList.innerHTML = '<div class="empty-state">Ainda não tens contas AI ligadas neste dispositivo.</div>';
        return;
      }

      ui.accountList.innerHTML = credentials.map((credential) => {
        const profile = profiles.find((item) => item.id === credential.aiProfileId);
        const isActive = binding?.workerAiCredentialId === credential.id;
        const title = profile?.label || credential.email || credential.accountId || "Conta OpenAI";
        const meta = [
          credential.email || null,
          credentialStateLabel(credential.runtimeState),
        ].filter(Boolean).join(" · ");
        const actionLabel = isActive ? "Ligada" : "Usar";
        const actionTone = isActive ? "ok" : "primary";
        return ""
          + '<button class="account-row' + (isActive ? " active" : "") + '" data-credential-id="' + escapeHtml(credential.id) + '">'
          + '  <div class="account-copy">'
          + '    <div class="account-title">' + escapeHtml(title) + "</div>"
          + '    <div class="account-meta">' + escapeHtml(meta || "Conta disponível neste dispositivo") + "</div>"
          + "  </div>"
          + '  <div class="pill ' + actionTone + '">' + escapeHtml(actionLabel) + "</div>"
          + "</button>";
      }).join("");
    }

    function renderSettings() {
      if (!state.settings) {
        return;
      }
      const oauth = state.settings.oauth || {};
      const activeCredential = getActiveCredential();
      const activeProfile = getActiveProfile();
      const credentialCount = getWorkerAiCredentials().length;
      const activeLabel =
        activeProfile?.label ||
        activeCredential?.email ||
        activeCredential?.accountId ||
        "";
      ui.settingsModel.value = state.settings.model || "gpt-5.4";
      ui.settingsModelCurrent.textContent = state.settings.model || "gpt-5.4";
      ui.settingsApiKey.placeholder = state.settings.hasOpenAiApiKey
        ? "Já existe uma chave guardada. Preenche apenas para substituir."
        : "sk-...";
      ui.providerHint.textContent = state.settings.provider === "openai-codex"
        ? activeLabel || (credentialCount ? credentialCount + " conta disponível" + (credentialCount > 1 ? "s" : "") : "Sem conta ligada")
        : "API key";
      ui.settingsProviderPill.textContent = state.settings.provider === "openai-codex" ? "OpenAI OAuth" : "OpenAI API";
      ui.settingsKeyState.textContent = state.settings.hasOpenAiApiKey ? "Guardada neste dispositivo" : "Não definida";
      ui.settingsOauthState.textContent = oauthPhaseLabel(oauth);
      ui.settingsAccountState.textContent = activeLabel
        ? activeLabel + " · " + credentialStateLabel(activeCredential?.runtimeState)
        : credentialCount
          ? credentialCount + " conta disponível" + (credentialCount > 1 ? "s" : "")
          : "Sem conta ligada";

      let bannerText = "Ainda não ligaste nenhuma conta OpenAI neste dispositivo.";
      if (oauth.error) {
        bannerText = "Falha ao ligar OpenAI. " + oauth.error;
      } else if (oauth.connected) {
        bannerText = activeLabel
          ? "Ligado como " + activeLabel + "."
          : "Conta OpenAI ligada neste dispositivo.";
      } else if (oauth.phase === "waiting_manual") {
        bannerText = "Termina o login colando o URL final ou o código devolvido pela OpenAI.";
      } else if (oauth.phase === "waiting_browser") {
        bannerText = "Continua o login na janela da OpenAI.";
      } else if (oauth.phase === "starting") {
        bannerText = "A preparar a ligação à OpenAI.";
      } else if (oauth.message) {
        bannerText = oauth.message;
      }

      ui.connectOauth.textContent = oauth.connected ? "Ligar outra conta" : "Ligar OpenAI OAuth";
      ui.oauthStatus.classList.remove("hidden");
      ui.oauthStatus.classList.toggle("danger-panel", Boolean(oauth.error));
      ui.oauthStatus.textContent = bannerText;
      ui.openOauthUrl.classList.toggle("hidden", !oauth.authUrl);
      ui.oauthManual.classList.toggle("hidden", oauth.phase !== "waiting_manual");
      ui.oauthManualText.textContent = oauth.manualPrompt || "Cola aqui o URL final ou o código devolvido pela OpenAI.";
      renderAccountList();
    }

    function render() {
      if (loadingState.bootstrap && !hasHydrated) {
        applySkeletons(true);
        updateActionStates();
        syncOauthPolling();
        return;
      }
      applySkeletons(false);
      renderSession();
      renderStatus();
      renderSettings();
      renderMessages();
      updateActionStates();
      syncOauthPolling();
    }

    async function refresh(options) {
      const settings = options || {};
      const visual = settings.visual || (hasHydrated ? "busy" : "bootstrap");
      const reportError = settings.reportError !== false;
      const refreshId = ++refreshCounter;

      if (visual === "bootstrap" && !hasHydrated) {
        loadingState.bootstrap = true;
      } else if (visual === "busy") {
        loadingState.refresh = true;
      }
      if (visual !== "silent") {
        loadingState.error = "";
      }
      render();

      try {
        const [status, sessionPayload, settingsPayload, messagesPayload] = await Promise.all([
          request("/worker/status"),
          request("/auth/mock/session"),
          request("/settings"),
          request("/chat/messages"),
        ]);
        if (refreshId !== refreshCounter) {
          return;
        }
        state.status = status;
        state.session = sessionPayload.session || null;
        state.settings = settingsPayload.settings || null;
        state.transcript = Array.isArray(messagesPayload.transcript) ? messagesPayload.transcript : [];
        hasHydrated = true;
      } catch (error) {
        if (refreshId !== refreshCounter) {
          return;
        }
        if (reportError) {
          loadingState.error = describeError(error);
        }
        throw error;
      } finally {
        if (refreshId === refreshCounter) {
          loadingState.bootstrap = false;
          loadingState.refresh = false;
          render();
        }
      }
    }

    ui.navButtons.forEach((button) => {
      button.addEventListener("click", () => setSection(button.dataset.section));
    });

    ui.promptButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const prompt = button.dataset.prompt || "";
        ui.composer.value = prompt;
        resizeComposer();
        ui.composer.focus();
        updateActionStates();
      });
    });

    ui.modelButtons.forEach((button) => {
      button.addEventListener("click", () => {
        ui.settingsModel.value = button.dataset.model || "gpt-5.4";
        updateActionStates();
      });
    });

    ui.accountList.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const button = target.closest("[data-credential-id]");
      if (!(button instanceof HTMLElement)) {
        return;
      }
      const workerAiCredentialId = button.dataset.credentialId;
      if (!workerAiCredentialId) {
        return;
      }
      if (getRuntimeBinding()?.workerAiCredentialId === workerAiCredentialId) {
        return;
      }
      mutationState.activateBinding = true;
      loadingState.error = "";
      render();
      try {
        await request("/runtime/binding/activate", {
          method: "POST",
          body: JSON.stringify({ workerAiCredentialId }),
        });
        await refresh({ visual: "busy" });
      } catch (error) {
        loadingState.error = describeError(error);
        ui.oauthStatus.classList.remove("hidden");
        ui.oauthStatus.textContent = describeError(error);
      } finally {
        mutationState.activateBinding = false;
        render();
      }
    });

    ui.composer.addEventListener("input", () => {
      resizeComposer();
      updateActionStates();
    });
    ui.authName.addEventListener("input", updateActionStates);
    ui.authEmail.addEventListener("input", updateActionStates);
    ui.oauthManualInput.addEventListener("input", updateActionStates);
    ui.settingsModel.addEventListener("input", updateActionStates);
    ui.settingsApiKey.addEventListener("input", updateActionStates);
    ui.messages.addEventListener("scroll", () => {
      shouldStickToLatest = isNearLatest();
    }, { passive: true });

    ui.authSubmit.addEventListener("click", async () => {
      mutationState.auth = true;
      loadingState.error = "";
      render();
      try {
        await request("/auth/mock/register", {
          method: "POST",
          body: JSON.stringify({
            name: ui.authName.value,
            email: ui.authEmail.value,
          }),
        });
        await refresh({ visual: "busy" });
        setSection("chat");
      } catch (error) {
        loadingState.error = describeError(error);
        renderSyncStatus();
      } finally {
        mutationState.auth = false;
        render();
      }
    });

    ui.saveSettings.addEventListener("click", async () => {
      mutationState.saveSettings = true;
      loadingState.error = "";
      render();
      try {
        await request("/settings", {
          method: "PUT",
          body: JSON.stringify({
            provider: state.settings?.provider || "openai",
            openAiApiKey: ui.settingsApiKey.value,
            model: ui.settingsModel.value || "gpt-5.4",
          }),
        });
        ui.settingsApiKey.value = "";
        await refresh({ visual: "busy" });
      } catch (error) {
        loadingState.error = describeError(error);
        renderSyncStatus();
      } finally {
        mutationState.saveSettings = false;
        render();
      }
    });

    ui.connectOauth.addEventListener("click", () => {
      if (ui.connectOauth.classList.contains("disabled")) {
        return;
      }
      loadingState.error = "";
      ui.oauthStatus.classList.remove("hidden");
      ui.oauthStatus.textContent = "A preparar login OpenAI.";
      setTimeout(() => {
        refresh({ visual: "silent", reportError: false }).catch((error) => {
          ui.oauthStatus.classList.remove("hidden");
          ui.oauthStatus.textContent = describeError(error);
        });
      }, 250);
      setTimeout(() => {
        refresh({ visual: "silent", reportError: false }).catch((error) => {
          ui.oauthStatus.classList.remove("hidden");
          ui.oauthStatus.textContent = describeError(error);
        });
      }, 1500);
    });

    ui.openOauthUrl.addEventListener("click", () => {
      const authUrl = state.settings?.oauth?.authUrl;
      if (authUrl && !ui.openOauthUrl.disabled) {
        window.open(authUrl, "_blank");
      }
    });

    ui.oauthManualSubmit.addEventListener("click", async () => {
      const value = ui.oauthManualInput.value.trim();
      if (!value) {
        return;
      }
      mutationState.oauthManual = true;
      loadingState.error = "";
      render();
      try {
        await request("/auth/openai-codex/manual", {
          method: "POST",
          body: JSON.stringify({ value }),
        });
        ui.oauthManualInput.value = "";
        await refresh({ visual: "busy" });
      } catch (error) {
        loadingState.error = describeError(error);
        ui.oauthStatus.classList.remove("hidden");
        ui.oauthStatus.textContent = describeError(error);
      } finally {
        mutationState.oauthManual = false;
        render();
      }
    });

    ui.sendMessage.addEventListener("click", async () => {
      const draft = ui.composer.value.trim();
      if (!draft) {
        return;
      }
      const previousTranscript = state.transcript.slice();
      mutationState.send = true;
      pendingAssistantBubble = true;
      loadingState.error = "";
      state.transcript = previousTranscript.concat([
        {
          id: "optimistic-user-" + String(Date.now()),
          role: "user",
          text: draft,
          createdAt: Date.now(),
        },
      ]);
      ui.composer.value = "";
      resizeComposer();
      render();
      try {
        const payload = await request("/chat/send", {
          method: "POST",
          body: JSON.stringify({
            content: draft,
          }),
        });
        state.transcript = Array.isArray(payload.transcript) ? payload.transcript : [];
        pendingAssistantBubble = false;
        hasHydrated = true;
      } catch (error) {
        pendingAssistantBubble = false;
        state.transcript = previousTranscript.concat([
          {
            id: "local-error-" + String(Date.now()),
            role: "assistant",
            text: describeError(error),
            createdAt: Date.now(),
            isError: true,
          },
        ]);
        ui.composer.value = draft;
        resizeComposer();
        loadingState.error = describeError(error);
      } finally {
        mutationState.send = false;
        render();
      }
    });

    ui.logout.addEventListener("click", async () => {
      mutationState.logout = true;
      loadingState.error = "";
      render();
      try {
        await request("/auth/mock/logout", { method: "POST" });
        pendingAssistantBubble = false;
        ui.composer.value = "";
        resizeComposer();
        await refresh({ visual: "busy" });
      } catch (error) {
        loadingState.error = describeError(error);
        renderSyncStatus();
      } finally {
        mutationState.logout = false;
        render();
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        syncOauthPolling();
        refresh({ visual: "silent", reportError: false }).catch(() => {});
      }
    });

    resizeComposer();
    render();
    refresh({ visual: hasHydrated ? "silent" : "bootstrap", reportError: !hasHydrated }).catch((error) => {
      if (!hasHydrated) {
        loadingState.error = describeError(error);
        render();
      }
    });
  </script>
</body>
</html>`;
}

function json(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(`${JSON.stringify(payload)}\n`);
}

function html(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function buildWorkerStatus(params: {
  state: WorkerRuntimeState;
  startedAt: number;
  port: number;
  current: PersistedDesktopState;
  lastError?: string;
}): WorkerStatus {
  const activeCredential = resolveBoundWorkerAiCredential(params.current);
  const activeProfile = activeCredential
    ? params.current.aiProfiles.find((profile) => profile.id === activeCredential.aiProfileId)
    : null;
  return {
    state: params.state,
    startedAt: params.startedAt,
    pid: process.pid,
    port: params.port,
    brandName: DESKTOP_BRAND_NAME,
    hasSession: params.current.session !== null,
    hasOpenAiApiKey: Boolean(params.current.settings.openAiApiKey),
    hasActiveAiCredential: Boolean(activeCredential),
    model: params.current.settings.model,
    activeAiProfileLabel: activeProfile?.label,
    activeAiCredentialState: activeCredential?.runtimeState,
    lastError: params.lastError,
  };
}

function buildSettingsPayload(
  current: PersistedDesktopState,
  oauth: OAuthSnapshotReader,
): {
  settings: {
    provider: PersistedDesktopState["settings"]["provider"];
    model: string;
    hasOpenAiApiKey: boolean;
    oauth: ReturnType<OpenAICodexOAuthManager["getSnapshot"]>;
    runtimeBinding: PersistedDesktopState["runtimeBinding"];
    aiProfiles: PersistedDesktopState["aiProfiles"];
    workerAiCredentials: PersistedDesktopState["workerAiCredentials"];
  };
} {
  const effectiveSettings = resolveEffectiveSettings(current, oauth);
  const boundCredential = resolveBoundWorkerAiCredential(current);
  return {
    settings: {
      provider: effectiveSettings.provider,
      model: effectiveSettings.model,
      hasOpenAiApiKey: Boolean(effectiveSettings.openAiApiKey),
      oauth: oauth.getSnapshot({
        preferredAuthProfileId: boundCredential?.authProfileId,
      }),
      runtimeBinding: current.runtimeBinding,
      aiProfiles: current.aiProfiles,
      workerAiCredentials: current.workerAiCredentials,
    },
  };
}

export async function createDesktopWorkerServer(
  options: WorkerServerOptions = {},
  deps: WorkerServerDeps = {},
): Promise<WorkerServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? DEFAULT_WORKER_PORT;
  const storage = new DesktopWorkerStorage(options.storageDir);
  const startedAt = Date.now();
  let current = await storage.load();
  let runtimeState: WorkerRuntimeState = "starting";
  let lastError: string | undefined;
  const invokeAlias = deps.invokeToolAlias ?? invokeToolAlias;
  const oauth =
    deps.oauth ??
    new OpenAICodexOAuthManager({
      onConnected: async ({ profileId, email, accountId }) => {
        current = await storage.update((state) =>
          rebuildAiAccountState(
            {
              ...connectOpenAICodexCredential({
                state: {
                  ...state,
                  settings: mergeSettings(state.settings, buildOpenAICodexSettingsPatch()),
                },
                authProfileId: profileId,
                email,
                accountId,
              }),
            },
            loadAuthProfileStoreForRuntime(),
          ),
        );
      },
    });

  current = syncStateWithRuntime(current, oauth);

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const url = new URL(req.url ?? "/", `http://${host}:${String(port)}`);

      if (method === "GET" && url.pathname === "/") {
        current = syncStateWithRuntime(await storage.load(), oauth);
        const status = buildWorkerStatus({
          state: runtimeState,
          startedAt,
          port,
          current,
          lastError,
        });
        const settingsPayload = buildSettingsPayload(current, oauth);
        html(
          res,
          200,
          renderPreviewHtml({
            status,
            initialState: {
              session: current.session,
              settings: {
                ...settingsPayload.settings,
              },
              transcript: buildTranscript(current.conversation.messages),
            },
          }),
        );
        return;
      }

      if (method === "GET" && url.pathname === "/healthz") {
        json(res, 200, { ok: true });
        return;
      }

      if (method === "GET" && url.pathname === "/worker/status") {
        current = syncStateWithRuntime(await storage.load(), oauth);
        json(
          res,
          200,
          buildWorkerStatus({ state: runtimeState, startedAt, port, current, lastError }),
        );
        return;
      }

      if (method === "GET" && url.pathname === "/auth/mock/session") {
        current = syncStateWithRuntime(await storage.load(), oauth);
        json(res, 200, { session: current.session });
        return;
      }

      if (method === "POST" && url.pathname === "/auth/mock/register") {
        const body = RegisterBodySchema.parse(await readJson(req));
        current = await storage.update((state) => ({
          ...state,
          session: createMockSession(body),
          conversation: { messages: [] },
        }));
        current = syncStateWithRuntime(current, oauth);
        json(res, 200, { session: current.session });
        return;
      }

      if (method === "POST" && url.pathname === "/auth/mock/login") {
        const body = RegisterBodySchema.parse(await readJson(req));
        current = await storage.update((state) => ({
          ...state,
          session: createMockSession(body),
        }));
        current = syncStateWithRuntime(current, oauth);
        json(res, 200, { session: current.session });
        return;
      }

      if (method === "POST" && url.pathname === "/auth/mock/logout") {
        current = await storage.update((state) => ({
          ...state,
          session: null,
          conversation: { messages: [] },
        }));
        current = syncStateWithRuntime(current, oauth);
        json(res, 200, { ok: true });
        return;
      }

      if (method === "GET" && url.pathname === "/settings") {
        current = syncStateWithRuntime(await storage.load(), oauth);
        json(res, 200, buildSettingsPayload(current, oauth));
        return;
      }

      if (method === "GET" && url.pathname === "/auth/openai-codex/launch") {
        html(res, 200, renderOpenAICodexLaunchPage());
        return;
      }

      if (method === "PUT" && url.pathname === "/settings") {
        const body = SettingsBodySchema.parse(await readJson(req));
        current = await storage.update((state) => ({
          ...state,
          settings: mergeSettings(state.settings, body),
        }));
        current = syncStateWithRuntime(current, oauth);
        json(res, 200, buildSettingsPayload(current, oauth));
        return;
      }

      if (method === "POST" && url.pathname === "/auth/openai-codex/start") {
        current = syncStateWithRuntime(await storage.load(), oauth);
        const snapshot = await oauth.start();
        json(res, 200, { oauth: snapshot });
        return;
      }

      if (method === "GET" && url.pathname === "/auth/openai-codex/status") {
        current = syncStateWithRuntime(await storage.load(), oauth);
        const boundCredential = resolveBoundWorkerAiCredential(current);
        json(res, 200, {
          oauth: oauth.getSnapshot({
            preferredAuthProfileId: boundCredential?.authProfileId,
          }),
        });
        return;
      }

      if (method === "POST" && url.pathname === "/auth/openai-codex/manual") {
        const body = OAuthManualBodySchema.parse(await readJson(req));
        current = syncStateWithRuntime(await storage.load(), oauth);
        json(res, 200, { oauth: oauth.submitManual(body.value) });
        return;
      }

      if (method === "GET" && url.pathname === "/ai-profiles") {
        current = syncStateWithRuntime(await storage.load(), oauth);
        json(res, 200, {
          aiProfiles: current.aiProfiles,
          workerAiCredentials: current.workerAiCredentials,
        });
        return;
      }

      if (method === "GET" && url.pathname === "/runtime/binding") {
        current = syncStateWithRuntime(await storage.load(), oauth);
        json(res, 200, {
          runtimeBinding: current.runtimeBinding,
          activeCredential: resolveBoundWorkerAiCredential(current),
        });
        return;
      }

      if (method === "POST" && url.pathname === "/runtime/binding/activate") {
        const body = RuntimeBindingBodySchema.parse(await readJson(req));
        current = await storage.update((state) =>
          rebuildAiAccountState(
            bindWorkerAiCredential({
              state,
              workerAiCredentialId: body.workerAiCredentialId,
            }),
            loadAuthProfileStoreForRuntime(),
          ),
        );
        json(res, 200, {
          runtimeBinding: current.runtimeBinding,
          activeCredential: resolveBoundWorkerAiCredential(current),
        });
        return;
      }

      if (method === "GET" && url.pathname === "/chat/messages") {
        current = syncStateWithRuntime(await storage.load(), oauth);
        json(res, 200, {
          transcript: buildTranscript(current.conversation.messages),
        });
        return;
      }

      if (method === "POST" && url.pathname === "/chat/send") {
        current = syncStateWithRuntime(await storage.load(), oauth);
        if (!current.session) {
          json(res, 401, { error: "É necessário criar sessão local antes de usar o chat." });
          return;
        }
        const effectiveSettings = resolveEffectiveSettings(current, oauth);
        const body = ChatBodySchema.parse(await readJson(req));
        const chatResult = await runChatTurn(
          {
            conversation: current.conversation,
            content: body.content,
            settings: effectiveSettings,
          },
          deps,
        );
        current = await storage.update((state) => ({
          ...(() => {
            const syncedState = syncStateWithRuntime(state, oauth);
            const boundCredentialId = syncedState.runtimeBinding?.workerAiCredentialId;
            const now = Date.now();
            return {
              ...syncedState,
              conversation: chatResult.conversation,
              workerAiCredentials: syncedState.workerAiCredentials.map((credential) =>
                boundCredentialId === credential.id
                  ? {
                      ...credential,
                      lastUsedAt: now,
                      localTelemetry: {
                        ...credential.localTelemetry,
                        lastUsedAt: now,
                      },
                    }
                  : credential,
              ),
            };
          })(),
        }));
        current = syncStateWithRuntime(current, oauth);
        json(res, 200, chatResult);
        return;
      }

      if (method === "POST" && url.pathname === "/tool/invoke-alias") {
        const body = AliasBodySchema.parse(await readJson(req)) as InvokeAliasParams;
        const result = await invokeAlias(body);
        json(res, 200, result);
        return;
      }

      json(res, 404, { error: "Endpoint não encontrado." });
    } catch (error) {
      runtimeState = "error";
      lastError = error instanceof Error ? error.message : String(error);
      json(res, 500, { error: lastError });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  runtimeState = "ready";

  return {
    baseUrl: `http://${host}:${String(port)}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    getStatus: () =>
      buildWorkerStatus({ state: runtimeState, startedAt, port, current, lastError }),
  };
}
