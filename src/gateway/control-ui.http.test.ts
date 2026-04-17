import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { verifyDeviceSignature } from "../infra/device-identity.js";
import { DEFAULT_THEME_ACCENTS, DEFAULT_THEME_FAMILY } from "../shared/alisio-appearance.js";
import {
  ALISIO_BOOTSTRAP_HTTP_PATH,
  type AlisioHttpBootstrap,
  CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
  CONTROL_UI_DEVICE_IDENTITY_PATH,
  CONTROL_UI_DEVICE_SIGN_PATH,
  type ControlUiLocalDeviceIdentity,
  type ControlUiLocalDeviceSignResponse,
} from "./control-ui-contract.js";
import {
  handleAlisioBootstrapHttpRequest,
  handleControlUiAvatarRequest,
  handleControlUiHttpRequest,
  handleControlUiLocalDeviceRequest,
} from "./control-ui.js";
import { makeMockHttpResponse } from "./test-http-response.js";

describe("handleControlUiHttpRequest", () => {
  async function writeReadyAlisioState(root: string) {
    const statePath = path.join(root, "alisio", "state.json");
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(
      statePath,
      JSON.stringify(
        {
          version: 1,
          account: {
            profile: {
              userId: "user-1",
              username: "nuno",
              displayName: "Nuno Lopes",
              email: "nuno@example.com",
              avatarLabel: "N",
              joinedAt: "2026-04-04T15:00:00.000Z",
              plan: "Free Plan",
              backend: "supabase",
            },
            preferences: {
              language: "pt-PT",
              themeFamily: DEFAULT_THEME_FAMILY,
              themeMode: "dark",
              themeAccents: DEFAULT_THEME_ACCENTS,
            },
            session: {
              state: "signed_in",
              profileCompleted: true,
              signedInAt: "2026-04-04T15:00:00.000Z",
              backend: "supabase",
            },
          },
          organization: {
            mode: "none",
          },
          ai: {},
          authorizations: {},
          oauthCredentials: {},
          pendingAuthorizations: {},
        },
        null,
        2,
      ),
    );
  }

  async function withControlUiRoot<T>(params: {
    indexHtml?: string;
    fn: (tmp: string) => Promise<T>;
  }) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-ui-"));
    try {
      await fs.writeFile(path.join(tmp, "index.html"), params.indexHtml ?? "<html></html>\n");
      return await params.fn(tmp);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  function parseBootstrapPayload(end: ReturnType<typeof makeMockHttpResponse>["end"]) {
    return JSON.parse(String(end.mock.calls[0]?.[0] ?? "")) as {
      basePath: string;
      assistantName: string;
      assistantAvatar: string;
      assistantAgentId: string;
    };
  }

  function parseAlisioBootstrapPayload(end: ReturnType<typeof makeMockHttpResponse>["end"]) {
    return JSON.parse(String(end.mock.calls[0]?.[0] ?? "")) as AlisioHttpBootstrap;
  }

  function parseControlUiLocalDevicePayload(end: ReturnType<typeof makeMockHttpResponse>["end"]) {
    return JSON.parse(String(end.mock.calls[0]?.[0] ?? "")) as ControlUiLocalDeviceIdentity;
  }

  function parseControlUiLocalDeviceSignPayload(
    end: ReturnType<typeof makeMockHttpResponse>["end"],
  ) {
    return JSON.parse(String(end.mock.calls[0]?.[0] ?? "")) as ControlUiLocalDeviceSignResponse;
  }

  function expectNotFoundResponse(params: {
    handled: boolean;
    res: ReturnType<typeof makeMockHttpResponse>["res"];
    end: ReturnType<typeof makeMockHttpResponse>["end"];
  }) {
    expect(params.handled).toBe(true);
    expect(params.res.statusCode).toBe(404);
    expect(params.end).toHaveBeenCalledWith("Not Found");
  }

  function runControlUiRequest(params: {
    url: string;
    method: "GET" | "HEAD" | "POST";
    rootPath: string;
    basePath?: string;
    rootKind?: "resolved" | "bundled";
  }) {
    const { res, end } = makeMockHttpResponse();
    const handled = handleControlUiHttpRequest(
      { url: params.url, method: params.method } as IncomingMessage,
      res,
      {
        ...(params.basePath ? { basePath: params.basePath } : {}),
        root: { kind: params.rootKind ?? "resolved", path: params.rootPath },
      },
    );
    return { res, end, handled };
  }

  function runAvatarRequest(params: {
    url: string;
    method: "GET" | "HEAD";
    resolveAvatar: Parameters<typeof handleControlUiAvatarRequest>[2]["resolveAvatar"];
    basePath?: string;
  }) {
    const { res, end } = makeMockHttpResponse();
    const handled = handleControlUiAvatarRequest(
      { url: params.url, method: params.method } as IncomingMessage,
      res,
      {
        ...(params.basePath ? { basePath: params.basePath } : {}),
        resolveAvatar: params.resolveAvatar,
      },
    );
    return { res, end, handled };
  }

  async function runLocalDeviceRequest(params: {
    url: string;
    method: "GET" | "HEAD" | "POST";
    basePath?: string;
    body?: string;
    remoteAddress?: string;
    host?: string;
  }) {
    const { res, end } = makeMockHttpResponse();
    const req = Object.assign(Readable.from(params.body ? [params.body] : []), {
      url: params.url,
      method: params.method,
      headers: {
        host: params.host ?? "127.0.0.1:40705",
      },
      socket: {
        remoteAddress: params.remoteAddress ?? "127.0.0.1",
      },
    }) as IncomingMessage;
    const handled = await handleControlUiLocalDeviceRequest(req, res, {
      basePath: params.basePath,
    });
    return { res, end, handled };
  }

  async function withStateDir<T>(fn: (stateDir: string) => Promise<T>) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-state-"));
    const previous = process.env.ALISIO_STATE_DIR;
    process.env.ALISIO_STATE_DIR = tmp;
    try {
      return await fn(tmp);
    } finally {
      if (previous === undefined) {
        delete process.env.ALISIO_STATE_DIR;
      } else {
        process.env.ALISIO_STATE_DIR = previous;
      }
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  async function writeAssetFile(rootPath: string, filename: string, contents: string) {
    const assetsDir = path.join(rootPath, "assets");
    await fs.mkdir(assetsDir, { recursive: true });
    const filePath = path.join(assetsDir, filename);
    await fs.writeFile(filePath, contents);
    return { assetsDir, filePath };
  }

  async function createHardlinkedAssetFile(rootPath: string) {
    const { filePath } = await writeAssetFile(rootPath, "app.js", "console.log('hi');");
    const hardlinkPath = path.join(path.dirname(filePath), "app.hl.js");
    await fs.link(filePath, hardlinkPath);
    return hardlinkPath;
  }

  async function withBasePathRootFixture<T>(params: {
    siblingDir: string;
    fn: (paths: { root: string; sibling: string }) => Promise<T>;
  }) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-ui-root-"));
    try {
      const root = path.join(tmp, "ui");
      const sibling = path.join(tmp, params.siblingDir);
      await fs.mkdir(root, { recursive: true });
      await fs.mkdir(sibling, { recursive: true });
      await fs.writeFile(path.join(root, "index.html"), "<html>ok</html>\n");
      return await params.fn({ root, sibling });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  }

  it("sets security headers for Control UI responses", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, setHeader } = makeMockHttpResponse();
        const handled = handleControlUiHttpRequest(
          { url: "/", method: "GET" } as IncomingMessage,
          res,
          {
            root: { kind: "resolved", path: tmp },
          },
        );
        expect(handled).toBe(true);
        expect(setHeader).toHaveBeenCalledWith("X-Frame-Options", "DENY");
        expect(setHeader).toHaveBeenCalledWith(
          "Permissions-Policy",
          "camera=(), microphone=(self), geolocation=()",
        );
        const csp = setHeader.mock.calls.find((call) => call[0] === "Content-Security-Policy")?.[1];
        expect(typeof csp).toBe("string");
        expect(String(csp)).toContain("frame-ancestors 'none'");
        expect(String(csp)).toContain("script-src 'self'");
        expect(String(csp)).not.toContain("script-src 'self' 'unsafe-inline'");
      },
    });
  });

  it("includes CSP hash for inline scripts in index.html", async () => {
    const scriptContent = "(function(){ var x = 1; })();";
    const html = `<html><head><script>${scriptContent}</script></head><body></body></html>\n`;
    const expectedHash = createHash("sha256").update(scriptContent, "utf8").digest("base64");
    await withControlUiRoot({
      indexHtml: html,
      fn: async (tmp) => {
        const { res, setHeader } = makeMockHttpResponse();
        handleControlUiHttpRequest({ url: "/", method: "GET" } as IncomingMessage, res, {
          root: { kind: "resolved", path: tmp },
        });
        const cspCalls = setHeader.mock.calls.filter(
          (call) => call[0] === "Content-Security-Policy",
        );
        const lastCsp = String(cspCalls[cspCalls.length - 1]?.[1] ?? "");
        expect(lastCsp).toContain(`'sha256-${expectedHash}'`);
        expect(lastCsp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
      },
    });
  });

  it("does not inject inline scripts into index.html", async () => {
    const html = "<html><head></head><body>Hello</body></html>\n";
    await withControlUiRoot({
      indexHtml: html,
      fn: async (tmp) => {
        const { res, end } = makeMockHttpResponse();
        const handled = handleControlUiHttpRequest(
          { url: "/", method: "GET" } as IncomingMessage,
          res,
          {
            root: { kind: "resolved", path: tmp },
            config: {
              agents: { defaults: { workspace: tmp } },
              ui: { assistant: { name: "</script><script>alert(1)//", avatar: "evil.png" } },
            },
          },
        );
        expect(handled).toBe(true);
        expect(end).toHaveBeenCalledWith(html);
      },
    });
  });

  it("serves bootstrap config JSON", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res, end } = makeMockHttpResponse();
        const handled = handleControlUiHttpRequest(
          { url: CONTROL_UI_BOOTSTRAP_CONFIG_PATH, method: "GET" } as IncomingMessage,
          res,
          {
            root: { kind: "resolved", path: tmp },
            config: {
              agents: { defaults: { workspace: tmp } },
              ui: { assistant: { name: "</script><script>alert(1)//", avatar: "</script>.png" } },
            },
          },
        );
        expect(handled).toBe(true);
        const parsed = parseBootstrapPayload(end);
        expect(parsed.basePath).toBe("");
        expect(parsed.assistantName).toBe("</script><script>alert(1)//");
        expect(parsed.assistantAvatar).toBe("A");
        expect(parsed.assistantAgentId).toBe("main");
      },
    });
  });

  it("serves the local computer identity on loopback", async () => {
    await withStateDir(async () => {
      const { res, end, handled } = await runLocalDeviceRequest({
        url: CONTROL_UI_DEVICE_IDENTITY_PATH,
        method: "GET",
      });
      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      const parsed = parseControlUiLocalDevicePayload(end);
      expect(parsed.deviceId).toMatch(/^[a-f0-9]{64}$/);
      expect(parsed.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(parsed.platform).toMatch(/^macos |^windows |^linux /i);
      expect(typeof parsed.deviceFamily).toBe("string");
    });
  });

  it("signs payloads with the shared local computer identity", async () => {
    await withStateDir(async () => {
      const identityResponse = await runLocalDeviceRequest({
        url: CONTROL_UI_DEVICE_IDENTITY_PATH,
        method: "GET",
      });
      const identity = parseControlUiLocalDevicePayload(identityResponse.end);
      const payload = "device-auth-payload";
      const signResponse = await runLocalDeviceRequest({
        url: CONTROL_UI_DEVICE_SIGN_PATH,
        method: "POST",
        body: JSON.stringify({ payload }),
      });
      expect(signResponse.handled).toBe(true);
      expect(signResponse.res.statusCode).toBe(200);
      const signed = parseControlUiLocalDeviceSignPayload(signResponse.end);
      expect(verifyDeviceSignature(identity.publicKey, payload, signed.signature)).toBe(true);
    });
  });

  it("serves bootstrap config JSON under basePath", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await fs.writeFile(path.join(tmp, "ops.png"), "avatar");
        const { res, end } = makeMockHttpResponse();
        const handled = handleControlUiHttpRequest(
          { url: `/alisio${CONTROL_UI_BOOTSTRAP_CONFIG_PATH}`, method: "GET" } as IncomingMessage,
          res,
          {
            basePath: "/alisio",
            root: { kind: "resolved", path: tmp },
            config: {
              agents: { defaults: { workspace: tmp } },
              ui: { assistant: { name: "Ops", avatar: "ops.png" } },
            },
          },
        );
        expect(handled).toBe(true);
        const parsed = parseBootstrapPayload(end);
        expect(parsed.basePath).toBe("/alisio");
        expect(parsed.assistantName).toBe("Ops");
        expect(parsed.assistantAvatar).toBe("/alisio/avatar/main");
        expect(parsed.assistantAgentId).toBe("main");
      },
    });
  });

  it("serves the local-account Alisio bootstrap on local loopback requests", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-alisio-bootstrap-"));
    const previousStateDir = process.env.ALISIO_STATE_DIR;
    const previousSupabaseUrl = process.env.ALISIO_SUPABASE_URL;
    const previousSupabaseAnonKey = process.env.ALISIO_SUPABASE_ANON_KEY;
    process.env.ALISIO_STATE_DIR = stateDir;
    delete process.env.ALISIO_SUPABASE_URL;
    delete process.env.ALISIO_SUPABASE_ANON_KEY;
    try {
      const { res, end } = makeMockHttpResponse();
      const handled = await handleAlisioBootstrapHttpRequest(
        {
          url: ALISIO_BOOTSTRAP_HTTP_PATH,
          method: "GET",
          headers: { host: "127.0.0.1:40705" },
          socket: { remoteAddress: "127.0.0.1" },
        } as IncomingMessage,
        res,
        {
          trustedProxies: [],
          allowRealIpFallback: false,
          loadRuntimeSetup: async () => ({
            providerReady: false,
            models: {
              total: 0,
              defaultProvider: "openai",
              providers: [],
            },
          }),
        },
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      const parsed = parseAlisioBootstrapPayload(end);
      expect(parsed.basePath).toBe("");
      expect(parsed.controlUrl).toBe("ws://127.0.0.1:40705/");
      expect(parsed.connectionRequired).toBe(false);
      expect(parsed.startupState).toBe("signed_out");
      expect(parsed.providerReady).toBe(false);
      expect(parsed.accountReady).toBe(false);
      expect(parsed.nextStep).toBe("account");
      expect(parsed.account).toBeNull();
      expect(parsed.accountCloud).toEqual({
        backend: "supabase",
        available: false,
        missingEnvVars: ["ALISIO_SUPABASE_URL", "ALISIO_SUPABASE_ANON_KEY"],
      });
      expect(parsed.ai).toMatchObject({ provider: "openai" });
      expect(typeof parsed.ai?.status).toBe("string");
      expect(typeof parsed.bootstrapToken).toBe("string");
      expect(parsed.bootstrapToken?.length).toBeGreaterThan(10);
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.ALISIO_STATE_DIR;
      } else {
        process.env.ALISIO_STATE_DIR = previousStateDir;
      }
      if (previousSupabaseUrl === undefined) {
        delete process.env.ALISIO_SUPABASE_URL;
      } else {
        process.env.ALISIO_SUPABASE_URL = previousSupabaseUrl;
      }
      if (previousSupabaseAnonKey === undefined) {
        delete process.env.ALISIO_SUPABASE_ANON_KEY;
      } else {
        process.env.ALISIO_SUPABASE_ANON_KEY = previousSupabaseAnonKey;
      }
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("does not promote legacy local-only bootstrap state when cloud account config is missing", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-alisio-bootstrap-"));
    const previousStateDir = process.env.ALISIO_STATE_DIR;
    process.env.ALISIO_STATE_DIR = stateDir;
    try {
      await writeReadyAlisioState(stateDir);
      const { res, end } = makeMockHttpResponse();
      const handled = await handleAlisioBootstrapHttpRequest(
        {
          url: ALISIO_BOOTSTRAP_HTTP_PATH,
          method: "GET",
          headers: { host: "127.0.0.1:40705" },
          socket: { remoteAddress: "127.0.0.1" },
        } as IncomingMessage,
        res,
        {
          trustedProxies: [],
          allowRealIpFallback: false,
          loadRuntimeSetup: async () => ({
            providerReady: false,
            models: {
              total: 1,
              defaultProvider: "alisio-local-current",
              providers: ["alisio-local-current"],
            },
          }),
        },
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      const parsed = parseAlisioBootstrapPayload(end);
      expect(parsed.startupState).toBe("signed_out");
      expect(parsed.providerReady).toBe(false);
      expect(parsed.accountReady).toBe(false);
      expect(parsed.nextStep).toBe("account");
    } finally {
      if (previousStateDir === undefined) {
        delete process.env.ALISIO_STATE_DIR;
      } else {
        process.env.ALISIO_STATE_DIR = previousStateDir;
      }
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("serves local avatar bytes through hardened avatar handler", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-avatar-http-"));
    try {
      const avatarPath = path.join(tmp, "main.png");
      await fs.writeFile(avatarPath, "avatar-bytes\n");

      const { res, end, handled } = runAvatarRequest({
        url: "/avatar/main",
        method: "GET",
        resolveAvatar: () => ({ kind: "local", filePath: avatarPath }),
      });

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("avatar-bytes\n");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("rejects avatar symlink paths from resolver", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-avatar-http-link-"));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-avatar-http-outside-"));
    try {
      const outsideFile = path.join(outside, "secret.txt");
      await fs.writeFile(outsideFile, "outside-secret\n");
      const linkPath = path.join(tmp, "avatar-link.png");
      await fs.symlink(outsideFile, linkPath);

      const { res, end, handled } = runAvatarRequest({
        url: "/avatar/main",
        method: "GET",
        resolveAvatar: () => ({ kind: "local", filePath: linkPath }),
      });

      expectNotFoundResponse({ handled, res, end });
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects symlinked assets that resolve outside control-ui root", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const assetsDir = path.join(tmp, "assets");
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-ui-outside-"));
        try {
          const outsideFile = path.join(outsideDir, "secret.txt");
          await fs.mkdir(assetsDir, { recursive: true });
          await fs.writeFile(outsideFile, "outside-secret\n");
          await fs.symlink(outsideFile, path.join(assetsDir, "leak.txt"));

          const { res, end } = makeMockHttpResponse();
          const handled = handleControlUiHttpRequest(
            { url: "/assets/leak.txt", method: "GET" } as IncomingMessage,
            res,
            {
              root: { kind: "resolved", path: tmp },
            },
          );
          expectNotFoundResponse({ handled, res, end });
        } finally {
          await fs.rm(outsideDir, { recursive: true, force: true });
        }
      },
    });
  });

  it("allows symlinked assets that resolve inside control-ui root", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { assetsDir, filePath } = await writeAssetFile(tmp, "actual.txt", "inside-ok\n");
        await fs.symlink(filePath, path.join(assetsDir, "linked.txt"));

        const { res, end, handled } = runControlUiRequest({
          url: "/assets/linked.txt",
          method: "GET",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("inside-ok\n");
      },
    });
  });

  it("serves HEAD for in-root assets without writing a body", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await writeAssetFile(tmp, "actual.txt", "inside-ok\n");

        const { res, end, handled } = runControlUiRequest({
          url: "/assets/actual.txt",
          method: "HEAD",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(end.mock.calls[0]?.length ?? -1).toBe(0);
      },
    });
  });

  it("rejects symlinked SPA fallback index.html outside control-ui root", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-ui-index-outside-"));
        try {
          const outsideIndex = path.join(outsideDir, "index.html");
          await fs.writeFile(outsideIndex, "<html>outside</html>\n");
          await fs.rm(path.join(tmp, "index.html"));
          await fs.symlink(outsideIndex, path.join(tmp, "index.html"));

          const { res, end, handled } = runControlUiRequest({
            url: "/app/route",
            method: "GET",
            rootPath: tmp,
          });
          expectNotFoundResponse({ handled, res, end });
        } finally {
          await fs.rm(outsideDir, { recursive: true, force: true });
        }
      },
    });
  });

  it("rejects hardlinked index.html for non-package control-ui roots", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-ui-index-hardlink-"));
        try {
          const outsideIndex = path.join(outsideDir, "index.html");
          await fs.writeFile(outsideIndex, "<html>outside-hardlink</html>\n");
          await fs.rm(path.join(tmp, "index.html"));
          await fs.link(outsideIndex, path.join(tmp, "index.html"));

          const { res, end, handled } = runControlUiRequest({
            url: "/",
            method: "GET",
            rootPath: tmp,
          });
          expectNotFoundResponse({ handled, res, end });
        } finally {
          await fs.rm(outsideDir, { recursive: true, force: true });
        }
      },
    });
  });

  it("rejects hardlinked asset files for custom/resolved roots (security boundary)", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await createHardlinkedAssetFile(tmp);

        const { res, end, handled } = runControlUiRequest({
          url: "/assets/app.hl.js",
          method: "GET",
          rootPath: tmp,
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(404);
        expect(end).toHaveBeenCalledWith("Not Found");
      },
    });
  });

  it("serves hardlinked asset files for bundled roots (pnpm global install)", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        await createHardlinkedAssetFile(tmp);

        const { res, end, handled } = runControlUiRequest({
          url: "/assets/app.hl.js",
          method: "GET",
          rootPath: tmp,
          rootKind: "bundled",
        });

        expect(handled).toBe(true);
        expect(res.statusCode).toBe(200);
        expect(String(end.mock.calls[0]?.[0] ?? "")).toBe("console.log('hi');");
      },
    });
  });

  it("does not handle POST to root-mounted paths (plugin webhook passthrough)", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        for (const webhookPath of ["/bluebubbles-webhook", "/custom-webhook", "/callback"]) {
          const { res } = makeMockHttpResponse();
          const handled = handleControlUiHttpRequest(
            { url: webhookPath, method: "POST" } as IncomingMessage,
            res,
            { root: { kind: "resolved", path: tmp } },
          );
          expect(handled, `POST to ${webhookPath} should pass through to plugin handlers`).toBe(
            false,
          );
        }
      },
    });
  });

  it("does not handle POST to paths outside basePath", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { res } = makeMockHttpResponse();
        const handled = handleControlUiHttpRequest(
          { url: "/bluebubbles-webhook", method: "POST" } as IncomingMessage,
          res,
          { basePath: "/alisio", root: { kind: "resolved", path: tmp } },
        );
        expect(handled).toBe(false);
      },
    });
  });

  it("does not handle /api paths when basePath is empty", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        for (const apiPath of ["/api", "/api/sessions", "/api/channels/nostr"]) {
          const { handled } = runControlUiRequest({
            url: apiPath,
            method: "GET",
            rootPath: tmp,
          });
          expect(handled, `expected ${apiPath} to not be handled`).toBe(false);
        }
      },
    });
  });

  it("does not handle /plugins paths when basePath is empty", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        for (const pluginPath of ["/plugins", "/plugins/diffs/view/abc/def"]) {
          const { handled } = runControlUiRequest({
            url: pluginPath,
            method: "GET",
            rootPath: tmp,
          });
          expect(handled, `expected ${pluginPath} to not be handled`).toBe(false);
        }
      },
    });
  });

  it("falls through POST requests when basePath is empty", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        const { handled, end } = runControlUiRequest({
          url: "/webhook/bluebubbles",
          method: "POST",
          rootPath: tmp,
        });
        expect(handled).toBe(false);
        expect(end).not.toHaveBeenCalled();
      },
    });
  });

  it("falls through POST requests under configured basePath (plugin webhook passthrough)", async () => {
    await withControlUiRoot({
      fn: async (tmp) => {
        for (const route of ["/alisio", "/alisio/", "/alisio/some-page"]) {
          const { handled, end } = runControlUiRequest({
            url: route,
            method: "POST",
            rootPath: tmp,
            basePath: "/alisio",
          });
          expect(handled, `POST to ${route} should pass through to plugin handlers`).toBe(false);
          expect(end, `POST to ${route} should not write a response`).not.toHaveBeenCalled();
        }
      },
    });
  });

  it("rejects absolute-path escape attempts under basePath routes", async () => {
    await withBasePathRootFixture({
      siblingDir: "ui-secrets",
      fn: async ({ root, sibling }) => {
        const secretPath = path.join(sibling, "secret.txt");
        await fs.writeFile(secretPath, "sensitive-data");

        const secretPathUrl = secretPath.split(path.sep).join("/");
        const absolutePathUrl = secretPathUrl.startsWith("/") ? secretPathUrl : `/${secretPathUrl}`;
        const { res, end, handled } = runControlUiRequest({
          url: `/alisio/${absolutePathUrl}`,
          method: "GET",
          rootPath: root,
          basePath: "/alisio",
        });
        expectNotFoundResponse({ handled, res, end });
      },
    });
  });

  it("rejects symlink escape attempts under basePath routes", async () => {
    await withBasePathRootFixture({
      siblingDir: "outside",
      fn: async ({ root, sibling }) => {
        await fs.mkdir(path.join(root, "assets"), { recursive: true });
        const secretPath = path.join(sibling, "secret.txt");
        await fs.writeFile(secretPath, "sensitive-data");

        const linkPath = path.join(root, "assets", "leak.txt");
        try {
          await fs.symlink(secretPath, linkPath, "file");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EPERM") {
            return;
          }
          throw error;
        }

        const { res, end, handled } = runControlUiRequest({
          url: "/alisio/assets/leak.txt",
          method: "GET",
          rootPath: root,
          basePath: "/alisio",
        });
        expectNotFoundResponse({ handled, res, end });
      },
    });
  });
});
