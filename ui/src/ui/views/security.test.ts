/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../app-view-state.ts";
import type { ConfigState } from "../controllers/config.ts";
import { loadApprovalAuditTrail, loadApprovalQueue } from "../controllers/exec-approval.ts";
import {
  changeExecApprovalsTarget,
  loadSelectedExecApprovals,
  type ExecApprovalsState,
  type ExecApprovalsTargetState,
} from "../controllers/exec-approvals.ts";
import {
  FULL_ACCESS_CONFIG_DEFAULTS,
  RECOMMENDED_CONFIG_DEFAULTS,
  applyGatewayAccessMode,
  resolveConfiguredExecDefaults,
  resolveSecurityAccessDiagnostics,
  resolveSecurityAccessMode,
} from "../controllers/security-access.ts";
import type { GatewayAccessModeState } from "../controllers/security-access.ts";
import { resolveAgentDisplayLabel } from "./agent-display.ts";
import { renderExecApprovalPrompt } from "./exec-approval.ts";
import { renderSecurity, supportsRuntimeAccessModeTarget } from "./security.ts";
import { parseSessionKey, resolveSessionDisplayName } from "./session-display.ts";

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

describe("resolveSecurityAccessDiagnostics", () => {
  it("counts config and approval overrides separately", () => {
    expect(
      resolveSecurityAccessDiagnostics({
        configForm: {
          tools: {
            exec: {
              security: "allowlist",
              ask: "on-miss",
            },
          },
          agents: {
            list: [
              { id: "main", tools: { exec: { ask: "always" } } },
              { id: "ops", tools: { exec: { security: "full" } } },
            ],
          },
        },
        execApprovalsForm: {
          version: 1,
          defaults: {
            security: "allowlist",
            ask: "on-miss",
            askFallback: "deny",
          },
          agents: {
            main: { ask: "always" },
          },
        },
      }),
    ).toMatchObject({
      mode: "custom",
      configOverrideAgentCount: 2,
      approvalOverrideAgentCount: 1,
    });
  });
});

describe("supportsRuntimeAccessModeTarget", () => {
  it("allows runtime access modes only on the gateway target", () => {
    expect(supportsRuntimeAccessModeTarget("gateway")).toBe(true);
    expect(supportsRuntimeAccessModeTarget("node")).toBe(false);
  });
});

describe("agent and session display labels", () => {
  it("shows the assistant name for the primary agent instead of the raw main id", () => {
    expect(
      resolveAgentDisplayLabel(
        { id: "main" },
        { assistantName: "Alisio", assistantAgentId: "main" },
      ),
    ).toBe("Alisio");
  });

  it("lets an explicit primary agent override the current session agent id", () => {
    expect(
      resolveAgentDisplayLabel(
        { id: "main" },
        {
          assistantName: "Alisio",
          assistantAgentId: "ops",
          primaryAgentId: "main",
        },
      ),
    ).toBe("Alisio");
  });

  it("labels the main and direct sessions without exposing the raw scoped key", () => {
    expect(
      resolveSessionDisplayName("agent:main:main", undefined, {
        assistantName: "Alisio",
        assistantAgentId: "main",
      }),
    ).toBe("Main Session");
    expect(
      resolveSessionDisplayName("agent:ops:main", undefined, {
        assistantName: "Alisio",
        assistantAgentId: "main",
      }),
    ).toBe("ops / Main Session");
    expect(parseSessionKey("agent:main:telegram:direct:user123")).toEqual({
      prefix: "",
      fallbackName: "Telegram · user123",
    });
  });
});

describe("loadApprovalAuditTrail", () => {
  it("loads persisted approval decisions from the gateway", async () => {
    const state = {
      client: {
        request: vi.fn(async () => ({
          items: [
            {
              kind: "exec",
              id: "exec-1",
              decision: "allow-once",
              ts: 1000,
              resolvedBy: "Operator",
              request: {
                command: "uname -a",
                host: "sandbox",
                security: "allowlist",
                ask: "on-miss",
              },
            },
            {
              kind: "plugin",
              id: "plugin-1",
              decision: "deny",
              ts: 2000,
              request: {
                title: "Sensitive action",
                description: "Changes production data",
                pluginId: "sage",
                toolName: "functions.exec_command",
              },
            },
          ],
        })),
      },
      connected: true,
      execApprovalAuditTrail: [],
      lastError: null,
    };

    await loadApprovalAuditTrail(state as never);

    expect(state.execApprovalAuditTrail).toHaveLength(2);
    expect(state.execApprovalAuditTrail[0]).toMatchObject({
      id: "plugin-1",
      kind: "plugin",
      pluginToolName: "functions.exec_command",
    });
    expect(state.execApprovalAuditTrail[1]).toMatchObject({
      id: "exec-1",
      kind: "exec",
      request: { commandPreview: null, envKeys: null },
    });
  });
});

describe("loadApprovalQueue", () => {
  it("loads pending approvals from the gateway snapshot", async () => {
    const state = {
      client: {
        request: vi.fn(async () => ({
          items: [
            {
              kind: "exec",
              id: "approval-1",
              createdAtMs: 1000,
              expiresAtMs: Date.now() + 60_000,
              request: {
                command: "bun test",
                host: "sandbox",
                security: "allowlist",
                ask: "on-miss",
              },
            },
            {
              kind: "plugin",
              id: "plugin-1",
              createdAtMs: 2000,
              expiresAtMs: Date.now() + 60_000,
              request: {
                title: "Publish release",
                description: "Pushes release metadata to the host",
                severity: "critical",
                pluginId: "publisher",
              },
            },
          ],
        })),
      },
      connected: true,
      execApprovalQueue: [],
      lastError: null,
    };

    await loadApprovalQueue(state as never);

    expect(state.execApprovalQueue).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "approval-1", kind: "exec" }),
        expect.objectContaining({ id: "plugin-1", kind: "plugin" }),
      ]),
    );
  });
});

describe("renderSecurity", () => {
  function createProps() {
    return {
      assistantName: "Alisio",
      assistantAgentId: "main",
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
      configDirty: false,
      configFormMode: "form" as const,
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
      execApprovalAuditTrail: [],
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

    expect(container.textContent).toContain("Safe");
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

  it("shows the assistant name instead of leaking the internal main agent id", () => {
    const container = document.createElement("div");
    render(renderSecurity(createProps()), container);

    const scopeButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".btn.btn--sm"),
      (button) => button.textContent?.trim() ?? "",
    );
    expect(scopeButtons).toContain("Alisio");
    expect(scopeButtons).not.toContain("main");
  });

  it("renders pending approvals without leaking raw main agent or session ids", () => {
    const container = document.createElement("div");
    render(
      renderSecurity({
        ...createProps(),
        execApprovalQueue: [
          {
            id: "approval-1",
            kind: "exec",
            createdAtMs: Date.now(),
            expiresAtMs: Date.now() + 30_000,
            request: {
              command: "uname -a",
              host: "gateway",
              agentId: "main",
              sessionKey: "agent:main:main",
              cwd: "/tmp",
              security: "full",
              ask: "off",
            },
          },
        ],
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Alisio");
    expect(text).toContain("Main Session");
    expect(text).not.toContain("agent:main:main");
  });

  it("shows the exact command preview and execution summary for exec approvals", () => {
    const container = document.createElement("div");
    render(
      renderSecurity({
        ...createProps(),
        execApprovalQueue: [
          {
            id: "approval-2",
            kind: "exec",
            createdAtMs: Date.now(),
            expiresAtMs: Date.now() + 30_000,
            request: {
              command: "node ./scripts/release.js --prod --now",
              commandPreview: "node ./scripts/release.js --prod",
              envKeys: ["OPENAI_API_KEY", "SENTRY_AUTH_TOKEN"],
              host: "sandbox",
              cwd: "/workspace",
              security: "allowlist",
              ask: "on-miss",
            },
          },
        ],
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("node ./scripts/release.js --prod");
    expect(text).toContain("Exact command: node ./scripts/release.js --prod --now");
    expect(text).toContain("Runs on");
    expect(text).toContain("the sandbox");
    expect(text).toContain("Env keys");
    expect(text).toContain("OPENAI_API_KEY, SENTRY_AUTH_TOKEN");
  });

  it("keeps the live approvals panel visible with an empty state", () => {
    const container = document.createElement("div");
    render(renderSecurity(createProps()), container);

    const text = container.textContent ?? "";
    expect(text).toContain("Live approvals");
    expect(text).toContain("No approvals waiting");
  });

  it("renders the recent approval audit trail", () => {
    const container = document.createElement("div");
    render(
      renderSecurity({
        ...createProps(),
        execApprovalAuditTrail: [
          {
            id: "approval-1",
            kind: "exec",
            title: "uname -a",
            summary: "uname -a",
            decision: "allow-once",
            resolvedBy: "Operator",
            ts: Date.now() - 60_000,
            request: {
              command: "uname -a",
              host: "gateway",
              security: "allowlist",
              ask: "on-miss",
            },
          },
        ],
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Recent decisions");
    expect(text).toContain("Operator");
    expect(text).toContain("Allow once");
  });

  it("shows visible override counts when the runtime is custom", () => {
    const container = document.createElement("div");
    render(
      renderSecurity({
        ...createProps(),
        gatewayAccessMode: "custom",
        configSnapshot: {
          config: {
            tools: {
              exec: {
                security: "allowlist",
                ask: "on-miss",
              },
            },
            agents: {
              list: [{ id: "main", tools: { exec: { ask: "always" } } }],
            },
          },
        },
        execApprovalsSnapshot: {
          path: "/tmp/exec-approvals.json",
          exists: true,
          hash: "hash-custom",
          file: {
            version: 1,
            defaults: {
              security: "allowlist",
              ask: "on-miss",
              askFallback: "deny",
            },
            agents: {
              main: {
                ask: "always",
              },
            },
          },
        },
      }),
      container,
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Overrides active");
    expect(text).toContain("1 agent override(s) change `tools.exec` defaults.");
    expect(text).toContain("1 agent override(s) change approval defaults.");
  });

  it("shows the selected node prompt instead of the gateway prompt in hero stats", () => {
    const container = document.createElement("div");
    render(
      renderSecurity({
        ...createProps(),
        nodes: [
          {
            nodeId: "node-1",
            displayName: "Runner",
            commands: ["system.execApprovals.get", "system.execApprovals.set"],
          },
        ],
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

    const stats = container.querySelector(".alisio-security-meta");
    expect(stats?.textContent).toContain("Always");
    expect(stats?.textContent).not.toContain("On miss");
    expect(stats?.textContent).toContain("Runner · node-1");
  });

  it("shows the effective gateway prompt when exec approvals are stricter than tools.exec", () => {
    const container = document.createElement("div");
    render(
      renderSecurity({
        ...createProps(),
        configSnapshot: {
          config: {
            tools: {
              exec: {
                security: "allowlist",
                ask: "off",
              },
            },
          },
        },
        execApprovalsSnapshot: {
          path: "/tmp/exec-approvals.json",
          exists: true,
          hash: "hash-2",
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

    const stats = container.querySelector(".alisio-security-meta");
    expect(stats?.textContent).toContain("Always");
    expect(stats?.textContent).not.toContain("Off");
  });

  it("keeps the prompt summary on the applied snapshot while exec approvals drafts are dirty", () => {
    const container = document.createElement("div");
    render(
      renderSecurity({
        ...createProps(),
        configSnapshot: {
          config: {
            tools: {
              exec: {
                security: "allowlist",
                ask: "off",
              },
            },
          },
        },
        execApprovalsDirty: true,
        execApprovalsSnapshot: {
          path: "/tmp/exec-approvals.json",
          exists: true,
          hash: "hash-live",
          file: {
            version: 1,
            defaults: {
              security: "allowlist",
              ask: "always",
              askFallback: "deny",
            },
          },
        },
        execApprovalsForm: {
          version: 1,
          defaults: {
            security: "allowlist",
            ask: "off",
            askFallback: "deny",
          },
        },
      }),
      container,
    );

    const stats = container.querySelector(".alisio-security-meta");
    expect(stats?.textContent).toContain("Always");
    expect(stats?.textContent).not.toContain("Off");
  });
});

describe("renderExecApprovalPrompt", () => {
  it("shows human labels for the primary agent and main session", () => {
    const container = document.createElement("div");
    const state = {
      assistantName: "Alisio",
      assistantAgentId: "main",
      execApprovalQueue: [
        {
          id: "approval-1",
          kind: "exec",
          createdAtMs: Date.now(),
          expiresAtMs: Date.now() + 30_000,
          request: {
            command: "uname -a",
            host: "gateway",
            agentId: "main",
            sessionKey: "agent:main:main",
            cwd: "/tmp",
            security: "full",
            ask: "off",
          },
        },
      ],
      execApprovalBusy: false,
      execApprovalError: null,
      handleExecApprovalDecision: () => undefined,
    } as unknown as AppViewState;

    render(renderExecApprovalPrompt(state), container);

    const text = container.textContent ?? "";
    expect(text).toContain("Alisio");
    expect(text).toContain("Main Session");
    expect(text).not.toContain("agent:main:main");
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
      execApprovalAuditTrail: [],
      execApprovalQueue: [],
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
      securityAccessDiagnostics: null,
      updateRunning: false,
    };
  }

  it("skips config and approval writes when the selected mode is already applied", async () => {
    const request = vi.fn().mockImplementation(async (method: string) => {
      if (method === "alisio.security.policy.applyProfile") {
        return {
          changed: false,
          snapshot: {
            target: "gateway",
            diagnostics: {
              mode: "recommended",
              effectivePromptAsk: "on-miss",
              configDefaults: {
                security: "allowlist",
                ask: "on-miss",
              },
              approvalDefaults: {
                security: "allowlist",
                ask: "on-miss",
                askFallback: "deny",
                autoAllowSkills: false,
              },
              configOverrideAgentCount: 0,
              approvalOverrideAgentCount: 0,
            },
            configSource: {
              path: "/tmp/alisio.config.json5",
              exists: true,
              hash: "hash-config",
            },
            approvalsSource: {
              path: "/tmp/exec-approvals.json",
              exists: true,
              hash: "hash-approvals",
            },
            pending: { items: [] },
            audit: { items: [] },
          },
        };
      }
      throw new Error(`unexpected request: ${method}`);
    });

    const state = createControllerState();
    state.client = { request } as unknown as ConfigState["client"];

    await applyGatewayAccessMode(state, "recommended");

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("alisio.security.policy.applyProfile", {
      profile: "recommended",
    });
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

    const request = vi
      .fn()
      .mockImplementation(async (method: string, params?: Record<string, unknown>) => {
        if (method === "alisio.security.policy.applyProfile") {
          expect(params).toEqual({ profile: "recommended" });
          return {
            changed: true,
            snapshot: {
              target: "gateway",
              diagnostics: {
                mode: "recommended",
                effectivePromptAsk: "on-miss",
                configDefaults: {
                  security: "allowlist",
                  ask: "on-miss",
                },
                approvalDefaults: {
                  security: "allowlist",
                  ask: "on-miss",
                  askFallback: "deny",
                  autoAllowSkills: false,
                },
                configOverrideAgentCount: 0,
                approvalOverrideAgentCount: 0,
              },
              configSource: {
                path: "/tmp/alisio.config.json5",
                exists: true,
                hash: "hash-config-1",
              },
              approvalsSource: {
                path: "/tmp/exec-approvals.json",
                exists: true,
                hash: "hash-approvals-1",
              },
              pending: { items: [] },
              audit: { items: [] },
            },
          };
        }
        if (method === "config.get") {
          return {
            hash: "hash-config-2",
            config: cleanedConfig,
          };
        }
        if (method === "exec.approvals.get") {
          return {
            hash: "hash-approvals-2",
            file: cleanedApprovals,
          };
        }
        throw new Error(`unexpected request: ${method}`);
      });

    const state = createControllerState();
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormDirty = true;
    state.configForm = structuredClone(initialConfig);

    await applyGatewayAccessMode(state, "recommended");

    expect(request).toHaveBeenCalledWith("alisio.security.policy.applyProfile", {
      profile: "recommended",
    });
    expect(request).toHaveBeenCalledWith("config.get", {});
    expect(request).toHaveBeenCalledWith("exec.approvals.get", {});
    expect(state.configForm).toEqual(cleanedConfig);
    expect(state.gatewayAccessMode).toBe("recommended");
    expect(state.lastError).toBeNull();
  });

  it("blocks access mode changes while a raw config draft is still dirty", async () => {
    const request = vi.fn();
    const state = createControllerState();
    state.client = { request } as unknown as ConfigState["client"];
    state.configFormDirty = true;
    state.configFormMode = "raw";

    await applyGatewayAccessMode(state, "recommended");

    expect(request).not.toHaveBeenCalled();
    expect(state.lastError).toBe(
      "Save or reload the raw config draft before changing the access mode.",
    );
  });
});

describe("exec approvals target handling", () => {
  function createExecApprovalsTargetState(): ExecApprovalsTargetState {
    return {
      client: null,
      connected: true,
      execApprovalsLoading: false,
      execApprovalsSaving: false,
      execApprovalsDirty: false,
      execApprovalsSnapshot: null,
      execApprovalsForm: null,
      execApprovalsSelectedAgent: null,
      execApprovalsTarget: "gateway",
      execApprovalsTargetNodeId: null,
      lastError: null,
    };
  }

  it("clears stale approvals without error when node target has no selected node", async () => {
    const request = vi.fn();
    const state = createExecApprovalsTargetState();
    state.client = { request } as unknown as ExecApprovalsTargetState["client"];
    state.execApprovalsTarget = "node";
    state.execApprovalsSnapshot = {
      path: "/tmp/exec-approvals.json",
      exists: true,
      hash: "hash-gateway",
      file: {
        version: 1,
        defaults: {
          security: "allowlist",
        },
      },
    };
    state.execApprovalsForm = {
      version: 1,
      defaults: {
        security: "allowlist",
      },
    };

    await loadSelectedExecApprovals(state);

    expect(request).not.toHaveBeenCalled();
    expect(state.execApprovalsSnapshot).toBeNull();
    expect(state.execApprovalsForm).toBeNull();
    expect(state.lastError).toBeNull();
  });

  it("blocks target switches while the current draft is dirty", async () => {
    const request = vi.fn();
    const state = createExecApprovalsTargetState();
    state.client = { request } as unknown as ExecApprovalsTargetState["client"];
    state.execApprovalsDirty = true;

    await changeExecApprovalsTarget(state, { kind: "node", nodeId: "node-1" });

    expect(request).not.toHaveBeenCalled();
    expect(state.execApprovalsTarget).toBe("gateway");
    expect(state.execApprovalsTargetNodeId).toBeNull();
    expect(state.lastError).toBe(
      "Save or reload the current exec approvals draft before changing target.",
    );
  });

  it("loads node approvals when switching to a concrete node target", async () => {
    const request = vi.fn().mockResolvedValue({
      path: "/tmp/node-exec-approvals.json",
      exists: true,
      hash: "hash-node-1",
      file: {
        version: 1,
        defaults: {
          security: "allowlist",
          ask: "always",
        },
      },
    });
    const state = createExecApprovalsTargetState();
    state.client = { request } as unknown as ExecApprovalsTargetState["client"];

    await changeExecApprovalsTarget(state, { kind: "node", nodeId: "node-1" });

    expect(request).toHaveBeenCalledWith("exec.approvals.node.get", { nodeId: "node-1" });
    expect(state.execApprovalsTarget).toBe("node");
    expect(state.execApprovalsTargetNodeId).toBe("node-1");
    expect(state.execApprovalsSnapshot?.hash).toBe("hash-node-1");
    expect(state.execApprovalsForm).toEqual({
      version: 1,
      defaults: {
        security: "allowlist",
        ask: "always",
      },
    });
  });
});
