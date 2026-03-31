import { randomBytes } from "node:crypto";
import http from "node:http";
import type { OAuthCredentials } from "@mariozechner/pi-ai";
import {
  listProfilesForProvider,
  loadAuthProfileStoreForRuntime,
} from "../../../src/agents/auth-profiles.ts";
import { writeOAuthCredentials } from "../../../src/plugins/provider-auth-helpers.ts";
import { OPENAI_CODEX_DEFAULT_MODEL } from "../../../src/plugins/provider-model-defaults.ts";
import {
  formatOpenAIOAuthTlsPreflightFix,
  runOpenAIOAuthTlsPreflight,
} from "../../../src/plugins/provider-openai-codex-oauth-tls.ts";
import { createNonExitingRuntime } from "../../../src/runtime.ts";
import type { WizardProgress, WizardPrompter } from "../../../src/wizard/prompts.ts";
import { OPENAI_CODEX_PROVIDER } from "./types.js";

export type OpenAICodexOAuthPhase =
  | "idle"
  | "starting"
  | "waiting_browser"
  | "waiting_manual"
  | "success"
  | "error";

export type OpenAICodexOAuthSnapshot = {
  phase: OpenAICodexOAuthPhase;
  connected: boolean;
  message?: string;
  error?: string;
  authUrl?: string;
  manualPrompt?: string;
  profileId?: string;
  email?: string;
  accountId?: string;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type OAuthFlowState = {
  phase: OpenAICodexOAuthPhase;
  message?: string;
  error?: string;
  authUrl?: string;
  manualPrompt?: string;
  profileId?: string;
  email?: string;
  manualResolver?: (value: string) => void;
  visibleState: Deferred<void>;
};

type LocalOpenAICallbackServer = {
  waitForCode: () => Promise<string>;
  close: () => Promise<void>;
  isAvailable: boolean;
};

type ManualOpenAICodexOAuthLoginParams = {
  prompter: WizardPrompter;
  runtime: {
    log: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  openUrl: (url: string) => Promise<void>;
  localBrowserMessage?: string;
};

type OpenAICodexOAuthManagerDeps = {
  login?: (params: ManualOpenAICodexOAuthLoginParams) => Promise<OAuthCredentials | null>;
  writeOAuthCredentials?: typeof writeOAuthCredentials;
  onConnected?: (result: {
    profileId: string;
    email?: string;
    accountId?: string;
  }) => Promise<void>;
};

const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";
const OPENAI_CODEX_SCOPE = "openid profile email offline_access";
const OPENAI_CODEX_JWT_CLAIM_PATH = "https://api.openai.com/auth";
const MANUAL_INPUT_PROMPT_MESSAGE = "Cola aqui o URL final ou o código devolvido pela OpenAI.";
const LUME_RETURN_URL = "http://localhost:3500/";

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createState(): string {
  return randomBytes(16).toString("hex");
}

function base64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64urlEncode(verifierBytes);
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  const challenge = base64urlEncode(new Uint8Array(hashBuffer));
  return { verifier, challenge };
}

function parseAuthorizationInput(input: string): { code?: string; state?: string } {
  const value = input.trim();
  if (!value) {
    return {};
  }

  try {
    const url = new URL(value);
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    };
  } catch {
    // not a URL
  }

  if (value.includes("#")) {
    const [code, state] = value.split("#", 2);
    return { code, state };
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    return {
      code: params.get("code") ?? undefined,
      state: params.get("state") ?? undefined,
    };
  }

  return { code: value };
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    const payload = parts[1];
    if (parts.length !== 3 || !payload) {
      return null;
    }
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function extractEmail(accessToken: string): string | undefined {
  const payload = decodeJwt(accessToken);
  const profile = payload?.["https://api.openai.com/profile"];
  if (!profile || typeof profile !== "object") {
    return undefined;
  }
  const email = (profile as Record<string, unknown>).email;
  return typeof email === "string" && email.length > 0 ? email : undefined;
}

function getAccountId(accessToken: string): string | null {
  const payload = decodeJwt(accessToken);
  const auth = payload?.[OPENAI_CODEX_JWT_CLAIM_PATH];
  if (!auth || typeof auth !== "object") {
    return null;
  }
  const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
  return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
}

async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
): Promise<OAuthCredentials> {
  const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: OPENAI_CODEX_CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: OPENAI_CODEX_REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Token exchange failed (${response.status}): ${text || "sem detalhe"}`);
  }

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== "number") {
    throw new Error("Token exchange devolveu um payload inválido.");
  }

  const accountId = getAccountId(json.access_token);
  if (!accountId) {
    throw new Error("Falhou a extração do accountId do token OpenAI.");
  }

  return {
    provider: OPENAI_CODEX_PROVIDER,
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000,
    accountId,
    email: extractEmail(json.access_token),
  };
}

function renderOpenAICallbackPage(params: {
  title: string;
  message: string;
  redirectToLume?: boolean;
}): string {
  const redirectScript = params.redirectToLume
    ? `<script>setTimeout(() => { window.location.replace(${JSON.stringify(LUME_RETURN_URL)}); }, 1200);</script>`
    : "";
  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${params.title}</title>
  <style>
    :root {
      color-scheme: light;
      --bg-a: #f3f0ea;
      --bg-b: #f7f3ed;
      --bg-c: #efe8de;
      --surface: rgba(255, 252, 247, 0.92);
      --line: rgba(24, 22, 19, 0.08);
      --ink: #181613;
      --muted: rgba(24, 22, 19, 0.62);
      --accent: #b7562a;
      --shadow: 0 18px 42px rgba(24, 22, 19, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at top left, rgba(183, 86, 42, 0.10), transparent 24%),
        radial-gradient(circle at 88% 16%, rgba(44, 106, 98, 0.10), transparent 22%),
        linear-gradient(135deg, var(--bg-a), var(--bg-b) 52%, var(--bg-c));
      color: var(--ink);
      font-family: "Manrope", "Avenir Next", "Segoe UI", ui-sans-serif, sans-serif;
      padding: 24px;
    }
    .card {
      width: min(560px, 100%);
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 28px;
      padding: 28px;
      box-shadow: var(--shadow);
      display: grid;
      gap: 18px;
    }
    h1, p { margin: 0; }
    h1 {
      font-family: "Space Grotesk", "Avenir Next", "Segoe UI", sans-serif;
      font-size: 32px;
      letter-spacing: -0.04em;
    }
    p { color: var(--muted); line-height: 1.5; }
    a {
      display: inline-flex;
      width: fit-content;
      text-decoration: none;
      background: var(--accent);
      color: white;
      padding: 12px 16px;
      border-radius: 16px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>${params.title}</h1>
    <p>${params.message}</p>
    <a href="${LUME_RETURN_URL}">Voltar ao Lume</a>
  </main>
  ${redirectScript}
</body>
</html>`;
}

async function createLocalOpenAICallbackServer(
  expectedState: string,
): Promise<LocalOpenAICallbackServer> {
  let resolveCode!: (value: string) => void;
  const codePromise = new Promise<string>((resolve) => {
    resolveCode = resolve;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost:1455");
    if (url.pathname !== "/auth/callback") {
      res.statusCode = 404;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        renderOpenAICallbackPage({
          title: "Callback não encontrado",
          message: "A app recebeu um pedido inesperado. Volta ao Lume e tenta novamente.",
        }),
      );
      return;
    }

    const callbackUrl = url.toString();
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code) {
      res.statusCode = 400;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        renderOpenAICallbackPage({
          title: "Código em falta",
          message: "A OpenAI não devolveu um código válido. Volta ao Lume e repete o login.",
        }),
      );
      return;
    }

    if (state !== expectedState) {
      res.statusCode = 400;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(
        renderOpenAICallbackPage({
          title: "Estado inválido",
          message:
            "O estado OAuth não coincide com o pedido actual. Volta ao Lume e tenta novamente.",
        }),
      );
      return;
    }

    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      renderOpenAICallbackPage({
        title: "Login concluído",
        message: "A autenticação foi recebida. Vais voltar ao Lume automaticamente.",
        redirectToLume: true,
      }),
    );
    resolveCode(callbackUrl);
  });

  const isAvailable = await new Promise<boolean>((resolve) => {
    const onError = () => {
      server.removeAllListeners("listening");
      resolve(false);
    };
    server.once("error", onError);
    server.listen(1455, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve(true);
    });
  });

  if (!isAvailable) {
    try {
      server.close();
    } catch {
      // ignore
    }
    return {
      isAvailable: false,
      waitForCode: async () => {
        throw new Error("Callback server indisponível.");
      },
      close: async () => {},
    };
  }

  return {
    isAvailable: true,
    waitForCode: async () => await codePromise,
    close: async () =>
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function loginOpenAICodexOAuthManually(
  params: ManualOpenAICodexOAuthLoginParams,
): Promise<OAuthCredentials | null> {
  const { prompter, runtime, openUrl, localBrowserMessage } = params;

  const preflight = await runOpenAIOAuthTlsPreflight();
  if (!preflight.ok && preflight.kind === "tls-cert") {
    const hint = formatOpenAIOAuthTlsPreflightFix(preflight);
    runtime.error(hint);
    await prompter.note(hint, "OAuth prerequisites");
    throw new Error(preflight.message);
  }

  await prompter.note(
    [
      "O login OpenAI abre o browser e fica ligado apenas neste dispositivo.",
      "Se o redirecionamento não terminar sozinho, podes colar o URL final manualmente.",
    ].join("\n"),
    "OpenAI Codex OAuth",
  );

  const progress = prompter.progress("A iniciar ligação…");

  try {
    const { verifier, challenge } = await generatePkce();
    const state = createState();
    const callbackServer = await createLocalOpenAICallbackServer(state);
    const url = new URL(OPENAI_CODEX_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", OPENAI_CODEX_CLIENT_ID);
    url.searchParams.set("redirect_uri", OPENAI_CODEX_REDIRECT_URI);
    url.searchParams.set("scope", OPENAI_CODEX_SCOPE);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("id_token_add_organizations", "true");
    url.searchParams.set("codex_cli_simplified_flow", "true");
    url.searchParams.set("originator", "pi");

    progress.update(localBrowserMessage ?? "Completa o login no browser e cola o resultado final.");
    await openUrl(url.toString());
    runtime.log(`Open: ${url.toString()}`);

    let input: string;
    try {
      const manualInputPromise = prompter.text({
        message: callbackServer.isAvailable
          ? "Se o browser não concluir sozinho, cola aqui o código ou URL final."
          : MANUAL_INPUT_PROMPT_MESSAGE,
        validate: (value) => (value.trim().length > 0 ? undefined : "Required"),
      });

      if (callbackServer.isAvailable) {
        input = await Promise.race([callbackServer.waitForCode(), manualInputPromise]);
      } else {
        await prompter.note(
          "A porta localhost:1455 está ocupada. Depois do login, copia o URL final do browser e cola-o no Lume.",
          "OpenAI Codex OAuth",
        );
        input = await manualInputPromise;
      }
    } finally {
      await callbackServer.close();
    }

    const parsed = parseAuthorizationInput(String(input));

    if (parsed.state && parsed.state !== state) {
      throw new Error("State mismatch.");
    }
    if (!parsed.code) {
      throw new Error("Falta o authorization code.");
    }

    const credentials = await exchangeAuthorizationCode(parsed.code, verifier);
    progress.stop("Ligação OpenAI concluída");
    return credentials;
  } catch (error) {
    progress.stop("Falha ao ligar OpenAI");
    runtime.error(String(error));
    await prompter.note("Trouble with OAuth? See https://docs.openclaw.ai/start/faq", "OAuth help");
    throw error;
  }
}

function resolveStoredOpenAICodexConnection(params?: { preferredAuthProfileId?: string }): {
  connected: boolean;
  profileId?: string;
  email?: string;
  accountId?: string;
} {
  const store = loadAuthProfileStoreForRuntime();
  const preferredId = params?.preferredAuthProfileId;
  const profileId =
    preferredId && store.profiles[preferredId]?.provider === OPENAI_CODEX_PROVIDER
      ? preferredId
      : listProfilesForProvider(store, OPENAI_CODEX_PROVIDER).at(0);
  if (!profileId) {
    return { connected: false };
  }
  const credential = store.profiles[profileId];
  if (!credential || credential.type !== "oauth") {
    return { connected: false };
  }
  return {
    connected: true,
    profileId,
    email: credential.email,
    accountId: credential.accountId,
  };
}

function createWebPrompter(flow: OAuthFlowState): WizardPrompter {
  const updateMessage = (message: string, phase?: OpenAICodexOAuthPhase) => {
    flow.message = message;
    if (phase) {
      flow.phase = phase;
    }
    flow.visibleState.resolve();
  };

  const progressFactory = (_label: string): WizardProgress => ({
    update: (message: string) => {
      const lower = message.toLowerCase();
      if (lower.includes("browser")) {
        updateMessage(message, "waiting_browser");
        return;
      }
      updateMessage(message);
    },
    stop: (message?: string) => {
      if (message) {
        updateMessage(message);
      }
    },
  });

  return {
    intro: async () => {},
    outro: async (message) => updateMessage(message),
    note: async (message, title) => updateMessage(title ? `${title}: ${message}` : message),
    select: async () => {
      throw new Error("select não suportado neste fluxo web");
    },
    multiselect: async () => {
      throw new Error("multiselect não suportado neste fluxo web");
    },
    text: async (params) => {
      flow.phase = "waiting_manual";
      flow.manualPrompt = params.message;
      flow.visibleState.resolve();
      return await new Promise<string>((resolve) => {
        flow.manualResolver = resolve;
      });
    },
    confirm: async () => true,
    progress: progressFactory,
  };
}

export class OpenAICodexOAuthManager {
  private flow: OAuthFlowState | null = null;
  private readonly deps: Required<Omit<OpenAICodexOAuthManagerDeps, "onConnected">> &
    Pick<OpenAICodexOAuthManagerDeps, "onConnected">;

  constructor(deps: OpenAICodexOAuthManagerDeps = {}) {
    this.deps = {
      login: deps.login ?? loginOpenAICodexOAuthManually,
      writeOAuthCredentials: deps.writeOAuthCredentials ?? writeOAuthCredentials,
      onConnected: deps.onConnected,
    };
  }

  getSnapshot(params?: { preferredAuthProfileId?: string }): OpenAICodexOAuthSnapshot {
    const stored = resolveStoredOpenAICodexConnection(params);
    if (!this.flow) {
      return {
        phase: "idle",
        connected: stored.connected,
        profileId: stored.profileId,
        email: stored.email,
        accountId: stored.accountId,
      };
    }
    return {
      phase: this.flow.phase,
      connected: stored.connected || this.flow.phase === "success",
      message: this.flow.message,
      error: this.flow.error,
      authUrl: this.flow.authUrl,
      manualPrompt: this.flow.manualPrompt,
      profileId: this.flow.profileId ?? stored.profileId,
      email: this.flow.email ?? stored.email,
      accountId: stored.accountId,
    };
  }

  async start(params?: { preferredAuthProfileId?: string }): Promise<OpenAICodexOAuthSnapshot> {
    if (this.flow && this.flow.phase !== "success" && this.flow.phase !== "error") {
      return this.getSnapshot(params);
    }

    const flow: OAuthFlowState = {
      phase: "starting",
      message: "A preparar o login OpenAI OAuth…",
      visibleState: createDeferred<void>(),
    };
    flow.visibleState.resolve();
    this.flow = flow;

    void this.run(flow);

    await Promise.race([
      flow.visibleState.promise,
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);
    return this.getSnapshot(params);
  }

  submitManual(value: string): OpenAICodexOAuthSnapshot {
    if (!this.flow?.manualResolver) {
      throw new Error("Não há nenhum pedido manual pendente.");
    }
    const resolver = this.flow.manualResolver;
    this.flow.manualResolver = undefined;
    this.flow.manualPrompt = undefined;
    this.flow.message = "Código manual recebido. A concluir autenticação…";
    resolver(value);
    return this.getSnapshot();
  }

  private async run(flow: OAuthFlowState): Promise<void> {
    const runtime = createNonExitingRuntime();
    const prompter = createWebPrompter(flow);

    try {
      const credentials = await this.deps.login({
        prompter,
        runtime: {
          ...runtime,
          log: (...args) => {
            const rendered = args.map((value) => String(value)).join(" ");
            const authUrl = rendered.match(/https:\/\/\S+/)?.[0];
            if (authUrl) {
              flow.authUrl = authUrl;
            }
            if (rendered.trim()) {
              flow.message = rendered;
              flow.visibleState.resolve();
            }
          },
          error: (...args) => {
            const rendered = args.map((value) => String(value)).join(" ");
            if (rendered.trim()) {
              flow.error = rendered;
              flow.phase = "error";
              flow.visibleState.resolve();
            }
          },
        },
        openUrl: async (url: string) => {
          flow.authUrl = url;
          flow.phase = "waiting_browser";
          flow.message = "Abre a janela de login OpenAI e conclui a autorização.";
          flow.visibleState.resolve();
        },
        localBrowserMessage: "Continua o login OpenAI na janela que abriste.",
      });

      if (!credentials) {
        throw new Error("O fluxo OAuth não devolveu credenciais.");
      }

      const profileId = await this.deps.writeOAuthCredentials(OPENAI_CODEX_PROVIDER, credentials);
      const email = typeof credentials.email === "string" ? credentials.email : undefined;
      const accountId =
        typeof credentials.accountId === "string" ? credentials.accountId : undefined;
      flow.profileId = profileId;
      flow.email = email;
      flow.phase = "success";
      flow.message = "OpenAI OAuth ligado com sucesso.";

      await this.deps.onConnected?.({
        profileId,
        email,
        accountId,
      });

      flow.visibleState.resolve();
    } catch (error) {
      flow.phase = "error";
      flow.error = error instanceof Error ? error.message : String(error);
      flow.message = "Falha no login OpenAI OAuth.";
      flow.visibleState.resolve();
    }
  }
}

export function buildOpenAICodexSettingsPatch(): {
  provider: typeof OPENAI_CODEX_PROVIDER;
  model: string;
} {
  return {
    provider: OPENAI_CODEX_PROVIDER,
    model: OPENAI_CODEX_DEFAULT_MODEL.replace(`${OPENAI_CODEX_PROVIDER}/`, ""),
  };
}
