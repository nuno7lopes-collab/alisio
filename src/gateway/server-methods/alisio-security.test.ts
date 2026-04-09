import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalAuditTrailEntry, ApprovalPendingSnapshot } from "./approval-audit.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

const mocks = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(),
  resolveConfigSnapshotHash: vi.fn(),
  ensureExecApprovals: vi.fn(),
  readExecApprovalsSnapshot: vi.fn(),
  configPatchHandler: vi.fn(),
  execApprovalsSetHandler: vi.fn(),
  listApprovalAuditTrail: vi.fn<() => ApprovalAuditTrailEntry[]>(() => []),
  listPendingApprovalSnapshot: vi.fn<() => ApprovalPendingSnapshot>(() => ({ items: [] })),
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    readConfigFileSnapshot: mocks.readConfigFileSnapshot,
    resolveConfigSnapshotHash: mocks.resolveConfigSnapshotHash,
  };
});

vi.mock("../../infra/exec-approvals.js", async () => {
  const actual = await vi.importActual<typeof import("../../infra/exec-approvals.js")>(
    "../../infra/exec-approvals.js",
  );
  return {
    ...actual,
    ensureExecApprovals: mocks.ensureExecApprovals,
    readExecApprovalsSnapshot: mocks.readExecApprovalsSnapshot,
  };
});

vi.mock("./config.js", () => ({
  configHandlers: {
    "config.patch": (...args: Parameters<typeof mocks.configPatchHandler>) =>
      mocks.configPatchHandler(...args),
  },
}));

vi.mock("./exec-approvals.js", () => ({
  execApprovalsHandlers: {
    "exec.approvals.set": (...args: Parameters<typeof mocks.execApprovalsSetHandler>) =>
      mocks.execApprovalsSetHandler(...args),
  },
}));

vi.mock("./approval-audit.js", async () => {
  const actual = await vi.importActual<typeof import("./approval-audit.js")>("./approval-audit.js");
  return {
    ...actual,
    listApprovalAuditTrail: mocks.listApprovalAuditTrail,
    listPendingApprovalSnapshot: mocks.listPendingApprovalSnapshot,
  };
});

import { alisioSecurityPolicyHandlers } from "./alisio-security.js";

function createOptions(
  method: "alisio.security.policy.get" | "alisio.security.policy.applyProfile",
  params: Record<string, unknown>,
  overrides?: Partial<GatewayRequestHandlerOptions>,
): GatewayRequestHandlerOptions {
  return {
    req: { type: "req", id: "req-1", method, params },
    params,
    client: null,
    isWebchatConnect: () => false,
    respond: vi.fn(),
    context: {
      logGateway: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    },
    ...overrides,
  } as unknown as GatewayRequestHandlerOptions;
}

describe("alisioSecurityPolicyHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveConfigSnapshotHash.mockReturnValue("config-hash");
    mocks.listApprovalAuditTrail.mockReturnValue([]);
    mocks.listPendingApprovalSnapshot.mockReturnValue({ items: [] });
    mocks.configPatchHandler.mockImplementation(({ respond }) => {
      respond(true, { ok: true }, undefined);
    });
    mocks.execApprovalsSetHandler.mockImplementation(({ respond }) => {
      respond(true, { ok: true }, undefined);
    });
  });

  it("returns a canonical security policy snapshot", async () => {
    mocks.readConfigFileSnapshot.mockResolvedValue({
      path: "/tmp/alisio.config.json5",
      exists: true,
      config: {
        tools: {
          exec: {
            security: "allowlist",
            ask: "on-miss",
          },
        },
      },
    });
    mocks.readExecApprovalsSnapshot.mockReturnValue({
      path: "/tmp/exec-approvals.json",
      exists: true,
      hash: "approvals-hash",
      file: {
        version: 1,
        defaults: {
          security: "allowlist",
          ask: "on-miss",
          askFallback: "deny",
          autoAllowSkills: false,
        },
      },
    });
    mocks.listPendingApprovalSnapshot.mockReturnValue({
      items: [
        {
          kind: "exec",
          id: "approval-1",
          createdAtMs: 1000,
          expiresAtMs: 2000,
          request: {
            command: "bun test",
            host: "sandbox",
            security: "allowlist",
            ask: "on-miss",
          },
        },
      ],
    });
    mocks.listApprovalAuditTrail.mockReturnValue([
      {
        kind: "exec",
        id: "approval-1",
        decision: "allow-once",
        resolvedBy: "Operator",
        ts: 1000,
        request: {
          command: "bun test",
          host: "sandbox",
          security: "allowlist",
          ask: "on-miss",
        },
      },
    ]);

    const options = createOptions("alisio.security.policy.get", {});

    await alisioSecurityPolicyHandlers["alisio.security.policy.get"](options);

    expect(options.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        target: "gateway",
        diagnostics: expect.objectContaining({
          mode: "recommended",
          effectivePromptAsk: "on-miss",
          configOverrideAgentCount: 0,
          approvalOverrideAgentCount: 0,
        }),
        configSource: expect.objectContaining({
          path: "/tmp/alisio.config.json5",
          hash: "config-hash",
        }),
        approvalsSource: expect.objectContaining({
          path: "/tmp/exec-approvals.json",
          hash: "approvals-hash",
        }),
        pending: expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ id: "approval-1" })]),
        }),
        audit: expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ id: "approval-1" })]),
        }),
      }),
      undefined,
    );
  });

  it("applies a profile through the real config and approvals handlers", async () => {
    mocks.readConfigFileSnapshot
      .mockResolvedValueOnce({
        path: "/tmp/alisio.config.json5",
        exists: true,
        config: {
          tools: {
            exec: {
              security: "full",
              ask: "off",
            },
          },
        },
      })
      .mockResolvedValueOnce({
        path: "/tmp/alisio.config.json5",
        exists: true,
        config: {
          tools: {
            exec: {
              security: "allowlist",
              ask: "on-miss",
            },
          },
        },
      });
    mocks.readExecApprovalsSnapshot
      .mockReturnValueOnce({
        path: "/tmp/exec-approvals.json",
        exists: true,
        hash: "approvals-hash",
        file: {
          version: 1,
          defaults: {
            security: "full",
            ask: "off",
            askFallback: "full",
            autoAllowSkills: false,
          },
        },
      })
      .mockReturnValueOnce({
        path: "/tmp/exec-approvals.json",
        exists: true,
        hash: "approvals-hash-2",
        file: {
          version: 1,
          defaults: {
            security: "allowlist",
            ask: "on-miss",
            askFallback: "deny",
            autoAllowSkills: false,
          },
        },
      });

    const options = createOptions("alisio.security.policy.applyProfile", {
      profile: "recommended",
    });

    await alisioSecurityPolicyHandlers["alisio.security.policy.applyProfile"](options);

    expect(mocks.execApprovalsSetHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          baseHash: "approvals-hash",
          file: expect.objectContaining({
            defaults: expect.objectContaining({
              security: "allowlist",
              ask: "on-miss",
              askFallback: "deny",
            }),
          }),
        }),
      }),
    );
    expect(mocks.configPatchHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          baseHash: "config-hash",
          raw: expect.any(String),
        }),
      }),
    );
    expect(mocks.execApprovalsSetHandler.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.configPatchHandler.mock.invocationCallOrder[0],
    );
    expect(options.respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        changed: true,
        snapshot: expect.objectContaining({
          diagnostics: expect.objectContaining({
            mode: "recommended",
          }),
        }),
      }),
      undefined,
    );
  });
});
