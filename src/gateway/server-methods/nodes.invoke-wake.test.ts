import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";
import { nodeHandlers } from "./nodes.js";

type MockNodeCommandPolicyParams = {
  command: string;
  declaredCommands?: string[];
  allowlist: Set<string>;
};

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({})),
  getAlisioSharingTargetAccessIndex: vi.fn(),
  listDevicePairing: vi.fn(),
  resolveNodeCommandAllowlist: vi.fn<() => Set<string>>(() => new Set()),
  isNodeCommandAllowed: vi.fn<
    (params: MockNodeCommandPolicyParams) => { ok: true } | { ok: false; reason: string }
  >(() => ({ ok: true })),
  sanitizeNodeInvokeParamsForForwarding: vi.fn(({ rawParams }: { rawParams: unknown }) => ({
    ok: true,
    params: rawParams,
  })),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig,
}));

vi.mock("../../infra/alisio-store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/alisio-store.js")>();
  return {
    ...actual,
    getAlisioSharingTargetAccessIndex: mocks.getAlisioSharingTargetAccessIndex,
  };
});

vi.mock("../../infra/device-pairing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../infra/device-pairing.js")>();
  return {
    ...actual,
    listDevicePairing: mocks.listDevicePairing,
  };
});

vi.mock("../node-command-policy.js", () => ({
  resolveNodeCommandAllowlist: mocks.resolveNodeCommandAllowlist,
  isNodeCommandAllowed: mocks.isNodeCommandAllowed,
}));

vi.mock("../node-invoke-sanitize.js", () => ({
  sanitizeNodeInvokeParamsForForwarding: mocks.sanitizeNodeInvokeParamsForForwarding,
}));

type RespondCall = [
  boolean,
  unknown?,
  {
    code?: number;
    message?: string;
    details?: unknown;
  }?,
];

type TestNodeSession = {
  nodeId: string;
  commands: string[];
  platform?: string;
  displayName?: string;
};

function createPairedNode(nodeId: string) {
  return {
    deviceId: nodeId,
    publicKey: `pk-${nodeId}`,
    displayName: nodeId,
    platform: "macOS 26.4.0",
    roles: ["node"],
    createdAtMs: 1,
    approvedAtMs: 1,
  };
}

function makeNodeInvokeParams(overrides?: Partial<Record<string, unknown>>) {
  return {
    nodeId: "mac-node-1",
    command: "camera.capture",
    params: { quality: "high" },
    timeoutMs: 5000,
    idempotencyKey: "idem-node-invoke",
    ...overrides,
  };
}

async function invokeNode(params: {
  nodeRegistry: {
    get: (nodeId: string) => TestNodeSession | undefined;
    listConnected?: () => TestNodeSession[];
    invoke: (payload: {
      nodeId: string;
      command: string;
      params?: unknown;
      timeoutMs?: number;
      idempotencyKey?: string;
    }) => Promise<{
      ok: boolean;
      payload?: unknown;
      payloadJSON?: string | null;
      error?: { code?: string; message?: string } | null;
    }>;
  };
  requestParams?: Partial<Record<string, unknown>>;
}) {
  const requestParams = makeNodeInvokeParams(params.requestParams);
  const requestNodeId = String(requestParams.nodeId ?? "").trim();
  const listConnected =
    params.nodeRegistry.listConnected ??
    (() => {
      const connected = requestNodeId ? params.nodeRegistry.get(requestNodeId) : undefined;
      return connected ? [connected] : [];
    });
  mocks.listDevicePairing.mockResolvedValue({
    pending: [],
    paired: requestNodeId ? [createPairedNode(requestNodeId)] : [],
  });
  const respond = vi.fn();
  await nodeHandlers["node.invoke"]({
    params: requestParams,
    respond: respond as never,
    context: {
      nodeRegistry: {
        ...params.nodeRegistry,
        listConnected,
      },
      execApprovalManager: undefined,
      logGateway: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    } as never,
    client: null,
    req: { type: "req", id: "req-node-invoke", method: "node.invoke" },
    isWebchatConnect: () => false,
  });
  return respond;
}

describe("node.invoke desktop-first behavior", () => {
  beforeEach(() => {
    mocks.loadConfig.mockClear();
    mocks.loadConfig.mockReturnValue({});
    mocks.getAlisioSharingTargetAccessIndex.mockClear();
    mocks.getAlisioSharingTargetAccessIndex.mockImplementation(
      async (input?: { targets?: Array<{ targetId: string }> }) =>
        Object.fromEntries(
          (input?.targets ?? []).map((target) => [
            target.targetId,
            {
              targetId: target.targetId,
              label: target.targetId,
              sourceKind: "node",
              connected: true,
              current: false,
              ownerKey: "user:user-1",
              ownerScope: "user",
              ownerLabel: "Owner",
              registeredAt: "2026-04-08T10:00:00.000Z",
              updatedAt: "2026-04-08T10:00:00.000Z",
              deviceAccess: "owner",
              modelAccess: "owner",
              execAccess: "owner",
            },
          ]),
        ),
    );
    mocks.listDevicePairing.mockClear();
    mocks.listDevicePairing.mockResolvedValue({ pending: [], paired: [] });
    mocks.resolveNodeCommandAllowlist.mockClear();
    mocks.resolveNodeCommandAllowlist.mockReturnValue(new Set());
    mocks.isNodeCommandAllowed.mockClear();
    mocks.isNodeCommandAllowed.mockReturnValue({ ok: true });
    mocks.sanitizeNodeInvokeParamsForForwarding.mockClear();
    mocks.sanitizeNodeInvokeParamsForForwarding.mockImplementation(
      ({ rawParams }: { rawParams: unknown }) => ({ ok: true, params: rawParams }),
    );
  });

  it("mantém o erro de nó desligado quando a sessão não está ligada", async () => {
    const nodeRegistry = {
      get: vi.fn(() => undefined),
      invoke: vi.fn().mockResolvedValue({ ok: true }),
    };

    const respond = await invokeNode({ nodeRegistry });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.code).toBe(ErrorCodes.UNAVAILABLE);
    expect(call?.[2]?.message).toBe("node not connected");
    expect(nodeRegistry.invoke).not.toHaveBeenCalled();
  });

  it("invoca directamente quando o nó está ligado", async () => {
    const nodeRegistry = {
      get: vi.fn(() => ({
        nodeId: "mac-node-1",
        commands: ["camera.capture"],
        platform: "macOS 26.4.0",
      })),
      invoke: vi.fn().mockResolvedValue({
        ok: true,
        payload: { ok: true },
        payloadJSON: "{\"ok\":true}",
      }),
    };

    const respond = await invokeNode({ nodeRegistry });

    expect(nodeRegistry.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "mac-node-1",
        command: "camera.capture",
      }),
    );
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(true);
    expect(call?.[1]).toMatchObject({ ok: true, nodeId: "mac-node-1" });
  });

  it("bloqueia comandos mutáveis em dispositivos partilhados", async () => {
    mocks.getAlisioSharingTargetAccessIndex.mockResolvedValue({
      "shared-node-1": {
        targetId: "shared-node-1",
        label: "shared-node-1",
        sourceKind: "node",
        connected: true,
        current: false,
        ownerKey: "user:user-1",
        ownerScope: "user",
        ownerLabel: "Owner",
        registeredAt: "2026-04-08T10:00:00.000Z",
        updatedAt: "2026-04-08T10:00:00.000Z",
        deviceAccess: "shared",
        modelAccess: "shared",
        execAccess: "shared",
      },
    });

    const nodeRegistry = {
      get: vi.fn(() => ({
        nodeId: "shared-node-1",
        commands: ["model.manage.install"],
        platform: "macOS",
      })),
      invoke: vi.fn().mockResolvedValue({ ok: true }),
    };

    const respond = await invokeNode({
      nodeRegistry,
      requestParams: {
        nodeId: "shared-node-1",
        command: "model.manage.install",
        params: { modelId: "qwen3:8b" },
        idempotencyKey: "idem-shared-readonly",
      },
    });
    const call = respond.mock.calls[0] as RespondCall | undefined;
    expect(call?.[0]).toBe(false);
    expect(call?.[2]?.message).toBe("shared devices are read-only");
    expect(nodeRegistry.invoke).not.toHaveBeenCalled();
  });
});
