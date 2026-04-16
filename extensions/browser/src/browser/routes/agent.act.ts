import { coerceSecretRef } from "alisio/plugin-sdk/config-runtime";
import { executeManagedBrowserAction } from "../browser-action-engine.js";
import { createBrowserAuthBroker } from "../browser-auth-broker.js";
import type { BrowserSessionSupervisor } from "../browser-session.types.js";
import {
  clickChromeMcpElement,
  closeChromeMcpTab,
  dragChromeMcpElement,
  evaluateChromeMcpScript,
  fillChromeMcpElement,
  fillChromeMcpForm,
  hoverChromeMcpElement,
  pressChromeMcpKey,
  resizeChromeMcpPage,
} from "../chrome-mcp.js";
import type {
  BrowserActRequest,
  BrowserFormField,
  BrowserSecretRefInput,
} from "../client-actions-core.js";
import { normalizeBrowserFormField } from "../form-fields.js";
import { getBrowserProfileCapabilities } from "../profile-capabilities.js";
import type { BrowserRouteContext } from "../server-context.js";
import { matchBrowserUrlPattern } from "../url-pattern.js";
import { registerBrowserAgentActDownloadRoutes } from "./agent.act.download.js";
import { registerBrowserAgentActHookRoutes } from "./agent.act.hooks.js";
import {
  type ActKind,
  isActKind,
  parseClickButton,
  parseClickModifiers,
} from "./agent.act.shared.js";
import {
  readBody,
  requirePwAi,
  resolveLeaseOwnerFromBody,
  resolveSessionKeyFromBody,
  resolveTabOrigin,
  resolveTargetIdFromBody,
  withRouteTabContext,
  SELECTOR_UNSUPPORTED_MESSAGE,
} from "./agent.shared.js";
import type { BrowserRouteRegistrar } from "./types.js";
import { jsonError, toBoolean, toNumber, toStringArray, toStringOrEmpty } from "./utils.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserEvaluateDisabledMessage(action: "wait" | "evaluate"): string {
  return [
    action === "wait"
      ? "wait --fn is disabled by config (browser.evaluateEnabled=false)."
      : "act:evaluate is disabled by config (browser.evaluateEnabled=false).",
    "Docs: /gateway/configuration#browser-alisio-managed-browser",
  ].join("\n");
}

function buildExistingSessionWaitPredicate(params: {
  text?: string;
  textGone?: string;
  selector?: string;
  loadState?: "load" | "domcontentloaded" | "networkidle";
  fn?: string;
}): string | null {
  const checks: string[] = [];
  if (params.text) {
    checks.push(`Boolean(document.body?.innerText?.includes(${JSON.stringify(params.text)}))`);
  }
  if (params.textGone) {
    checks.push(`!document.body?.innerText?.includes(${JSON.stringify(params.textGone)})`);
  }
  if (params.selector) {
    checks.push(`Boolean(document.querySelector(${JSON.stringify(params.selector)}))`);
  }
  if (params.loadState === "domcontentloaded") {
    checks.push(`document.readyState === "interactive" || document.readyState === "complete"`);
  } else if (params.loadState === "load") {
    checks.push(`document.readyState === "complete"`);
  }
  if (params.fn) {
    checks.push(`Boolean(await (${params.fn})())`);
  }
  if (checks.length === 0) {
    return null;
  }
  return checks.length === 1 ? checks[0] : checks.map((check) => `(${check})`).join(" && ");
}

async function waitForExistingSessionCondition(params: {
  profileName: string;
  userDataDir?: string;
  targetId: string;
  timeMs?: number;
  text?: string;
  textGone?: string;
  selector?: string;
  url?: string;
  loadState?: "load" | "domcontentloaded" | "networkidle";
  fn?: string;
  timeoutMs?: number;
}): Promise<void> {
  if (params.timeMs && params.timeMs > 0) {
    await sleep(params.timeMs);
  }
  const predicate = buildExistingSessionWaitPredicate(params);
  if (!predicate && !params.url) {
    return;
  }
  const timeoutMs = Math.max(250, params.timeoutMs ?? 10_000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let ready = true;
    if (predicate) {
      ready = Boolean(
        await evaluateChromeMcpScript({
          profileName: params.profileName,
          userDataDir: params.userDataDir,
          targetId: params.targetId,
          fn: `async () => ${predicate}`,
        }),
      );
    }
    if (ready && params.url) {
      const currentUrl = await evaluateChromeMcpScript({
        profileName: params.profileName,
        userDataDir: params.userDataDir,
        targetId: params.targetId,
        fn: "() => window.location.href",
      });
      ready = typeof currentUrl === "string" && matchBrowserUrlPattern(params.url, currentUrl);
    }
    if (ready) {
      return;
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for condition");
}

const SELECTOR_ALLOWED_KINDS: ReadonlySet<string> = new Set([
  "batch",
  "click",
  "drag",
  "hover",
  "scrollIntoView",
  "select",
  "type",
  "wait",
]);
const MAX_BATCH_ACTIONS = 100;
const MAX_BATCH_CLICK_DELAY_MS = 5_000;
const MAX_BATCH_WAIT_TIME_MS = 30_000;

function normalizeBoundedNonNegativeMs(
  value: unknown,
  fieldName: string,
  maxMs: number,
): number | undefined {
  const ms = toNumber(value);
  if (ms === undefined) {
    return undefined;
  }
  if (ms < 0) {
    throw new Error(`${fieldName} must be >= 0`);
  }
  const normalized = Math.floor(ms);
  if (normalized > maxMs) {
    throw new Error(`${fieldName} exceeds maximum of ${maxMs}ms`);
  }
  return normalized;
}

function countBatchActions(actions: BrowserActRequest[]): number {
  let count = 0;
  for (const action of actions) {
    count += 1;
    if (action.kind === "batch") {
      count += countBatchActions(action.actions);
    }
  }
  return count;
}

function getBrowserSessionSupervisor(ctx: BrowserRouteContext): BrowserSessionSupervisor {
  const supervisor = ctx.state().supervisor;
  if (!supervisor) {
    throw new Error("Browser session supervisor unavailable");
  }
  return supervisor;
}

function normalizeBrowserSecretRefInput(value: unknown): BrowserSecretRefInput | undefined {
  const ref = coerceSecretRef(value);
  if (!ref) {
    return undefined;
  }
  return {
    source: ref.source,
    provider: ref.provider,
    id: ref.id,
  };
}

function buildManagedAuthStateInspector(params: {
  pw: NonNullable<Awaited<ReturnType<typeof requirePwAi>>>;
  cdpUrl: string;
  targetId: string;
}) {
  return async () => {
    const [cookies, localStorage, sessionStorage] = await Promise.all([
      params.pw.cookiesGetViaPlaywright({
        cdpUrl: params.cdpUrl,
        targetId: params.targetId,
      }),
      params.pw.storageGetViaPlaywright({
        cdpUrl: params.cdpUrl,
        targetId: params.targetId,
        kind: "local",
      }),
      params.pw.storageGetViaPlaywright({
        cdpUrl: params.cdpUrl,
        targetId: params.targetId,
        kind: "session",
      }),
    ]);
    return {
      cookies: Array.isArray(cookies.cookies) && cookies.cookies.length > 0,
      localStorage: Object.keys(localStorage.values ?? {}).length > 0,
      sessionStorage: Object.keys(sessionStorage.values ?? {}).length > 0,
    };
  };
}

function validateBatchTargetIds(actions: BrowserActRequest[], targetId: string): string | null {
  for (const action of actions) {
    if (action.targetId && action.targetId !== targetId) {
      return "batched action targetId must match request targetId";
    }
    if (action.kind === "batch") {
      const nestedError = validateBatchTargetIds(action.actions, targetId);
      if (nestedError) {
        return nestedError;
      }
    }
  }
  return null;
}

function normalizeBatchAction(value: unknown): BrowserActRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("batch actions must be objects");
  }
  const raw = value as Record<string, unknown>;
  const kind = toStringOrEmpty(raw.kind);
  if (!isActKind(kind)) {
    throw new Error("batch actions must use a supported kind");
  }

  switch (kind) {
    case "click": {
      const ref = toStringOrEmpty(raw.ref) || undefined;
      const selector = toStringOrEmpty(raw.selector) || undefined;
      if (!ref && !selector) {
        throw new Error("click requires ref or selector");
      }
      const buttonRaw = toStringOrEmpty(raw.button);
      const button = buttonRaw ? parseClickButton(buttonRaw) : undefined;
      if (buttonRaw && !button) {
        throw new Error("click button must be left|right|middle");
      }
      const modifiersRaw = toStringArray(raw.modifiers) ?? [];
      const parsedModifiers = parseClickModifiers(modifiersRaw);
      if (parsedModifiers.error) {
        throw new Error(parsedModifiers.error);
      }
      const doubleClick = toBoolean(raw.doubleClick);
      const delayMs = normalizeBoundedNonNegativeMs(
        raw.delayMs,
        "click delayMs",
        MAX_BATCH_CLICK_DELAY_MS,
      );
      const timeoutMs = toNumber(raw.timeoutMs);
      const targetId = toStringOrEmpty(raw.targetId) || undefined;
      return {
        kind,
        ...(ref ? { ref } : {}),
        ...(selector ? { selector } : {}),
        ...(targetId ? { targetId } : {}),
        ...(doubleClick !== undefined ? { doubleClick } : {}),
        ...(button ? { button } : {}),
        ...(parsedModifiers.modifiers ? { modifiers: parsedModifiers.modifiers } : {}),
        ...(delayMs !== undefined ? { delayMs } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      };
    }
    case "type": {
      const ref = toStringOrEmpty(raw.ref) || undefined;
      const selector = toStringOrEmpty(raw.selector) || undefined;
      const text = raw.text;
      const textRef = normalizeBrowserSecretRefInput(raw.textRef);
      if (!ref && !selector) {
        throw new Error("type requires ref or selector");
      }
      if (typeof text !== "string" && !textRef) {
        throw new Error("type requires text");
      }
      const targetId = toStringOrEmpty(raw.targetId) || undefined;
      const submit = toBoolean(raw.submit);
      const slowly = toBoolean(raw.slowly);
      const preferReuseSession = toBoolean(raw.preferReuseSession);
      const timeoutMs = toNumber(raw.timeoutMs);
      return {
        kind,
        ...(ref ? { ref } : {}),
        ...(selector ? { selector } : {}),
        ...(typeof text === "string" ? { text } : { text: "" }),
        ...(textRef ? { textRef } : {}),
        ...(targetId ? { targetId } : {}),
        ...(submit !== undefined ? { submit } : {}),
        ...(slowly !== undefined ? { slowly } : {}),
        ...(preferReuseSession !== undefined ? { preferReuseSession } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      };
    }
    case "press": {
      const key = toStringOrEmpty(raw.key);
      if (!key) {
        throw new Error("press requires key");
      }
      const targetId = toStringOrEmpty(raw.targetId) || undefined;
      const delayMs = toNumber(raw.delayMs);
      return {
        kind,
        key,
        ...(targetId ? { targetId } : {}),
        ...(delayMs !== undefined ? { delayMs } : {}),
      };
    }
    case "hover":
    case "scrollIntoView": {
      const ref = toStringOrEmpty(raw.ref) || undefined;
      const selector = toStringOrEmpty(raw.selector) || undefined;
      if (!ref && !selector) {
        throw new Error(`${kind} requires ref or selector`);
      }
      const targetId = toStringOrEmpty(raw.targetId) || undefined;
      const timeoutMs = toNumber(raw.timeoutMs);
      return {
        kind,
        ...(ref ? { ref } : {}),
        ...(selector ? { selector } : {}),
        ...(targetId ? { targetId } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      };
    }
    case "drag": {
      const startRef = toStringOrEmpty(raw.startRef) || undefined;
      const startSelector = toStringOrEmpty(raw.startSelector) || undefined;
      const endRef = toStringOrEmpty(raw.endRef) || undefined;
      const endSelector = toStringOrEmpty(raw.endSelector) || undefined;
      if (!startRef && !startSelector) {
        throw new Error("drag requires startRef or startSelector");
      }
      if (!endRef && !endSelector) {
        throw new Error("drag requires endRef or endSelector");
      }
      const targetId = toStringOrEmpty(raw.targetId) || undefined;
      const timeoutMs = toNumber(raw.timeoutMs);
      return {
        kind,
        ...(startRef ? { startRef } : {}),
        ...(startSelector ? { startSelector } : {}),
        ...(endRef ? { endRef } : {}),
        ...(endSelector ? { endSelector } : {}),
        ...(targetId ? { targetId } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      };
    }
    case "select": {
      const ref = toStringOrEmpty(raw.ref) || undefined;
      const selector = toStringOrEmpty(raw.selector) || undefined;
      const values = toStringArray(raw.values);
      if ((!ref && !selector) || !values?.length) {
        throw new Error("select requires ref/selector and values");
      }
      const targetId = toStringOrEmpty(raw.targetId) || undefined;
      const timeoutMs = toNumber(raw.timeoutMs);
      return {
        kind,
        ...(ref ? { ref } : {}),
        ...(selector ? { selector } : {}),
        values,
        ...(targetId ? { targetId } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      };
    }
    case "fill": {
      const rawFields = Array.isArray(raw.fields) ? raw.fields : [];
      const fields = rawFields
        .map((field) => {
          if (!field || typeof field !== "object") {
            return null;
          }
          return normalizeBrowserFormField(field as Record<string, unknown>);
        })
        .filter((field): field is BrowserFormField => field !== null);
      if (!fields.length) {
        throw new Error("fill requires fields");
      }
      const targetId = toStringOrEmpty(raw.targetId) || undefined;
      const preferReuseSession = toBoolean(raw.preferReuseSession);
      const timeoutMs = toNumber(raw.timeoutMs);
      return {
        kind,
        fields,
        ...(targetId ? { targetId } : {}),
        ...(preferReuseSession !== undefined ? { preferReuseSession } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      };
    }
    case "resize": {
      const width = toNumber(raw.width);
      const height = toNumber(raw.height);
      if (width === undefined || height === undefined) {
        throw new Error("resize requires width and height");
      }
      const targetId = toStringOrEmpty(raw.targetId) || undefined;
      return {
        kind,
        width,
        height,
        ...(targetId ? { targetId } : {}),
      };
    }
    case "wait": {
      const loadStateRaw = toStringOrEmpty(raw.loadState);
      const loadState =
        loadStateRaw === "load" ||
        loadStateRaw === "domcontentloaded" ||
        loadStateRaw === "networkidle"
          ? loadStateRaw
          : undefined;
      const timeMs = normalizeBoundedNonNegativeMs(
        raw.timeMs,
        "wait timeMs",
        MAX_BATCH_WAIT_TIME_MS,
      );
      const text = toStringOrEmpty(raw.text) || undefined;
      const textGone = toStringOrEmpty(raw.textGone) || undefined;
      const selector = toStringOrEmpty(raw.selector) || undefined;
      const url = toStringOrEmpty(raw.url) || undefined;
      const fn = toStringOrEmpty(raw.fn) || undefined;
      if (timeMs === undefined && !text && !textGone && !selector && !url && !loadState && !fn) {
        throw new Error(
          "wait requires at least one of: timeMs, text, textGone, selector, url, loadState, fn",
        );
      }
      const targetId = toStringOrEmpty(raw.targetId) || undefined;
      const timeoutMs = toNumber(raw.timeoutMs);
      return {
        kind,
        ...(timeMs !== undefined ? { timeMs } : {}),
        ...(text ? { text } : {}),
        ...(textGone ? { textGone } : {}),
        ...(selector ? { selector } : {}),
        ...(url ? { url } : {}),
        ...(loadState ? { loadState } : {}),
        ...(fn ? { fn } : {}),
        ...(targetId ? { targetId } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      };
    }
    case "evaluate": {
      const fn = toStringOrEmpty(raw.fn);
      if (!fn) {
        throw new Error("evaluate requires fn");
      }
      const ref = toStringOrEmpty(raw.ref) || undefined;
      const targetId = toStringOrEmpty(raw.targetId) || undefined;
      const timeoutMs = toNumber(raw.timeoutMs);
      return {
        kind,
        fn,
        ...(ref ? { ref } : {}),
        ...(targetId ? { targetId } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      };
    }
    case "close": {
      const targetId = toStringOrEmpty(raw.targetId) || undefined;
      return {
        kind,
        ...(targetId ? { targetId } : {}),
      };
    }
    case "batch": {
      const actions = Array.isArray(raw.actions) ? raw.actions.map(normalizeBatchAction) : [];
      if (!actions.length) {
        throw new Error("batch requires actions");
      }
      if (countBatchActions(actions) > MAX_BATCH_ACTIONS) {
        throw new Error(`batch exceeds maximum of ${MAX_BATCH_ACTIONS} actions`);
      }
      const targetId = toStringOrEmpty(raw.targetId) || undefined;
      const stopOnError = toBoolean(raw.stopOnError);
      return {
        kind,
        actions,
        ...(targetId ? { targetId } : {}),
        ...(stopOnError !== undefined ? { stopOnError } : {}),
      };
    }
  }
}

export function registerBrowserAgentActRoutes(
  app: BrowserRouteRegistrar,
  ctx: BrowserRouteContext,
) {
  app.post("/act", async (req, res) => {
    const body = readBody(req);
    const kindRaw = toStringOrEmpty(body.kind);
    if (!isActKind(kindRaw)) {
      return jsonError(res, 400, "kind is required");
    }
    const kind: ActKind = kindRaw;
    const targetId = resolveTargetIdFromBody(body);
    const sessionKey = resolveSessionKeyFromBody(body);
    const leaseOwner = resolveLeaseOwnerFromBody(body);
    if (Object.hasOwn(body, "selector") && !SELECTOR_ALLOWED_KINDS.has(kind)) {
      return jsonError(res, 400, SELECTOR_UNSUPPORTED_MESSAGE);
    }
    const earlyFn = kind === "wait" || kind === "evaluate" ? toStringOrEmpty(body.fn) : "";
    if (
      (kind === "evaluate" || (kind === "wait" && earlyFn)) &&
      !ctx.state().resolved.evaluateEnabled
    ) {
      return jsonError(
        res,
        403,
        browserEvaluateDisabledMessage(kind === "evaluate" ? "evaluate" : "wait"),
      );
    }

    await withRouteTabContext({
      req,
      res,
      ctx,
      targetId,
      run: async ({ profileCtx, cdpUrl, tab }) => {
        const supervisor = getBrowserSessionSupervisor(ctx);
        const authBroker = createBrowserAuthBroker({
          authCache: ctx.state().authCache,
        });
        const evaluateEnabled = ctx.state().resolved.evaluateEnabled;
        const isExistingSession = getBrowserProfileCapabilities(profileCtx.profile).usesChromeMcp;
        const profileName = profileCtx.profile.name;
        const tabOrigin = resolveTabOrigin(tab.url);
        const pw = isExistingSession ? null : await requirePwAi(res, `act:${kind}`);
        if (!isExistingSession && !pw) {
          return;
        }
        const inspectManagedAuthState = pw
          ? buildManagedAuthStateInspector({
              pw,
              cdpUrl,
              targetId: tab.targetId,
            })
          : undefined;

        switch (kind) {
          case "click": {
            const ref = toStringOrEmpty(body.ref) || undefined;
            const selector = toStringOrEmpty(body.selector) || undefined;
            if (!ref && !selector) {
              return jsonError(res, 400, "ref or selector is required");
            }
            const doubleClick = toBoolean(body.doubleClick) ?? false;
            const timeoutMs = toNumber(body.timeoutMs);
            const delayMs = toNumber(body.delayMs);
            const buttonRaw = toStringOrEmpty(body.button) || "";
            const button = buttonRaw ? parseClickButton(buttonRaw) : undefined;
            if (buttonRaw && !button) {
              return jsonError(res, 400, "button must be left|right|middle");
            }

            const modifiersRaw = toStringArray(body.modifiers) ?? [];
            const parsedModifiers = parseClickModifiers(modifiersRaw);
            if (parsedModifiers.error) {
              return jsonError(res, 400, parsedModifiers.error);
            }
            const modifiers = parsedModifiers.modifiers;
            if (isExistingSession) {
              if (selector) {
                return jsonError(
                  res,
                  501,
                  "existing-session click does not support selector targeting yet; use ref.",
                );
              }
              if ((button && button !== "left") || (modifiers && modifiers.length > 0)) {
                return jsonError(
                  res,
                  501,
                  "existing-session click currently supports left-click only (no button overrides/modifiers).",
                );
              }
            }
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                if (isExistingSession) {
                  await clickChromeMcpElement({
                    profileName,
                    userDataDir: profileCtx.profile.userDataDir,
                    targetId: tab.targetId,
                    uid: ref!,
                    doubleClick,
                  });
                  reportExecution({ layer: "semantic" });
                  return null;
                }
                const clickRequest: Parameters<NonNullable<typeof pw>["clickViaPlaywright"]>[0] = {
                  cdpUrl,
                  targetId: tab.targetId,
                  doubleClick,
                  signal: req.signal,
                  onExecutionPath: reportExecution,
                };
                if (ref) {
                  clickRequest.ref = ref;
                }
                if (selector) {
                  clickRequest.selector = selector;
                }
                if (button) {
                  clickRequest.button = button;
                }
                if (modifiers) {
                  clickRequest.modifiers = modifiers;
                }
                if (delayMs) {
                  clickRequest.delayMs = delayMs;
                }
                if (timeoutMs) {
                  clickRequest.timeoutMs = timeoutMs;
                }
                await pw!.clickViaPlaywright(clickRequest);
                return null;
              },
            });
            return res.json({
              ok: true,
              targetId: tab.targetId,
              url: tab.url,
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          case "type": {
            const ref = toStringOrEmpty(body.ref) || undefined;
            const selector = toStringOrEmpty(body.selector) || undefined;
            if (!ref && !selector) {
              return jsonError(res, 400, "ref or selector is required");
            }
            const hasTextRef =
              typeof body.textRef === "object" && body.textRef && !Array.isArray(body.textRef);
            if (typeof body.text !== "string" && !hasTextRef) {
              return jsonError(res, 400, "text is required");
            }
            const text = typeof body.text === "string" ? body.text : "";
            const submit = toBoolean(body.submit) ?? false;
            const slowly = toBoolean(body.slowly) ?? false;
            const preferReuseSession = toBoolean(body.preferReuseSession) ?? false;
            const timeoutMs = toNumber(body.timeoutMs);
            if (isExistingSession) {
              if (selector) {
                return jsonError(
                  res,
                  501,
                  "existing-session type does not support selector targeting yet; use ref.",
                );
              }
              if (slowly) {
                return jsonError(
                  res,
                  501,
                  "existing-session type does not support slowly=true; use fill/press instead.",
                );
              }
            }
            const resolvedType = await authBroker.resolveTypeInput({
              text,
              textRef: body.textRef,
              preferReuseSession,
              sessionKey,
              origin: tabOrigin,
              inspectSessionState: inspectManagedAuthState,
            });
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                if (isExistingSession) {
                  if (!resolvedType.skipped) {
                    await fillChromeMcpElement({
                      profileName,
                      userDataDir: profileCtx.profile.userDataDir,
                      targetId: tab.targetId,
                      uid: ref!,
                      value: resolvedType.text ?? "",
                    });
                    if (submit) {
                      await pressChromeMcpKey({
                        profileName,
                        userDataDir: profileCtx.profile.userDataDir,
                        targetId: tab.targetId,
                        key: "Enter",
                      });
                    }
                  }
                  reportExecution({
                    layer: "semantic",
                    reusedAuth: resolvedType.auth?.status === "reused",
                    blindFilled: resolvedType.auth?.method === "blind-fill",
                  });
                  return null;
                }
                if (resolvedType.skipped) {
                  reportExecution({
                    layer: "semantic",
                    reusedAuth: true,
                  });
                  return null;
                }
                const typeRequest: Parameters<NonNullable<typeof pw>["typeViaPlaywright"]>[0] = {
                  cdpUrl,
                  targetId: tab.targetId,
                  text: resolvedType.text ?? "",
                  submit,
                  slowly,
                  signal: req.signal,
                  onExecutionPath: (summary) =>
                    reportExecution({
                      ...summary,
                      reusedAuth:
                        summary.reusedAuth === true || resolvedType.auth?.status === "reused",
                      blindFilled:
                        summary.blindFilled === true || resolvedType.auth?.method === "blind-fill",
                    }),
                };
                if (ref) {
                  typeRequest.ref = ref;
                }
                if (selector) {
                  typeRequest.selector = selector;
                }
                if (timeoutMs) {
                  typeRequest.timeoutMs = timeoutMs;
                }
                await pw!.typeViaPlaywright(typeRequest);
                return null;
              },
            });
            if (sessionKey && resolvedType.auth) {
              supervisor.recordSessionAuth({
                sessionKey,
                origin: resolvedType.auth.origin ?? tabOrigin,
                status: resolvedType.auth.status,
                method: resolvedType.auth.method,
                targetId: tab.targetId,
                fields: resolvedType.auth.fields,
              });
            }
            return res.json({
              ok: true,
              targetId: tab.targetId,
              ...(resolvedType.auth ? { auth: resolvedType.auth } : {}),
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          case "press": {
            const key = toStringOrEmpty(body.key);
            if (!key) {
              return jsonError(res, 400, "key is required");
            }
            const delayMs = toNumber(body.delayMs);
            if (isExistingSession) {
              if (delayMs) {
                return jsonError(res, 501, "existing-session press does not support delayMs.");
              }
            }
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                if (isExistingSession) {
                  await pressChromeMcpKey({
                    profileName,
                    userDataDir: profileCtx.profile.userDataDir,
                    targetId: tab.targetId,
                    key,
                  });
                  reportExecution({ layer: "semantic" });
                  return null;
                }
                await pw!.pressKeyViaPlaywright({
                  cdpUrl,
                  targetId: tab.targetId,
                  key,
                  delayMs: delayMs ?? undefined,
                  signal: req.signal,
                });
                return null;
              },
            });
            return res.json({
              ok: true,
              targetId: tab.targetId,
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          case "hover": {
            const ref = toStringOrEmpty(body.ref) || undefined;
            const selector = toStringOrEmpty(body.selector) || undefined;
            if (!ref && !selector) {
              return jsonError(res, 400, "ref or selector is required");
            }
            const timeoutMs = toNumber(body.timeoutMs);
            if (isExistingSession) {
              if (selector) {
                return jsonError(
                  res,
                  501,
                  "existing-session hover does not support selector targeting yet; use ref.",
                );
              }
              if (timeoutMs) {
                return jsonError(
                  res,
                  501,
                  "existing-session hover does not support timeoutMs overrides.",
                );
              }
            }
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                if (isExistingSession) {
                  await hoverChromeMcpElement({
                    profileName,
                    userDataDir: profileCtx.profile.userDataDir,
                    targetId: tab.targetId,
                    uid: ref!,
                  });
                  reportExecution({ layer: "semantic" });
                  return null;
                }
                await pw!.hoverViaPlaywright({
                  cdpUrl,
                  targetId: tab.targetId,
                  ref,
                  selector,
                  timeoutMs: timeoutMs ?? undefined,
                  signal: req.signal,
                  onExecutionPath: reportExecution,
                });
                return null;
              },
            });
            return res.json({
              ok: true,
              targetId: tab.targetId,
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          case "scrollIntoView": {
            const ref = toStringOrEmpty(body.ref) || undefined;
            const selector = toStringOrEmpty(body.selector) || undefined;
            if (!ref && !selector) {
              return jsonError(res, 400, "ref or selector is required");
            }
            const timeoutMs = toNumber(body.timeoutMs);
            if (isExistingSession) {
              if (selector) {
                return jsonError(
                  res,
                  501,
                  "existing-session scrollIntoView does not support selector targeting yet; use ref.",
                );
              }
              if (timeoutMs) {
                return jsonError(
                  res,
                  501,
                  "existing-session scrollIntoView does not support timeoutMs overrides.",
                );
              }
            }
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                if (isExistingSession) {
                  await evaluateChromeMcpScript({
                    profileName,
                    userDataDir: profileCtx.profile.userDataDir,
                    targetId: tab.targetId,
                    fn: `(el) => { el.scrollIntoView({ block: "center", inline: "center" }); return true; }`,
                    args: [ref!],
                  });
                  reportExecution({ layer: "semantic" });
                  return null;
                }
                const scrollRequest: Parameters<
                  NonNullable<typeof pw>["scrollIntoViewViaPlaywright"]
                >[0] = {
                  cdpUrl,
                  targetId: tab.targetId,
                  signal: req.signal,
                };
                if (ref) {
                  scrollRequest.ref = ref;
                }
                if (selector) {
                  scrollRequest.selector = selector;
                }
                if (timeoutMs) {
                  scrollRequest.timeoutMs = timeoutMs;
                }
                await pw!.scrollIntoViewViaPlaywright(scrollRequest);
                return null;
              },
            });
            return res.json({
              ok: true,
              targetId: tab.targetId,
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          case "drag": {
            const startRef = toStringOrEmpty(body.startRef) || undefined;
            const startSelector = toStringOrEmpty(body.startSelector) || undefined;
            const endRef = toStringOrEmpty(body.endRef) || undefined;
            const endSelector = toStringOrEmpty(body.endSelector) || undefined;
            if (!startRef && !startSelector) {
              return jsonError(res, 400, "startRef or startSelector is required");
            }
            if (!endRef && !endSelector) {
              return jsonError(res, 400, "endRef or endSelector is required");
            }
            const timeoutMs = toNumber(body.timeoutMs);
            if (isExistingSession) {
              if (startSelector || endSelector) {
                return jsonError(
                  res,
                  501,
                  "existing-session drag does not support selector targeting yet; use startRef/endRef.",
                );
              }
              if (timeoutMs) {
                return jsonError(
                  res,
                  501,
                  "existing-session drag does not support timeoutMs overrides.",
                );
              }
            }
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                if (isExistingSession) {
                  await dragChromeMcpElement({
                    profileName,
                    userDataDir: profileCtx.profile.userDataDir,
                    targetId: tab.targetId,
                    fromUid: startRef!,
                    toUid: endRef!,
                  });
                  reportExecution({ layer: "semantic" });
                  return null;
                }
                await pw!.dragViaPlaywright({
                  cdpUrl,
                  targetId: tab.targetId,
                  startRef,
                  startSelector,
                  endRef,
                  endSelector,
                  timeoutMs: timeoutMs ?? undefined,
                  signal: req.signal,
                  onExecutionPath: reportExecution,
                });
                return null;
              },
            });
            return res.json({
              ok: true,
              targetId: tab.targetId,
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          case "select": {
            const ref = toStringOrEmpty(body.ref) || undefined;
            const selector = toStringOrEmpty(body.selector) || undefined;
            const values = toStringArray(body.values);
            if ((!ref && !selector) || !values?.length) {
              return jsonError(res, 400, "ref/selector and values are required");
            }
            const timeoutMs = toNumber(body.timeoutMs);
            if (isExistingSession) {
              if (selector) {
                return jsonError(
                  res,
                  501,
                  "existing-session select does not support selector targeting yet; use ref.",
                );
              }
              if (values.length !== 1) {
                return jsonError(
                  res,
                  501,
                  "existing-session select currently supports a single value only.",
                );
              }
              if (timeoutMs) {
                return jsonError(
                  res,
                  501,
                  "existing-session select does not support timeoutMs overrides.",
                );
              }
            }
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                if (isExistingSession) {
                  await fillChromeMcpElement({
                    profileName,
                    userDataDir: profileCtx.profile.userDataDir,
                    targetId: tab.targetId,
                    uid: ref!,
                    value: values[0] ?? "",
                  });
                  reportExecution({ layer: "semantic" });
                  return null;
                }
                await pw!.selectOptionViaPlaywright({
                  cdpUrl,
                  targetId: tab.targetId,
                  ref,
                  selector,
                  values,
                  timeoutMs: timeoutMs ?? undefined,
                  signal: req.signal,
                });
                return null;
              },
            });
            return res.json({
              ok: true,
              targetId: tab.targetId,
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          case "fill": {
            const rawFields = Array.isArray(body.fields) ? body.fields : [];
            const fields = rawFields
              .map((field) => {
                if (!field || typeof field !== "object") {
                  return null;
                }
                return normalizeBrowserFormField(field as Record<string, unknown>);
              })
              .filter((field): field is BrowserFormField => field !== null);
            if (!fields.length) {
              return jsonError(res, 400, "fields are required");
            }
            const preferReuseSession = toBoolean(body.preferReuseSession) ?? false;
            const timeoutMs = toNumber(body.timeoutMs);
            if (isExistingSession) {
              if (timeoutMs) {
                return jsonError(
                  res,
                  501,
                  "existing-session fill does not support timeoutMs overrides.",
                );
              }
            }
            const resolvedFill = await authBroker.resolveFormFill({
              fields,
              preferReuseSession,
              sessionKey,
              origin: tabOrigin,
              inspectSessionState: inspectManagedAuthState,
            });
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                if (isExistingSession) {
                  if (resolvedFill.fields.length > 0) {
                    await fillChromeMcpForm({
                      profileName,
                      userDataDir: profileCtx.profile.userDataDir,
                      targetId: tab.targetId,
                      elements: resolvedFill.fields.map((field) => ({
                        uid: field.ref,
                        value: String(field.value ?? ""),
                      })),
                    });
                  }
                  reportExecution({
                    layer: "semantic",
                    reusedAuth: resolvedFill.auth?.status === "reused",
                    blindFilled: resolvedFill.auth?.method === "blind-fill",
                  });
                  return null;
                }
                if (resolvedFill.fields.length === 0) {
                  reportExecution({
                    layer: "semantic",
                    reusedAuth: resolvedFill.auth?.status === "reused",
                  });
                  return null;
                }
                await pw!.fillFormViaPlaywright({
                  cdpUrl,
                  targetId: tab.targetId,
                  fields: resolvedFill.fields,
                  timeoutMs: timeoutMs ?? undefined,
                  signal: req.signal,
                  onExecutionPath: (summary) =>
                    reportExecution({
                      ...summary,
                      reusedAuth:
                        summary.reusedAuth === true || resolvedFill.auth?.status === "reused",
                      blindFilled:
                        summary.blindFilled === true || resolvedFill.auth?.method === "blind-fill",
                    }),
                });
                return null;
              },
            });
            if (sessionKey && resolvedFill.auth) {
              supervisor.recordSessionAuth({
                sessionKey,
                origin: resolvedFill.auth.origin ?? tabOrigin,
                status: resolvedFill.auth.status,
                method: resolvedFill.auth.method,
                targetId: tab.targetId,
                fields: resolvedFill.auth.fields,
              });
            }
            return res.json({
              ok: true,
              targetId: tab.targetId,
              ...(resolvedFill.auth ? { auth: resolvedFill.auth } : {}),
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          case "resize": {
            const width = toNumber(body.width);
            const height = toNumber(body.height);
            if (!width || !height) {
              return jsonError(res, 400, "width and height are required");
            }
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                if (isExistingSession) {
                  await resizeChromeMcpPage({
                    profileName,
                    userDataDir: profileCtx.profile.userDataDir,
                    targetId: tab.targetId,
                    width,
                    height,
                  });
                  reportExecution({ layer: "semantic" });
                  return null;
                }
                await pw!.resizeViewportViaPlaywright({
                  cdpUrl,
                  targetId: tab.targetId,
                  width,
                  height,
                });
                return null;
              },
            });
            return res.json({
              ok: true,
              targetId: tab.targetId,
              url: tab.url,
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          case "wait": {
            const timeMs = toNumber(body.timeMs);
            const text = toStringOrEmpty(body.text) || undefined;
            const textGone = toStringOrEmpty(body.textGone) || undefined;
            const selector = toStringOrEmpty(body.selector) || undefined;
            const url = toStringOrEmpty(body.url) || undefined;
            const loadStateRaw = toStringOrEmpty(body.loadState);
            const loadState =
              loadStateRaw === "load" ||
              loadStateRaw === "domcontentloaded" ||
              loadStateRaw === "networkidle"
                ? loadStateRaw
                : undefined;
            const fn = toStringOrEmpty(body.fn) || undefined;
            const timeoutMs = toNumber(body.timeoutMs) ?? undefined;
            if (fn && !evaluateEnabled) {
              return jsonError(res, 403, browserEvaluateDisabledMessage("wait"));
            }
            if (
              timeMs === undefined &&
              !text &&
              !textGone &&
              !selector &&
              !url &&
              !loadState &&
              !fn
            ) {
              return jsonError(
                res,
                400,
                "wait requires at least one of: timeMs, text, textGone, selector, url, loadState, fn",
              );
            }
            if (isExistingSession) {
              if (loadState === "networkidle") {
                return jsonError(
                  res,
                  501,
                  "existing-session wait does not support loadState=networkidle yet.",
                );
              }
            }
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                if (isExistingSession) {
                  await waitForExistingSessionCondition({
                    profileName,
                    userDataDir: profileCtx.profile.userDataDir,
                    targetId: tab.targetId,
                    timeMs,
                    text,
                    textGone,
                    selector,
                    url,
                    loadState,
                    fn,
                    timeoutMs,
                  });
                  reportExecution({ layer: "semantic" });
                  return null;
                }
                await pw!.waitForViaPlaywright({
                  cdpUrl,
                  targetId: tab.targetId,
                  timeMs,
                  text,
                  textGone,
                  selector,
                  url,
                  loadState,
                  fn,
                  timeoutMs,
                  signal: req.signal,
                });
                return null;
              },
            });
            return res.json({
              ok: true,
              targetId: tab.targetId,
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          case "evaluate": {
            if (!evaluateEnabled) {
              return jsonError(res, 403, browserEvaluateDisabledMessage("evaluate"));
            }
            const fn = toStringOrEmpty(body.fn);
            if (!fn) {
              return jsonError(res, 400, "fn is required");
            }
            const ref = toStringOrEmpty(body.ref) || undefined;
            const evalTimeoutMs = toNumber(body.timeoutMs);
            if (isExistingSession) {
              if (evalTimeoutMs !== undefined) {
                return jsonError(
                  res,
                  501,
                  "existing-session evaluate does not support timeoutMs overrides.",
                );
              }
            }
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                if (isExistingSession) {
                  const result = await evaluateChromeMcpScript({
                    profileName,
                    userDataDir: profileCtx.profile.userDataDir,
                    targetId: tab.targetId,
                    fn,
                    args: ref ? [ref] : undefined,
                  });
                  reportExecution({ layer: "semantic" });
                  return result;
                }
                const evalRequest: Parameters<NonNullable<typeof pw>["evaluateViaPlaywright"]>[0] =
                  {
                    cdpUrl,
                    targetId: tab.targetId,
                    fn,
                    ref,
                    signal: req.signal,
                  };
                if (evalTimeoutMs !== undefined) {
                  evalRequest.timeoutMs = evalTimeoutMs;
                }
                return await pw!.evaluateViaPlaywright(evalRequest);
              },
            });
            return res.json({
              ok: true,
              targetId: tab.targetId,
              url: tab.url,
              result: executed.result,
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          case "close": {
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                if (isExistingSession) {
                  await closeChromeMcpTab(
                    profileName,
                    tab.targetId,
                    profileCtx.profile.userDataDir,
                  );
                  reportExecution({ layer: "semantic" });
                  return null;
                }
                await pw!.closePageViaPlaywright({ cdpUrl, targetId: tab.targetId });
                return null;
              },
            });
            return res.json({
              ok: true,
              targetId: tab.targetId,
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          case "batch": {
            if (isExistingSession) {
              return jsonError(
                res,
                501,
                "existing-session batch is not supported yet; send actions individually.",
              );
            }
            let actions: BrowserActRequest[];
            try {
              actions = Array.isArray(body.actions) ? body.actions.map(normalizeBatchAction) : [];
            } catch (err) {
              return jsonError(res, 400, err instanceof Error ? err.message : String(err));
            }
            if (!actions.length) {
              return jsonError(res, 400, "actions are required");
            }
            if (countBatchActions(actions) > MAX_BATCH_ACTIONS) {
              return jsonError(res, 400, `batch exceeds maximum of ${MAX_BATCH_ACTIONS} actions`);
            }
            const targetIdError = validateBatchTargetIds(actions, tab.targetId);
            if (targetIdError) {
              return jsonError(res, 403, targetIdError);
            }
            const stopOnError = toBoolean(body.stopOnError) ?? true;
            const executed = await executeManagedBrowserAction({
              supervisor,
              sessionKey,
              owner: leaseOwner,
              kind,
              targetId: tab.targetId,
              execute: async (reportExecution) => {
                const result = await pw!.batchViaPlaywright({
                  cdpUrl,
                  targetId: tab.targetId,
                  actions,
                  stopOnError,
                  evaluateEnabled,
                  signal: req.signal,
                });
                reportExecution({ layer: "semantic" });
                return result;
              },
            });
            return res.json({
              ok: true,
              targetId: tab.targetId,
              results: executed.result.results,
              ...(executed.action ? { action: executed.action } : {}),
            });
          }
          default: {
            return jsonError(res, 400, "unsupported kind");
          }
        }
      },
    });
  });

  registerBrowserAgentActHookRoutes(app, ctx);
  registerBrowserAgentActDownloadRoutes(app, ctx);

  app.post("/response/body", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const url = toStringOrEmpty(body.url);
    const timeoutMs = toNumber(body.timeoutMs);
    const maxChars = toNumber(body.maxChars);
    if (!url) {
      return jsonError(res, 400, "url is required");
    }

    await withRouteTabContext({
      req,
      res,
      ctx,
      targetId,
      run: async ({ profileCtx, cdpUrl, tab }) => {
        if (getBrowserProfileCapabilities(profileCtx.profile).usesChromeMcp) {
          return jsonError(
            res,
            501,
            "response body is not supported for existing-session profiles yet.",
          );
        }
        const pw = await requirePwAi(res, "response body");
        if (!pw) {
          return;
        }
        const result = await pw.responseBodyViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          url,
          timeoutMs: timeoutMs ?? undefined,
          maxChars: maxChars ?? undefined,
        });
        res.json({ ok: true, targetId: tab.targetId, response: result });
      },
    });
  });

  app.post("/highlight", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const ref = toStringOrEmpty(body.ref);
    if (!ref) {
      return jsonError(res, 400, "ref is required");
    }

    await withRouteTabContext({
      req,
      res,
      ctx,
      targetId,
      run: async ({ profileCtx, cdpUrl, tab }) => {
        if (getBrowserProfileCapabilities(profileCtx.profile).usesChromeMcp) {
          await evaluateChromeMcpScript({
            profileName: profileCtx.profile.name,
            userDataDir: profileCtx.profile.userDataDir,
            targetId: tab.targetId,
            args: [ref],
            fn: `(el) => {
              if (!(el instanceof Element)) {
                return false;
              }
              el.scrollIntoView({ block: "center", inline: "center" });
              const previousOutline = el.style.outline;
              const previousOffset = el.style.outlineOffset;
              el.style.outline = "3px solid #FF4500";
              el.style.outlineOffset = "2px";
              setTimeout(() => {
                el.style.outline = previousOutline;
                el.style.outlineOffset = previousOffset;
              }, 2000);
              return true;
            }`,
          });
          return res.json({ ok: true, targetId: tab.targetId });
        }
        const pw = await requirePwAi(res, "highlight");
        if (!pw) {
          return;
        }
        await pw.highlightViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          ref,
        });
        res.json({ ok: true, targetId: tab.targetId });
      },
    });
  });
}
