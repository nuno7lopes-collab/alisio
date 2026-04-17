import { buildDeviceAuthPayload } from "../../../src/gateway/device-auth.js";
import { resolveConnectChallengeTimeoutMs } from "../../../src/gateway/handshake-timeouts.js";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  type GatewayClientMode,
  type GatewayClientName,
} from "../../../src/gateway/protocol/client-info.js";
import {
  ConnectErrorDetailCodes,
  readConnectErrorRecoveryAdvice,
  readConnectErrorDetailCode,
} from "../../../src/gateway/protocol/connect-error-details.js";
import { isTerminalGatewayAuthDetailCode } from "../../../src/gateway/reconnect-policy.js";
import {
  CONTROL_UI_OPERATOR_ROLE,
  CONTROL_UI_OPERATOR_SCOPES,
} from "../../../src/shared/control-ui-operator.js";
import { clearDeviceAuthToken, loadDeviceAuthToken, storeDeviceAuthToken } from "./device-auth.ts";
import {
  canUseBrowserGeneratedIdentity,
  clearStoredBrowserDeviceIdentity,
  loadOrCreateBrowserDeviceIdentity,
  loadManagedDeviceIdentity,
  loadStoredBrowserDeviceIdentity,
  signDevicePayloadWithIdentity,
  type DeviceIdentity,
} from "./device-identity.ts";
import { generateUUID } from "./uuid.ts";

export { CONTROL_UI_OPERATOR_ROLE, CONTROL_UI_OPERATOR_SCOPES };

export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: { presence: number; health: number };
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
};

export type GatewayErrorInfo = {
  code: string;
  message: string;
  details?: unknown;
};

export class GatewayRequestError extends Error {
  readonly gatewayCode: string;
  readonly details?: unknown;

  constructor(error: GatewayErrorInfo) {
    super(error.message);
    this.name = "GatewayRequestError";
    this.gatewayCode = error.code;
    this.details = error.details;
  }
}

export function resolveGatewayErrorDetailCode(
  error: { details?: unknown } | null | undefined,
): string | null {
  return readConnectErrorDetailCode(error?.details);
}

/**
 * Auth errors that won't resolve without user action — don't auto-reconnect.
 *
 * NOTE: AUTH_TOKEN_MISMATCH is intentionally NOT included here because the
 * browser client supports a bounded one-time retry with a cached device token
 * when the endpoint is trusted. Reconnect suppression for mismatch is handled
 * with client state (after retry budget is exhausted).
 */
export function isNonRecoverableAuthError(error: GatewayErrorInfo | undefined): boolean {
  if (!error) {
    return false;
  }
  return isTerminalGatewayAuthDetailCode(resolveGatewayErrorDetailCode(error));
}

function isRecoverableRequestAuthError(error: GatewayErrorInfo | undefined): boolean {
  if (!error) {
    return false;
  }
  const detailCode = resolveGatewayErrorDetailCode(error);
  if (detailCode && isTerminalGatewayAuthDetailCode(detailCode)) {
    return false;
  }
  if (
    detailCode === ConnectErrorDetailCodes.AUTH_REQUIRED ||
    detailCode === ConnectErrorDetailCodes.AUTH_UNAUTHORIZED ||
    detailCode === ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH ||
    detailCode === ConnectErrorDetailCodes.AUTH_DEVICE_TOKEN_MISMATCH
  ) {
    return true;
  }
  const normalizedMessage = error.message.trim().toLowerCase();
  return (
    normalizedMessage.includes("jwt expired") ||
    normalizedMessage.includes("token expired") ||
    normalizedMessage.includes("auth token mismatch") ||
    normalizedMessage.includes("device token mismatch") ||
    normalizedMessage.startsWith("unauthorized")
  );
}

function isTrustedRetryEndpoint(url: string): boolean {
  try {
    const gatewayUrl = new URL(url, window.location.href);
    const host = gatewayUrl.hostname.trim().toLowerCase();
    const isLoopbackHost =
      host === "localhost" || host === "::1" || host === "[::1]" || host === "127.0.0.1";
    const isLoopbackIPv4 = host.startsWith("127.");
    if (isLoopbackHost || isLoopbackIPv4) {
      return true;
    }
    const pageUrl = new URL(window.location.href);
    return gatewayUrl.host === pageUrl.host;
  } catch {
    return false;
  }
}

export type GatewayHelloOk = {
  type: "hello-ok";
  protocol: number;
  server?: {
    version?: string;
    connId?: string;
  };
  features?: { methods?: string[]; events?: string[] };
  snapshot?: unknown;
  auth?: {
    deviceToken?: string;
    role?: string;
    scopes?: string[];
    issuedAtMs?: number;
  };
  policy?: { tickIntervalMs?: number };
};

type Pending = {
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

type SelectedConnectAuth = {
  authToken?: string;
  authBootstrapToken?: string;
  authDeviceToken?: string;
  authPassword?: string;
  signatureToken?: string;
  resolvedDeviceToken?: string;
  storedToken?: string;
  canFallbackToShared: boolean;
};

export type GatewayConnectAuth = {
  token?: string;
  bootstrapToken?: string;
  deviceToken?: string;
  password?: string;
};

export type GatewayConnectDevice = {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
};

export type GatewayConnectClientInfo = {
  id: GatewayClientName;
  version: string;
  platform: string;
  mode: GatewayClientMode;
  instanceId?: string;
};

export type GatewayConnectParams = {
  minProtocol: 3;
  maxProtocol: 3;
  client: GatewayConnectClientInfo;
  role: string;
  scopes: string[];
  device?: GatewayConnectDevice;
  caps: string[];
  auth?: GatewayConnectAuth;
  userAgent: string;
  locale: string;
};

type ConnectPlan = {
  role: string;
  scopes: string[];
  client: GatewayConnectClientInfo;
  explicitGatewayToken?: string;
  selectedAuth: SelectedConnectAuth;
  auth?: GatewayConnectAuth;
  deviceIdentity: DeviceIdentity | null;
  device?: GatewayConnectDevice;
};

type DeviceTokenRetryDecision = {
  deviceTokenRetryBudgetUsed: boolean;
  authDeviceToken?: string;
  explicitGatewayToken?: string;
  deviceIdentity: DeviceIdentity | null;
  storedToken?: string;
  canRetryWithDeviceTokenHint: boolean;
  url: string;
};

export type GatewayBrowserClientOptions = {
  url: string;
  connectChallengeTimeoutMs?: number;
  token?: string;
  bootstrapToken?: string;
  password?: string;
  clientName?: GatewayClientName;
  clientVersion?: string;
  platform?: string;
  mode?: GatewayClientMode;
  instanceId?: string;
  onHello?: (hello: GatewayHelloOk) => void;
  onEvent?: (evt: GatewayEventFrame) => void;
  onClose?: (info: { code: number; reason: string; error?: GatewayErrorInfo }) => void;
  onGap?: (info: { expected: number; received: number }) => void;
};

// 4008 = application-defined code (browser rejects 1008 "Policy Violation")
const CONNECT_FAILED_CLOSE_CODE = 4008;

function buildGatewayConnectAuth(
  selectedAuth: SelectedConnectAuth,
): GatewayConnectAuth | undefined {
  const authToken = selectedAuth.authToken;
  if (!(authToken || selectedAuth.authPassword || selectedAuth.authBootstrapToken)) {
    return undefined;
  }
  return {
    token: authToken,
    bootstrapToken: selectedAuth.authBootstrapToken,
    deviceToken: selectedAuth.authDeviceToken ?? selectedAuth.resolvedDeviceToken,
    password: selectedAuth.authPassword,
  };
}

async function buildGatewayConnectDevice(params: {
  deviceIdentity: DeviceIdentity | null;
  client: GatewayConnectClientInfo;
  role: string;
  scopes: string[];
  signatureToken?: string;
  connectNonce: string | null;
}): Promise<GatewayConnectDevice | undefined> {
  const { deviceIdentity } = params;
  if (!deviceIdentity) {
    return undefined;
  }
  const signedAtMs = Date.now();
  const nonce = params.connectNonce ?? "";
  const payload = buildDeviceAuthPayload({
    deviceId: deviceIdentity.deviceId,
    clientId: params.client.id,
    clientMode: params.client.mode,
    role: params.role,
    scopes: params.scopes,
    signedAtMs,
    // The device signature must bind to the same credential that the server
    // will validate first during connect.
    token: params.signatureToken ?? null,
    nonce,
  });
  const signature = await signDevicePayloadWithIdentity(deviceIdentity, payload);
  return {
    id: deviceIdentity.deviceId,
    publicKey: deviceIdentity.publicKey,
    signature,
    signedAt: signedAtMs,
    nonce,
  };
}

export function shouldRetryWithDeviceToken(params: DeviceTokenRetryDecision): boolean {
  return (
    !params.deviceTokenRetryBudgetUsed &&
    !params.authDeviceToken &&
    Boolean(params.explicitGatewayToken) &&
    Boolean(params.deviceIdentity) &&
    Boolean(params.storedToken) &&
    params.canRetryWithDeviceTokenHint &&
    isTrustedRetryEndpoint(params.url)
  );
}

export class GatewayBrowserClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private lastSeq: number | null = null;
  private connectNonce: string | null = null;
  private connectSent = false;
  private connectTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private backoffMs = 800;
  private pendingConnectError: GatewayErrorInfo | undefined;
  private pendingDeviceTokenRetry = false;
  private deviceTokenRetryBudgetUsed = false;
  private preferBrowserIdentityOnNextConnect = false;
  private browserIdentityRetryBudgetUsed = false;

  constructor(private opts: GatewayBrowserClientOptions) {}

  start() {
    this.closed = false;
    this.lastSeq = null;
    this.connectNonce = null;
    this.connectSent = false;
    this.pendingConnectError = undefined;
    this.preferBrowserIdentityOnNextConnect = false;
    this.browserIdentityRetryBudgetUsed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.pendingConnectError = undefined;
    this.pendingDeviceTokenRetry = false;
    this.deviceTokenRetryBudgetUsed = false;
    this.preferBrowserIdentityOnNextConnect = false;
    this.browserIdentityRetryBudgetUsed = false;
    this.flushPending(new Error("gateway client stopped"));
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect() {
    if (this.closed) {
      return;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws = new WebSocket(this.opts.url);
    this.ws.addEventListener("open", () => this.beginPreauthHandshake());
    this.ws.addEventListener("message", (ev) => this.handleMessage(String(ev.data ?? "")));
    this.ws.addEventListener("close", (ev) => {
      const reason = String(ev.reason ?? "");
      const connectError = this.pendingConnectError;
      this.pendingConnectError = undefined;
      if (this.connectTimer !== null) {
        window.clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }
      this.ws = null;
      this.flushPending(new Error(`gateway closed (${ev.code}): ${reason}`));
      this.opts.onClose?.({ code: ev.code, reason, error: connectError });
      const connectErrorCode = resolveGatewayErrorDetailCode(connectError);
      if (
        connectErrorCode === ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH &&
        this.deviceTokenRetryBudgetUsed &&
        !this.pendingDeviceTokenRetry
      ) {
        return;
      }
      if (this.preferBrowserIdentityOnNextConnect) {
        this.scheduleReconnect();
        return;
      }
      if (!isNonRecoverableAuthError(connectError)) {
        this.scheduleReconnect();
      }
    });
    this.ws.addEventListener("error", () => {
      // ignored; close handler will fire
    });
  }

  private scheduleReconnect() {
    if (this.closed) {
      return;
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15_000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private flushPending(err: Error) {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  private buildConnectClient(): GatewayConnectClientInfo {
    return this.buildConnectClientWithMetadata();
  }

  private buildConnectClientWithMetadata(
    identity?: Pick<DeviceIdentity, "deviceFamily" | "platform"> | null,
  ): GatewayConnectClientInfo {
    return {
      id: this.opts.clientName ?? GATEWAY_CLIENT_NAMES.CONTROL_UI,
      version: this.opts.clientVersion ?? "control-ui",
      platform: this.opts.platform ?? identity?.platform ?? navigator.platform ?? "web",
      deviceFamily: identity?.deviceFamily,
      mode: this.opts.mode ?? GATEWAY_CLIENT_MODES.WEBCHAT,
      instanceId: this.opts.instanceId,
    };
  }

  private buildConnectParams(plan: ConnectPlan): GatewayConnectParams {
    return {
      minProtocol: 3,
      maxProtocol: 3,
      client: plan.client,
      role: plan.role,
      scopes: plan.scopes,
      device: plan.device,
      caps: ["tool-events"],
      auth: plan.auth,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    };
  }

  private async buildConnectPlan(): Promise<ConnectPlan> {
    const role = CONTROL_UI_OPERATOR_ROLE;
    const scopes = [...CONTROL_UI_OPERATOR_SCOPES];
    const explicitGatewayToken = this.opts.token?.trim() || undefined;
    const explicitBootstrapToken = this.opts.bootstrapToken?.trim() || undefined;
    const explicitPassword = this.opts.password?.trim() || undefined;

    let deviceIdentity: DeviceIdentity | null = null;
    let selectedAuth: SelectedConnectAuth = {
      authToken: explicitGatewayToken,
      authBootstrapToken: explicitBootstrapToken,
      authPassword: explicitPassword,
      canFallbackToShared: false,
    };

    if (this.preferBrowserIdentityOnNextConnect && canUseBrowserGeneratedIdentity()) {
      deviceIdentity = await loadStoredBrowserDeviceIdentity();
      this.preferBrowserIdentityOnNextConnect = false;
    }
    if (!deviceIdentity) {
      deviceIdentity = await loadManagedDeviceIdentity();
    }
    if (!deviceIdentity && canUseBrowserGeneratedIdentity()) {
      deviceIdentity = await loadOrCreateBrowserDeviceIdentity();
    }
    const client = this.buildConnectClientWithMetadata(deviceIdentity);
    if (deviceIdentity) {
      selectedAuth = this.selectConnectAuth({
        role,
        deviceId: deviceIdentity.deviceId,
      });
      if (this.pendingDeviceTokenRetry && selectedAuth.authDeviceToken) {
        this.pendingDeviceTokenRetry = false;
      }
    }

    return {
      role,
      scopes,
      client,
      explicitGatewayToken,
      selectedAuth,
      auth: buildGatewayConnectAuth(selectedAuth),
      deviceIdentity,
      device: await buildGatewayConnectDevice({
        deviceIdentity,
        client,
        role,
        scopes,
        signatureToken: selectedAuth.signatureToken,
        connectNonce: this.connectNonce,
      }),
    };
  }

  private handleConnectHello(hello: GatewayHelloOk, plan: ConnectPlan) {
    this.pendingDeviceTokenRetry = false;
    this.deviceTokenRetryBudgetUsed = false;
    this.preferBrowserIdentityOnNextConnect = false;
    this.browserIdentityRetryBudgetUsed = false;
    this.lastSeq = null;
    if (hello?.auth?.deviceToken && plan.deviceIdentity) {
      storeDeviceAuthToken({
        deviceId: plan.deviceIdentity.deviceId,
        role: hello.auth.role ?? plan.role,
        token: hello.auth.deviceToken,
        scopes: hello.auth.scopes ?? [],
      });
    }
    this.backoffMs = 800;
    this.opts.onHello?.(hello);
  }

  private handleConnectFailure(err: unknown, plan: ConnectPlan) {
    const connectErrorCode =
      err instanceof GatewayRequestError ? resolveGatewayErrorDetailCode(err) : null;
    const recoveryAdvice =
      err instanceof GatewayRequestError ? readConnectErrorRecoveryAdvice(err.details) : {};
    const retryWithDeviceTokenRecommended =
      recoveryAdvice.recommendedNextStep === "retry_with_device_token";
    const canRetryWithDeviceTokenHint =
      recoveryAdvice.canRetryWithDeviceToken === true ||
      retryWithDeviceTokenRecommended ||
      connectErrorCode === ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH;

    if (
      shouldRetryWithDeviceToken({
        deviceTokenRetryBudgetUsed: this.deviceTokenRetryBudgetUsed,
        authDeviceToken: plan.selectedAuth.authDeviceToken,
        explicitGatewayToken: plan.explicitGatewayToken,
        deviceIdentity: plan.deviceIdentity,
        storedToken: plan.selectedAuth.storedToken,
        canRetryWithDeviceTokenHint,
        url: this.opts.url,
      })
    ) {
      this.pendingDeviceTokenRetry = true;
      this.deviceTokenRetryBudgetUsed = true;
    }
    if (
      plan.deviceIdentity?.source === "host" &&
      !this.browserIdentityRetryBudgetUsed &&
      canUseBrowserGeneratedIdentity() &&
      (connectErrorCode === ConnectErrorDetailCodes.PAIRING_REQUIRED ||
        connectErrorCode === ConnectErrorDetailCodes.CONTROL_UI_DEVICE_IDENTITY_REQUIRED)
    ) {
      this.preferBrowserIdentityOnNextConnect = true;
      this.browserIdentityRetryBudgetUsed = true;
    }
    if (err instanceof GatewayRequestError) {
      this.pendingConnectError = {
        code: err.gatewayCode,
        message: err.message,
        details: err.details,
      };
    } else {
      this.pendingConnectError = undefined;
    }
    if (
      plan.selectedAuth.canFallbackToShared &&
      plan.deviceIdentity &&
      connectErrorCode === ConnectErrorDetailCodes.AUTH_DEVICE_TOKEN_MISMATCH
    ) {
      clearDeviceAuthToken({ deviceId: plan.deviceIdentity.deviceId, role: plan.role });
      if (plan.deviceIdentity.source === "browser") {
        clearStoredBrowserDeviceIdentity();
      }
    }
    this.ws?.close(CONNECT_FAILED_CLOSE_CODE, "connect failed");
  }

  private async sendConnect() {
    if (this.connectSent) {
      return;
    }
    const nonce = this.connectNonce?.trim() ?? "";
    if (!nonce) {
      this.closeWithPendingConnectError({
        code: "CONNECT_CHALLENGE_TIMEOUT",
        message: "gateway connect challenge missing nonce",
      });
      return;
    }
    this.connectSent = true;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    const plan = await this.buildConnectPlan();
    void this.request<GatewayHelloOk>("connect", this.buildConnectParams(plan))
      .then((hello) => this.handleConnectHello(hello, plan))
      .catch((err: unknown) => this.handleConnectFailure(err, plan));
  }

  private handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const frame = parsed as { type?: unknown };
    if (frame.type === "event") {
      const evt = parsed as GatewayEventFrame;
      if (evt.event === "connect.challenge") {
        const payload = evt.payload as { nonce?: unknown } | undefined;
        const nonce = payload && typeof payload.nonce === "string" ? payload.nonce : null;
        if (!nonce || nonce.trim().length === 0) {
          this.closeWithPendingConnectError({
            code: "CONNECT_CHALLENGE_TIMEOUT",
            message: "gateway connect challenge missing nonce",
          });
          return;
        }
        this.connectNonce = nonce.trim();
        if (this.connectTimer !== null) {
          window.clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
        void this.sendConnect();
        return;
      }
      const seq = typeof evt.seq === "number" ? evt.seq : null;
      if (seq !== null) {
        if (this.lastSeq !== null && seq > this.lastSeq + 1) {
          this.opts.onGap?.({ expected: this.lastSeq + 1, received: seq });
        }
        this.lastSeq = seq;
      }
      try {
        this.opts.onEvent?.(evt);
      } catch (err) {
        console.error("[gateway] event handler error:", err);
      }
      return;
    }

    if (frame.type === "res") {
      const res = parsed as GatewayResponseFrame;
      const pending = this.pending.get(res.id);
      if (!pending) {
        return;
      }
      this.pending.delete(res.id);
      if (res.ok) {
        pending.resolve(res.payload);
      } else {
        const requestError = new GatewayRequestError({
          code: res.error?.code ?? "UNAVAILABLE",
          message: res.error?.message ?? "request failed",
          details: res.error?.details,
        });
        pending.reject(requestError);
        if (pending.method !== "connect" && isRecoverableRequestAuthError(requestError)) {
          this.closeForRecoverableRequestError({
            code: requestError.gatewayCode,
            message: requestError.message,
            details: requestError.details,
          });
        }
      }
      return;
    }
  }

  private selectConnectAuth(params: { role: string; deviceId: string }): SelectedConnectAuth {
    const explicitGatewayToken = this.opts.token?.trim() || undefined;
    const explicitBootstrapToken = this.opts.bootstrapToken?.trim() || undefined;
    const authPassword = this.opts.password?.trim() || undefined;
    const storedEntry = loadDeviceAuthToken({
      deviceId: params.deviceId,
      role: params.role,
    });
    const storedScopes = storedEntry?.scopes ?? [];
    const storedTokenCanRead =
      params.role !== CONTROL_UI_OPERATOR_ROLE ||
      storedScopes.includes("operator.read") ||
      storedScopes.includes("operator.write") ||
      storedScopes.includes("operator.admin");
    const storedToken = storedTokenCanRead ? storedEntry?.token : undefined;
    const shouldUseDeviceRetryToken =
      this.pendingDeviceTokenRetry &&
      Boolean(explicitGatewayToken) &&
      Boolean(storedToken) &&
      isTrustedRetryEndpoint(this.opts.url);
    // Bootstrap setup codes are single-use. Once we have a cached device token for this
    // origin, prefer it over any preloaded bootstrap token so reconnects stay stable.
    const resolvedDeviceToken =
      !explicitGatewayToken && !authPassword ? (storedToken ?? undefined) : undefined;
    const authToken = explicitGatewayToken ?? resolvedDeviceToken;
    const authBootstrapToken =
      !explicitGatewayToken && !authPassword && !resolvedDeviceToken
        ? explicitBootstrapToken
        : undefined;
    return {
      authToken,
      authBootstrapToken,
      authDeviceToken: shouldUseDeviceRetryToken ? (storedToken ?? undefined) : undefined,
      authPassword,
      signatureToken: authToken ?? authBootstrapToken ?? undefined,
      resolvedDeviceToken,
      storedToken: storedToken ?? undefined,
      canFallbackToShared: Boolean(storedToken && explicitGatewayToken),
    };
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = generateUUID();
    const frame = { type: "req", id, method, params };
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: (v) => resolve(v as T), reject });
    });
    this.ws.send(JSON.stringify(frame));
    return p;
  }

  private beginPreauthHandshake() {
    this.lastSeq = null;
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
    }
    this.connectTimer = window.setTimeout(() => {
      this.closeWithPendingConnectError({
        code: "CONNECT_CHALLENGE_TIMEOUT",
        message: "gateway connect challenge timeout",
      });
    }, resolveConnectChallengeTimeoutMs(this.opts.connectChallengeTimeoutMs));
  }

  private closeWithPendingConnectError(error: GatewayErrorInfo) {
    this.pendingConnectError = error;
    this.ws?.close(CONNECT_FAILED_CLOSE_CODE, "connect failed");
  }

  private closeForRecoverableRequestError(error: GatewayErrorInfo) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.pendingConnectError = error;
    this.ws.close(CONNECT_FAILED_CLOSE_CODE, "request auth refresh");
  }
}
