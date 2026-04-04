/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { ConfigState } from "../controllers/config.ts";
import type { ExecApprovalsState } from "../controllers/exec-approvals.ts";
import {
  FULL_ACCESS_CONFIG_DEFAULTS,
  RECOMMENDED_CONFIG_DEFAULTS,
  applyGatewayAccessMode,
  resolveConfiguredExecDefaults,
  resolveSecurityAccessMode,
} from "../controllers/security-access.ts";
import type { GatewayAccessModeState } from "../controllers/security-access.ts";
import { renderSecurity, supportsRuntimeAccessModeTarget } from "./security.ts";

describe("resolveConfiguredExecDefaults", () => {
  it("falls back to the gateway exec baseline when config is missing", () => {
    expect(resolveConfiguredExecDefaults(null)).toEqual(RECOMMENDED_CONFIG_DEFAULTS);
  });

  it("reads explicit exec defaults from config form", () => {
    expect(
      resolveConfiguredExecDefaults({
        tools: {
          exec: {
            security: "full",
            ask: "off",
          },
        },
      }),
    ).toEqual(FULL_ACCESS_CONFIG_DEFAULTS);
  });
});

describe("resolveSecurityAccessMode", () => {
  it("treats the empty state as recommended", () => {
    expect(resolveSecurityAccessMode({ configForm: null, execApprovalsForm: null })).toBe(
      "recommended",
    );
  });

  it("detects full access only when config and approval defaults both allow it", () => {
    expect(
      resolveSecurityAccessMode({
        configForm: {
          tools: {
            exec: {
              security: "full",
              ask: "off",
            },
          },
        },
        execApprovalsForm: {
          version: 1,
          defaults: {
            security: "full",
            ask: "off",
            askFallback: "full",
          },
          agents: {},
        },
      }),
    ).toBe("full-access");
  });

  it("marks mixed settings as custom", () => {
    expect(
      resolveSecurityAccessMode({
        configForm: {
          tools: {
            exec: {
              security: "full",
              ask: "off",
            },
          },
        },
        execApprovalsForm: {
          version: 1,
          defaults: {
            security: "allowlist",
            ask: "on-miss",
            askFallback: "deny",
          },
          agents: {},
        },
      }),
    ).toBe("custom");
  });

  it("marks scoped overrides as custom until a preset cleans them up", () => {
    expect(
      resolveSecurityAccessMode({
        configForm: {
          tools: {
            exec: {
              security: "allowlist",
              ask: "on-miss",
            },
          },
          agents: {
            list: [
              {
                id: "main",
                tools: {
                  exec: {
                    ask: "on-miss",
                  },
                },
              },
            ],
          },
        },
        execApprovalsForm: {
          version: 1,
          defaults: {
            security: "allowlist",
            ask: "on-miss",
            askFallback: "deny",
            autoAllowSkills: false,
          },
          agents: {},
        },
      }),
    ).toBe("custom");

    expect(
      resolveSecurityAccessMode({
        configForm: {
          tools: {
            exec: {
              security: "allowlist",
              ask: "on-miss",
            },
          },
        },
        execApprovalsForm: {
          version: 1,
          defaults: {
            security: "allowlist",
            ask: "on-miss",
            askFallback: "deny",
            autoAllowSkills: false,
          },
          agents: {
            main: {
              ask: "on-miss",
            },
          },
        },
      }),
    ).toBe("custom");
  });
});

describe("supportsRuntimeAccessModeTarget", () => {
  it("allows runtime access modes only on the gateway target", () => {
    expect(supportsRuntimeAccessModeTarget("gateway")).toBe(true);
    expect(supportsRuntimeAccessModeTarget("node")).toBe(false);
  });
});

describe("renderSecurity", () => {
  function createProps() {
    return {
      loading: false,
      nodes: [],
      configSnapshot: {
        config: {
          tools: {
            exec: {
              security: "allowlist",
              ask: "on-miss",
            },
          },
        },
      },
      configForm: {
        tools: {
          exec: {
            security: "full",
            ask: "off",
          },
        },
      },
      configLoading: false,
      configSaving: false,
      execApprovalsLoading: false,
      execApprovalsSaving: false,
      execApprovalsDirty: true,
      execApprovalsSnapshot: {
        path: "/tmp/exec-approvals.json",
        exists: true,
        hash: "hash-1",
        file: {
          version: 1,
          defaults: {
            security: "allowlist",
            ask: "on-miss",
            askFallback: "deny",
          },
        },
      },
      execApprovalsForm: {
        version: 1,
        defaults: {
          security: "full",
          ask: "off",
          askFallback: "full",
        },
      },
      execApprovalsSelectedAgent: null,
      execApprovalsTarget: "gateway" as const,
      execApprovalsTargetNodeId: null,
      execApprovalQueue: [],
      execApprovalBusy: false,
      execApprovalError: null,
      gatewayAccessModeLoading: false,
      gatewayAccessModeBusy: false,
      gatewayAccessMode: "recommended" as const,
      onRefresh: () => undefined,
      onLoadExecApprovals: () => undefined,
      onExecApprovalsTargetChange: () => undefined,
      onExecApprovalsSelectAgent: () => undefined,
      onExecApprovalsPatch: () => undefined,
      onExecApprovalsRemove: () => undefined,
      onSaveExecApprovals: () => undefined,
      onResolveApproval: () => undefined,
      onApplyAccessMode: () => undefined,
    };
  }

  it("shows the applied gateway mode instead of dirty advanced editor drafts", () => {
    const container = document.createElement("div");
    render(renderSecurity(createProps()), container);

    expect(container.textContent).toContain("Recommended");
    expect(container.textContent).not.toContain("Custom");
  });

  it("disables the button for the already active access mode", () => {
    const container = document.createElement("div");
    render(renderSecurity(createProps()), container);

    const activeButton = container.querySelector<HTMLButtonElement>(
      'button[data-security-mode="recommended"]',
    );
    expect(activeButton).toBeDefined();
    expect(activeButton?.hasAttribute("disabled")).toBe(true);
  });

  it("shows the selected node prompt instead of the gateway prompt in hero stats", () => {
    const container = document.createElement("div");
    render(
      renderSecurity({
        ...createProps(),
        execApprovalsTarget: "node",
        execApprovalsTargetNodeId: "node-1",
        execApprovalsSnapshot: {
          path: "/tmp/node-exec-approvals.json",
          exists: true,
          hash: "hash-node",
          file: {
            version: 1,
            defaults: {
              security: "allowlist",
              ask: "always",
              askFallback: "deny",
            },
          },
        },
        execApprovalsForm: null,
      }),
      container,
    );

    const stats = container.querySelector(".alisio-security-summary");
    expect(stats?.textContent).toContain("Always");
    expect(stats?.textContent).not.toContain("On miss");
  });
});

describe("applyGatewayAccessMode", () => {
  function createControllerState(): GatewayAccessModeState & ConfigState & ExecApprovalsState {
    return {
      applySessionKey: "main",
      client: null,
      configActiveSection: null,
      configActiveSubsection: null,
      configApplying: false,
      configForm: null,
      configFormDirty: false,
      configFormMode: "form",
      configFormOriginal: null,
      configIssues: [],
      configLoading: false,
      configRaw: "",
      configRawOriginal: "",
      configSaving: false,
      configSchema: null,
      configSchemaLoading: false,
      configSchemaVersion: null,
      configSearchQuery: "",
      configSnapshot: null,
      configUiHints: {},
      configValid: null,
      connected: true,
      execApprovalsDirty: false,
      execApprovalsForm: null,
      execApprovalsLoading: false,
      execApprovalsSaving: false,
      execApprovalsSelectedAgent: null,
      execApprovalsSnapshot: null,
      execApprovalsTarget: "gateway",
      gatewayAccessMode: null,
      gatewayAccessModeBusy: false,
      gatewayAccessModeLoading: false,
      lastError: null,
      updateRunning: false,
    };
  }

  it("skips config and approval writes when the selected mode is already applied", async () => {
    const request = vi.fn().mockImplementation(async (method: string) => {
      if (method === "config.get") {
        return {
          hash: "hash-config",
          config: {
            tools: {
              exec: {
                security: "allowlist",
                ask: "on-miss",
              },
            },
          },
        };
      }
      if (method === "exec.approvals.get") {
        return {
          hash: "hash-approvals",
          file: {
            version: 1,
            defaults: {
              security: "allowlist",
              ask: "on-miss",
              askFallback: "deny",
              autoAllowSkills: false,
            },
          },
        };
      }
      throw new Error(`unexpected request: ${method}`);
    });

    const state = createControllerState();
    state.client = { request } as unknown as ConfigState["client"];

    await applyGatewayAccessMode(state, "recommended");

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith("config.get", {});
    expect(request).toHaveBeenCalledWith("exec.approvals.get", {});
    expect(request).not.toHaveBeenCalledWith("config.patch", expect.anything());
    expect(request).not.toHaveBeenCalledWith("exec.approvals.set", expect.anything());
    expect(state.gatewayAccessMode).toBe("recommended");
    expect(state.lastError).toBeNull();
  });

  it("cleans scoped config and exec approval overrides when applying a preset", async () => {
    const initialConfig = {
      tools: {
        exec: {
          security: "allowlist",
          ask: "on-miss",
        },
      },
      agents: {
        list: [
          {
            id: "main",
            tools: {
              exec: {
                ask: "always",
              },
            },
          },
        ],
      },
    };
    const cleanedConfig = {
      tools: {
        exec: {
          security: "allowlist",
          ask: "on-miss",
        },
      },
      agents: {
        list: [{ id: "main" }],
      },
    };
    const initialApprovals = {
      version: 1,
      defaults: {
        security: "allowlist",
        ask: "on-miss",
        askFallback: "deny",
        autoAllowSkills: false,
      },
      agents: {
        main: {
          ask: "always",
          allowlist: [{ pattern: "/usr/bin/uname" }],
        },
      },
    };
    const cleanedApprovals = {
      version: 1,
      defaults: {
        security: "allowlist",
        ask: "on-miss",
        askFallback: "deny",
        autoAllowSkills: false,
      },
      agents: {
        main: {
          allowlist: [{ pattern: "/usr/bin/uname" }],
        },
      },
    };

    let configGetCount = 0;
    let approvalsGetCount = 0;
    const request = vi
      .fn()
      .mockImplementation(async (method: string, params?: Record<string, unknown>) => {
        if (method === "config.get") {
          configGetCount += 1;
          return {
            hash: `hash-config-${configGetCount}`,
            config: configGetCount === 1 ? initialConfig : cleanedConfig,
          };
        }
        if (method === "exec.approvals.get") {
          approvalsGetCount += 1;
          return {
            hash: `hash-approvals-${approvalsGetCount}`,
            file: approvalsGetCount <= 2 ? initialApprovals : cleanedApprovals,
          };
        }
        if (method === "config.patch") {
          expect(JSON.parse(String(params?.raw))).toEqual({
            tools: {
              exec: {
                security: "allowlist",
                ask: "on-miss",
              },
            },
            agents: {
              list: [
                {
                  id: "main",
                  tools: null,
                },
              ],
            },
          });
          return {};
        }
        if (method === "exec.approvals.set") {
          expect(params).toEqual({
            file: cleanedApprovals,
            baseHash: "hash-approvals-2",
          });
          return {};
        }
        throw new Error(`unexpected request: ${method}`);
      });

    const state = createControllerState();
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormDirty = true;
    state.configForm = structuredClone(initialConfig);

    await applyGatewayAccessMode(state, "recommended");

    expect(request).toHaveBeenCalledWith("config.patch", expect.anything());
    expect(request).toHaveBeenCalledWith("exec.approvals.set", expect.anything());
    expect(state.configForm).toEqual(cleanedConfig);
    expect(state.gatewayAccessMode).toBe("recommended");
    expect(state.lastError).toBeNull();
  });
});
