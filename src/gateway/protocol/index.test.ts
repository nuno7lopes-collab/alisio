import type { ErrorObject } from "ajv";
import { describe, expect, it } from "vitest";
import {
  formatValidationErrors,
  validateAlisioSecurityPolicyApplyProfileResult,
  validateAlisioSecurityPolicySnapshot,
  validateApprovalAuditSnapshot,
  validateApprovalPendingSnapshot,
  validateChannelsStatusResult,
  validateTalkConfigResult,
} from "./index.js";

const makeError = (overrides: Partial<ErrorObject>): ErrorObject => ({
  keyword: "type",
  instancePath: "",
  schemaPath: "#/",
  params: {},
  message: "validation error",
  ...overrides,
});

describe("formatValidationErrors", () => {
  it("returns unknown validation error when missing errors", () => {
    expect(formatValidationErrors(undefined)).toBe("unknown validation error");
    expect(formatValidationErrors(null)).toBe("unknown validation error");
  });

  it("returns unknown validation error when errors list is empty", () => {
    expect(formatValidationErrors([])).toBe("unknown validation error");
  });

  it("formats additionalProperties at root", () => {
    const err = makeError({
      keyword: "additionalProperties",
      params: { additionalProperty: "token" },
    });

    expect(formatValidationErrors([err])).toBe("at root: unexpected property 'token'");
  });

  it("formats additionalProperties with instancePath", () => {
    const err = makeError({
      keyword: "additionalProperties",
      instancePath: "/auth",
      params: { additionalProperty: "token" },
    });

    expect(formatValidationErrors([err])).toBe("at /auth: unexpected property 'token'");
  });

  it("formats message with path for other errors", () => {
    const err = makeError({
      keyword: "required",
      instancePath: "/auth",
      message: "must have required property 'token'",
    });

    expect(formatValidationErrors([err])).toBe("at /auth: must have required property 'token'");
  });

  it("de-dupes repeated entries", () => {
    const err = makeError({
      keyword: "required",
      instancePath: "/auth",
      message: "must have required property 'token'",
    });

    expect(formatValidationErrors([err, err])).toBe(
      "at /auth: must have required property 'token'",
    );
  });
});

describe("validateTalkConfigResult", () => {
  it("accepts Talk SecretRef payloads", () => {
    expect(
      validateTalkConfigResult({
        config: {
          talk: {
            provider: "elevenlabs",
            providers: {
              elevenlabs: {
                apiKey: {
                  source: "env",
                  provider: "default",
                  id: "ELEVENLABS_API_KEY",
                },
              },
            },
            resolved: {
              provider: "elevenlabs",
              config: {
                apiKey: {
                  source: "env",
                  provider: "default",
                  id: "ELEVENLABS_API_KEY",
                },
              },
            },
            apiKey: {
              source: "env",
              provider: "default",
              id: "ELEVENLABS_API_KEY",
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("rejects normalized talk payloads without talk.resolved", () => {
    expect(
      validateTalkConfigResult({
        config: {
          talk: {
            provider: "elevenlabs",
            providers: {
              elevenlabs: {
                voiceId: "voice-normalized",
              },
            },
          },
        },
      }),
    ).toBe(false);
  });
});

describe("validateChannelsStatusResult", () => {
  it("aceita snapshots de canais com wizard em curso", () => {
    expect(
      validateChannelsStatusResult({
        ts: Date.now(),
        channelOrder: ["telegram"],
        channelLabels: { telegram: "Telegram" },
        channelDetailLabels: { telegram: "Bot, groups, and direct messages" },
        channelSystemImages: {},
        wizard: {
          running: true,
          sessionId: "wiz-telegram-1",
          channelId: "telegram",
        },
        channelMeta: [
          {
            id: "telegram",
            label: "Telegram",
            detailLabel: "Bot, groups, and direct messages",
            docsPath: "/channels/telegram",
          },
        ],
        channelIssues: {},
        channels: {
          telegram: {
            configured: false,
            setupAvailable: true,
            linkMode: "wizard",
          },
        },
        channelAccounts: {
          telegram: [
            {
              accountId: "default",
              configured: false,
            },
          ],
        },
        channelDefaultAccountId: {
          telegram: "default",
        },
      }),
    ).toBe(true);
  });
});

describe("validateApprovalAuditSnapshot", () => {
  it("accepts exec and plugin approval audit entries", () => {
    expect(
      validateApprovalAuditSnapshot({
        items: [
          {
            kind: "exec",
            id: "approval-1",
            decision: "allow-once",
            resolvedBy: "operator",
            ts: Date.now(),
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
            decision: "deny",
            ts: Date.now(),
            request: {
              title: "Publish release",
              description: "Pushes release metadata to the host",
              severity: "critical",
              pluginId: "publisher",
              toolName: "release.publish",
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects malformed approval audit entries", () => {
    expect(
      validateApprovalAuditSnapshot({
        items: [
          {
            kind: "exec",
            id: "approval-1",
            decision: "allow-once",
            ts: Date.now(),
            request: {
              host: "sandbox",
            },
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("validateApprovalPendingSnapshot", () => {
  it("accepts exec and plugin pending approval entries", () => {
    expect(
      validateApprovalPendingSnapshot({
        items: [
          {
            kind: "exec",
            id: "approval-1",
            createdAtMs: Date.now() - 1000,
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
            createdAtMs: Date.now() - 500,
            expiresAtMs: Date.now() + 60_000,
            request: {
              title: "Publish release",
              description: "Pushes release metadata to the host",
              severity: "critical",
              pluginId: "publisher",
              toolName: "release.publish",
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it("rejects malformed pending approval entries", () => {
    expect(
      validateApprovalPendingSnapshot({
        items: [
          {
            kind: "exec",
            id: "approval-1",
            createdAtMs: Date.now() - 1000,
            expiresAtMs: Date.now() + 60_000,
            request: {
              host: "sandbox",
            },
          },
        ],
      }),
    ).toBe(false);
  });
});

describe("validateAlisioSecurityPolicySnapshot", () => {
  it("accepts the canonical security policy payload", () => {
    expect(
      validateAlisioSecurityPolicySnapshot({
        target: "gateway",
        diagnostics: {
          mode: "recommended",
          effectivePromptAsk: "on-miss",
          configDefaults: {
            host: "auto",
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
          hash: "config-hash",
        },
        approvalsSource: {
          path: "/tmp/exec-approvals.json",
          exists: true,
          hash: "approvals-hash",
        },
        pending: { items: [] },
        audit: { items: [] },
      }),
    ).toBe(true);
  });
});

describe("validateAlisioSecurityPolicyApplyProfileResult", () => {
  it("accepts an apply-profile result", () => {
    expect(
      validateAlisioSecurityPolicyApplyProfileResult({
        changed: true,
        snapshot: {
          target: "gateway",
          diagnostics: {
            mode: "full-access",
            effectivePromptAsk: "off",
            configDefaults: {
              host: "gateway",
              security: "full",
              ask: "off",
            },
            approvalDefaults: {
              security: "full",
              ask: "off",
              askFallback: "full",
              autoAllowSkills: false,
            },
            configOverrideAgentCount: 0,
            approvalOverrideAgentCount: 0,
          },
          configSource: {
            path: "/tmp/alisio.config.json5",
            exists: true,
            hash: "config-hash",
          },
          approvalsSource: {
            path: "/tmp/exec-approvals.json",
            exists: true,
            hash: "approvals-hash",
          },
          pending: { items: [] },
          audit: { items: [] },
        },
      }),
    ).toBe(true);
  });
});
