import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AlisioConfig } from "../config/config.js";

const getLiveSandboxBrowserBridgeUrlMock = vi.hoisted(() => vi.fn());
const resolveSandboxRuntimeStatusMock = vi.hoisted(() => vi.fn());

vi.mock("./sandbox/browser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sandbox/browser.js")>();
  return {
    ...actual,
    getLiveSandboxBrowserBridgeUrl: getLiveSandboxBrowserBridgeUrlMock,
  };
});

vi.mock("./sandbox/runtime-status.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sandbox/runtime-status.js")>();
  return {
    ...actual,
    resolveSandboxRuntimeStatus: resolveSandboxRuntimeStatusMock,
  };
});

import { __testing } from "./pi-tools.js";

describe("pi-tools browser runtime context", () => {
  beforeEach(() => {
    getLiveSandboxBrowserBridgeUrlMock.mockReset();
    resolveSandboxRuntimeStatusMock.mockReset();
  });

  it("prefers a live sandbox bridge even when runtime status still says host", () => {
    getLiveSandboxBrowserBridgeUrlMock.mockReturnValue("http://127.0.0.1:19999");
    resolveSandboxRuntimeStatusMock.mockReturnValue({
      agentId: "main",
      sessionKey: "agent:main:dashboard:test",
      mainSessionKey: "agent:main:main",
      mode: "all",
      sandboxed: false,
      toolPolicy: {
        allow: [],
        deny: [],
        sources: {
          allow: { key: "agents.defaults.sandbox.tools.allow" },
          deny: { key: "agents.defaults.sandbox.tools.deny" },
        },
      },
    });

    const result = __testing.resolveBrowserToolRuntimeContext({
      cfg: {
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              scope: "agent",
              browser: {
                enabled: true,
              },
            },
          },
        },
        tools: {
          sandbox: {
            tools: {
              allow: ["browser"],
            },
          },
        },
      } as AlisioConfig,
      sessionKey: "agent:main:dashboard:test",
    });

    expect(result).toEqual({
      sandboxBridgeUrl: "http://127.0.0.1:19999",
      allowHostControl: false,
      preferSandbox: true,
    });
  });

  it("keeps sandbox-first semantics for mode=all even before the bridge is live", () => {
    getLiveSandboxBrowserBridgeUrlMock.mockReturnValue(undefined);
    resolveSandboxRuntimeStatusMock.mockReturnValue({
      agentId: "main",
      sessionKey: "main",
      mainSessionKey: "main",
      mode: "all",
      sandboxed: false,
      toolPolicy: {
        allow: [],
        deny: [],
        sources: {
          allow: { key: "agents.defaults.sandbox.tools.allow" },
          deny: { key: "agents.defaults.sandbox.tools.deny" },
        },
      },
    });

    const result = __testing.resolveBrowserToolRuntimeContext({
      cfg: {
        agents: {
          defaults: {
            sandbox: {
              mode: "all",
              scope: "agent",
              browser: {
                enabled: true,
              },
            },
          },
        },
        tools: {
          sandbox: {
            tools: {
              allow: ["browser"],
            },
          },
        },
      } as AlisioConfig,
      sessionKey: "main",
    });

    expect(result).toEqual({
      sandboxBridgeUrl: undefined,
      allowHostControl: false,
      preferSandbox: true,
    });
  });
});
