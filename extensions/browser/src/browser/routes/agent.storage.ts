import { createBrowserAuthBroker } from "../browser-auth-broker.js";
import { BrowserSessionLeaseConflictError } from "../browser-session-lease.js";
import type { BrowserSessionSupervisor } from "../browser-session.types.js";
import type { BrowserRouteContext } from "../server-context.js";
import {
  readBody,
  resolveLeaseOwnerFromBody,
  resolveSessionKeyFromBody,
  resolveTabOrigin,
  resolveTargetIdFromBody,
  resolveTargetIdFromQuery,
  withPlaywrightRouteContext,
} from "./agent.shared.js";
import type { BrowserRequest, BrowserResponse, BrowserRouteRegistrar } from "./types.js";
import { jsonError, toBoolean, toNumber, toStringOrEmpty } from "./utils.js";

type StorageKind = "local" | "session";

function getBrowserSessionSupervisor(ctx: BrowserRouteContext): BrowserSessionSupervisor {
  const supervisor = ctx.state().supervisor;
  if (!supervisor) {
    throw new Error("Browser session supervisor unavailable");
  }
  return supervisor;
}

export function parseStorageKind(raw: string): StorageKind | null {
  if (raw === "local" || raw === "session") {
    return raw;
  }
  return null;
}

export function parseStorageMutationRequest(
  kindParam: unknown,
  body: Record<string, unknown>,
): { kind: StorageKind | null; targetId: string | undefined } {
  return {
    kind: parseStorageKind(toStringOrEmpty(kindParam)),
    targetId: resolveTargetIdFromBody(body),
  };
}

export function parseRequiredStorageMutationRequest(
  kindParam: unknown,
  body: Record<string, unknown>,
): { kind: StorageKind; targetId: string | undefined } | null {
  const parsed = parseStorageMutationRequest(kindParam, body);
  if (!parsed.kind) {
    return null;
  }
  return {
    kind: parsed.kind,
    targetId: parsed.targetId,
  };
}

function parseStorageMutationOrRespond(
  res: BrowserResponse,
  kindParam: unknown,
  body: Record<string, unknown>,
) {
  const parsed = parseRequiredStorageMutationRequest(kindParam, body);
  if (!parsed) {
    jsonError(res, 400, "kind must be local|session");
    return null;
  }
  return parsed;
}

function parseStorageMutationFromRequest(req: BrowserRequest, res: BrowserResponse) {
  const body = readBody(req);
  const parsed = parseStorageMutationOrRespond(res, req.params.kind, body);
  if (!parsed) {
    return null;
  }
  return { body, parsed };
}

function ensureStorageLeaseOrRespond(params: {
  ctx: BrowserRouteContext;
  body: Record<string, unknown>;
  res: BrowserResponse;
}): {
  sessionKey?: string;
  leaseOwner?: string;
} | null {
  const sessionKey = resolveSessionKeyFromBody(params.body);
  const leaseOwner = resolveLeaseOwnerFromBody(params.body);
  if (!sessionKey || !leaseOwner) {
    return { sessionKey, leaseOwner };
  }
  try {
    getBrowserSessionSupervisor(params.ctx).ensureSessionLease({
      sessionKey,
      owner: leaseOwner,
    });
  } catch (err) {
    if (err instanceof BrowserSessionLeaseConflictError) {
      jsonError(params.res, 409, err.message);
      return null;
    }
    throw err;
  }
  return { sessionKey, leaseOwner };
}

export function registerBrowserAgentStorageRoutes(
  app: BrowserRouteRegistrar,
  ctx: BrowserRouteContext,
) {
  app.get("/cookies", async (req, res) => {
    const targetId = resolveTargetIdFromQuery(req.query);
    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId,
      feature: "cookies",
      run: async ({ cdpUrl, tab, pw }) => {
        const result = await pw.cookiesGetViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
        });
        res.json({ ok: true, targetId: tab.targetId, ...result });
      },
    });
  });

  app.post("/cookies/set", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const lease = ensureStorageLeaseOrRespond({ ctx, body, res });
    if (!lease) {
      return;
    }
    const cookie =
      body.cookie && typeof body.cookie === "object" && !Array.isArray(body.cookie)
        ? (body.cookie as Record<string, unknown>)
        : null;
    if (!cookie) {
      return jsonError(res, 400, "cookie is required");
    }

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId,
      feature: "cookies set",
      run: async ({ cdpUrl, tab, pw }) => {
        const supervisor = getBrowserSessionSupervisor(ctx);
        await pw.cookiesSetViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          cookie: {
            name: toStringOrEmpty(cookie.name),
            value: toStringOrEmpty(cookie.value),
            url: toStringOrEmpty(cookie.url) || undefined,
            domain: toStringOrEmpty(cookie.domain) || undefined,
            path: toStringOrEmpty(cookie.path) || undefined,
            expires: toNumber(cookie.expires) ?? undefined,
            httpOnly: toBoolean(cookie.httpOnly) ?? undefined,
            secure: toBoolean(cookie.secure) ?? undefined,
            sameSite:
              cookie.sameSite === "Lax" ||
              cookie.sameSite === "None" ||
              cookie.sameSite === "Strict"
                ? cookie.sameSite
                : undefined,
          },
        });
        const auth = createBrowserAuthBroker({
          authCache: ctx.state().authCache,
        }).markCookieAuth({
          sessionKey: lease.sessionKey,
          origin: resolveTabOrigin(toStringOrEmpty(cookie.url)) ?? resolveTabOrigin(tab.url),
        });
        if (lease.sessionKey && auth) {
          supervisor.recordSessionAuth({
            sessionKey: lease.sessionKey,
            origin: auth.origin,
            status: auth.status,
            method: auth.method,
            targetId: tab.targetId,
            fields: auth.fields,
          });
        }
        res.json({ ok: true, targetId: tab.targetId, ...(auth ? { auth } : {}) });
      },
    });
  });

  app.post("/cookies/clear", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const lease = ensureStorageLeaseOrRespond({ ctx, body, res });
    if (!lease) {
      return;
    }

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId,
      feature: "cookies clear",
      run: async ({ cdpUrl, tab, pw }) => {
        const supervisor = getBrowserSessionSupervisor(ctx);
        await pw.cookiesClearViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
        });
        if (lease.sessionKey) {
          ctx.state().authCache.clearSession(lease.sessionKey);
          supervisor.recordSessionAuth({
            sessionKey: lease.sessionKey,
            origin: resolveTabOrigin(tab.url),
            status: "none",
            method: "cookies",
            targetId: tab.targetId,
            fields: 0,
          });
        }
        res.json({ ok: true, targetId: tab.targetId });
      },
    });
  });

  app.get("/storage/:kind", async (req, res) => {
    const kind = parseStorageKind(toStringOrEmpty(req.params.kind));
    if (!kind) {
      return jsonError(res, 400, "kind must be local|session");
    }
    const targetId = resolveTargetIdFromQuery(req.query);
    const key = toStringOrEmpty(req.query.key);

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId,
      feature: "storage get",
      run: async ({ cdpUrl, tab, pw }) => {
        const result = await pw.storageGetViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          kind,
          key: key.trim() || undefined,
        });
        res.json({ ok: true, targetId: tab.targetId, ...result });
      },
    });
  });

  app.post("/storage/:kind/set", async (req, res) => {
    const mutation = parseStorageMutationFromRequest(req, res);
    if (!mutation) {
      return;
    }
    const lease = ensureStorageLeaseOrRespond({
      ctx,
      body: mutation.body,
      res,
    });
    if (!lease) {
      return;
    }
    const key = toStringOrEmpty(mutation.body.key);
    if (!key) {
      return jsonError(res, 400, "key is required");
    }
    const value = typeof mutation.body.value === "string" ? mutation.body.value : "";

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId: mutation.parsed.targetId,
      feature: "storage set",
      run: async ({ cdpUrl, tab, pw }) => {
        const supervisor = getBrowserSessionSupervisor(ctx);
        await pw.storageSetViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          kind: mutation.parsed.kind,
          key,
          value,
        });
        const auth = createBrowserAuthBroker({
          authCache: ctx.state().authCache,
        }).markStorageAuth({
          sessionKey: lease.sessionKey,
          origin: resolveTabOrigin(tab.url),
          key,
          values: { [key]: value },
        });
        if (lease.sessionKey && auth) {
          supervisor.recordSessionAuth({
            sessionKey: lease.sessionKey,
            origin: auth.origin,
            status: auth.status,
            method: auth.method,
            targetId: tab.targetId,
            fields: auth.fields,
          });
        }
        res.json({ ok: true, targetId: tab.targetId, ...(auth ? { auth } : {}) });
      },
    });
  });

  app.post("/storage/:kind/clear", async (req, res) => {
    const mutation = parseStorageMutationFromRequest(req, res);
    if (!mutation) {
      return;
    }
    const lease = ensureStorageLeaseOrRespond({
      ctx,
      body: mutation.body,
      res,
    });
    if (!lease) {
      return;
    }

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId: mutation.parsed.targetId,
      feature: "storage clear",
      run: async ({ cdpUrl, tab, pw }) => {
        const supervisor = getBrowserSessionSupervisor(ctx);
        await pw.storageClearViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          kind: mutation.parsed.kind,
        });
        if (lease.sessionKey) {
          ctx.state().authCache.clearSession(lease.sessionKey);
          supervisor.recordSessionAuth({
            sessionKey: lease.sessionKey,
            origin: resolveTabOrigin(tab.url),
            status: "none",
            method: "storage",
            targetId: tab.targetId,
            fields: 0,
          });
        }
        res.json({ ok: true, targetId: tab.targetId });
      },
    });
  });

  app.post("/set/offline", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const offline = toBoolean(body.offline);
    if (offline === undefined) {
      return jsonError(res, 400, "offline is required");
    }

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId,
      feature: "offline",
      run: async ({ cdpUrl, tab, pw }) => {
        await pw.setOfflineViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          offline,
        });
        res.json({ ok: true, targetId: tab.targetId });
      },
    });
  });

  app.post("/set/headers", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const headers =
      body.headers && typeof body.headers === "object" && !Array.isArray(body.headers)
        ? (body.headers as Record<string, unknown>)
        : null;
    if (!headers) {
      return jsonError(res, 400, "headers is required");
    }

    const parsed: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v === "string") {
        parsed[k] = v;
      }
    }

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId,
      feature: "headers",
      run: async ({ cdpUrl, tab, pw }) => {
        await pw.setExtraHTTPHeadersViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          headers: parsed,
        });
        res.json({ ok: true, targetId: tab.targetId });
      },
    });
  });

  app.post("/set/credentials", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const lease = ensureStorageLeaseOrRespond({ ctx, body, res });
    if (!lease) {
      return;
    }

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId,
      feature: "http credentials",
      run: async ({ cdpUrl, tab, pw }) => {
        const supervisor = getBrowserSessionSupervisor(ctx);
        const authBroker = createBrowserAuthBroker({
          authCache: ctx.state().authCache,
        });
        const resolvedCredentials = await authBroker.resolveHttpCredentials({
          username: body.username,
          usernameRef: body.usernameRef,
          password: body.password,
          passwordRef: body.passwordRef,
          clear: toBoolean(body.clear) ?? false,
          sessionKey: lease.sessionKey,
          origin: resolveTabOrigin(tab.url),
        });
        await pw.setHttpCredentialsViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          username: resolvedCredentials.username,
          password: resolvedCredentials.password,
          clear: resolvedCredentials.clear,
        });
        if (lease.sessionKey && resolvedCredentials.clear) {
          ctx.state().authCache.clearSession(lease.sessionKey);
          supervisor.recordSessionAuth({
            sessionKey: lease.sessionKey,
            origin: resolveTabOrigin(tab.url),
            status: "none",
            method: "http-credentials",
            targetId: tab.targetId,
            fields: 0,
          });
        }
        if (lease.sessionKey && resolvedCredentials.auth) {
          supervisor.recordSessionAuth({
            sessionKey: lease.sessionKey,
            origin: resolvedCredentials.auth.origin,
            status: resolvedCredentials.auth.status,
            method: resolvedCredentials.auth.method,
            targetId: tab.targetId,
            fields: resolvedCredentials.auth.fields,
          });
        }
        res.json({
          ok: true,
          targetId: tab.targetId,
          ...(resolvedCredentials.auth ? { auth: resolvedCredentials.auth } : {}),
        });
      },
    });
  });

  app.post("/set/geolocation", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const clear = toBoolean(body.clear) ?? false;
    const latitude = toNumber(body.latitude);
    const longitude = toNumber(body.longitude);
    const accuracy = toNumber(body.accuracy) ?? undefined;
    const origin = toStringOrEmpty(body.origin) || undefined;

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId,
      feature: "geolocation",
      run: async ({ cdpUrl, tab, pw }) => {
        await pw.setGeolocationViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          latitude,
          longitude,
          accuracy,
          origin,
          clear,
        });
        res.json({ ok: true, targetId: tab.targetId });
      },
    });
  });

  app.post("/set/media", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const schemeRaw = toStringOrEmpty(body.colorScheme);
    const colorScheme =
      schemeRaw === "dark" || schemeRaw === "light" || schemeRaw === "no-preference"
        ? schemeRaw
        : schemeRaw === "none"
          ? null
          : undefined;
    if (colorScheme === undefined) {
      return jsonError(res, 400, "colorScheme must be dark|light|no-preference|none");
    }

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId,
      feature: "media emulation",
      run: async ({ cdpUrl, tab, pw }) => {
        await pw.emulateMediaViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          colorScheme,
        });
        res.json({ ok: true, targetId: tab.targetId });
      },
    });
  });

  app.post("/set/timezone", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const timezoneId = toStringOrEmpty(body.timezoneId);
    if (!timezoneId) {
      return jsonError(res, 400, "timezoneId is required");
    }

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId,
      feature: "timezone",
      run: async ({ cdpUrl, tab, pw }) => {
        await pw.setTimezoneViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          timezoneId,
        });
        res.json({ ok: true, targetId: tab.targetId });
      },
    });
  });

  app.post("/set/locale", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const locale = toStringOrEmpty(body.locale);
    if (!locale) {
      return jsonError(res, 400, "locale is required");
    }

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId,
      feature: "locale",
      run: async ({ cdpUrl, tab, pw }) => {
        await pw.setLocaleViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          locale,
        });
        res.json({ ok: true, targetId: tab.targetId });
      },
    });
  });

  app.post("/set/device", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const name = toStringOrEmpty(body.name);
    if (!name) {
      return jsonError(res, 400, "name is required");
    }

    await withPlaywrightRouteContext({
      req,
      res,
      ctx,
      targetId,
      feature: "device emulation",
      run: async ({ cdpUrl, tab, pw }) => {
        await pw.setDeviceViaPlaywright({
          cdpUrl,
          targetId: tab.targetId,
          name,
        });
        res.json({ ok: true, targetId: tab.targetId });
      },
    });
  });
}
