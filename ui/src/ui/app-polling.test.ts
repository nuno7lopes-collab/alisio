import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadChatHistoryMock, loadMemoryStatusMock, loadNodesMock, loadTasksOverviewMock } =
  vi.hoisted(() => ({
    loadChatHistoryMock: vi.fn(),
    loadMemoryStatusMock: vi.fn(),
    loadNodesMock: vi.fn(),
    loadTasksOverviewMock: vi.fn(),
  }));

vi.mock("./controllers/chat.ts", () => ({
  loadChatHistory: loadChatHistoryMock,
}));

vi.mock("./controllers/nodes.ts", () => ({
  loadNodes: loadNodesMock,
}));

vi.mock("./controllers/memory-runtime.ts", () => ({
  loadMemoryStatus: loadMemoryStatusMock,
}));

vi.mock("./controllers/tasks.ts", () => ({
  loadTasksOverview: loadTasksOverviewMock,
}));

let startChatRecoveryPolling!: typeof import("./app-polling.ts").startChatRecoveryPolling;
let startMemoryPolling!: typeof import("./app-polling.ts").startMemoryPolling;
let startNodesPolling!: typeof import("./app-polling.ts").startNodesPolling;
let startTasksPolling!: typeof import("./app-polling.ts").startTasksPolling;
let stopChatRecoveryPolling!: typeof import("./app-polling.ts").stopChatRecoveryPolling;
let stopMemoryPolling!: typeof import("./app-polling.ts").stopMemoryPolling;
let stopNodesPolling!: typeof import("./app-polling.ts").stopNodesPolling;
let stopTasksPolling!: typeof import("./app-polling.ts").stopTasksPolling;

async function loadSubject() {
  vi.resetModules();
  ({
    startChatRecoveryPolling,
    startMemoryPolling,
    startNodesPolling,
    startTasksPolling,
    stopChatRecoveryPolling,
    stopMemoryPolling,
    stopNodesPolling,
    stopTasksPolling,
  } = await import("./app-polling.ts"));
}

type MockRequest = ReturnType<typeof vi.fn> &
  (<T>(method: string, params: Record<string, unknown>) => Promise<T>);

type MockClient = {
  request: MockRequest;
};

type PollingHost = {
  nodesPollInterval: number | null;
  memoryPollInterval: number | null;
  tasksPollInterval: number | null;
  logsPollInterval: number | null;
  debugPollInterval: number | null;
  chatRecoveryPollInterval: number | null;
  tab: string;
  settingsSection?: string;
  connected?: boolean;
  client?: MockClient | null;
  sessionKey?: string;
  assistantAgentId?: string | null;
  memorySelectedAgentId?: string | null;
  agentsList?: { defaultId?: string | null; agents: Array<{ id: string }> } | null;
  chatRunId?: string | null;
  chatFinalizing?: boolean;
  chatStream?: string | null;
  chatStreamStartedAt?: number | null;
  resetToolStream?: () => void;
};

function createHost(tab: string, overrides: Partial<PollingHost> = {}): PollingHost {
  const request = vi.fn(async () => undefined) as unknown as MockRequest;
  return {
    nodesPollInterval: null,
    memoryPollInterval: null,
    tasksPollInterval: null,
    logsPollInterval: null,
    debugPollInterval: null,
    chatRecoveryPollInterval: null,
    tab,
    connected: true,
    client: { request },
    sessionKey: "main",
    assistantAgentId: "main",
    memorySelectedAgentId: "main",
    chatRunId: null,
    chatFinalizing: false,
    chatStream: null,
    chatStreamStartedAt: null,
    resetToolStream: vi.fn(),
    agentsList: {
      defaultId: "main",
      agents: [{ id: "main" }],
    },
    ...overrides,
  };
}

function setVisibilityState(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

describe("startNodesPolling", () => {
  beforeEach(async () => {
    await loadSubject();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {},
    });
    vi.useFakeTimers();
    loadNodesMock.mockReset();
    loadMemoryStatusMock.mockReset();
    loadTasksOverviewMock.mockReset();
    loadChatHistoryMock.mockReset();
    setVisibilityState("visible");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it("ignora tabs que não precisam de polling de nós", () => {
    const host = createHost("chat");

    startNodesPolling(host);
    vi.advanceTimersByTime(5_000);

    expect(loadNodesMock).not.toHaveBeenCalled();
    stopNodesPolling(host);
  });

  it("faz polling quando a vista activa depende de nós", () => {
    const host = createHost("connections");

    startNodesPolling(host);
    vi.advanceTimersByTime(5_000);

    expect(loadNodesMock).toHaveBeenCalledTimes(1);
    expect(loadNodesMock).toHaveBeenCalledWith(host, { quiet: true });
    stopNodesPolling(host);
  });

  it("suspende polling quando o documento está em background", () => {
    const host = createHost("security");
    setVisibilityState("hidden");

    startNodesPolling(host);
    vi.advanceTimersByTime(5_000);

    expect(loadNodesMock).not.toHaveBeenCalled();
    stopNodesPolling(host);
  });
});

describe("startMemoryPolling", () => {
  beforeEach(async () => {
    await loadSubject();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {},
    });
    vi.useFakeTimers();
    loadMemoryStatusMock.mockReset();
    setVisibilityState("visible");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it("ignora tabs fora da memória", () => {
    const host = createHost("chat");

    startMemoryPolling(host);
    vi.advanceTimersByTime(5_000);

    expect(loadMemoryStatusMock).not.toHaveBeenCalled();
    stopMemoryPolling(host);
  });

  it("faz polling do estado da memória na tab Memória", () => {
    const host = createHost("memory");

    startMemoryPolling(host);
    vi.advanceTimersByTime(5_000);

    expect(loadMemoryStatusMock).toHaveBeenCalledTimes(1);
    expect(loadMemoryStatusMock).toHaveBeenCalledWith(host, "main");
    stopMemoryPolling(host);
  });

  it("ignora polling sem agente resolvido", () => {
    const host = createHost("memory", {
      memorySelectedAgentId: null,
      assistantAgentId: null,
      agentsList: { defaultId: null, agents: [] },
    });

    startMemoryPolling(host);
    vi.advanceTimersByTime(5_000);

    expect(loadMemoryStatusMock).not.toHaveBeenCalled();
    stopMemoryPolling(host);
  });
});

describe("startTasksPolling", () => {
  beforeEach(async () => {
    await loadSubject();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {},
    });
    vi.useFakeTimers();
    loadTasksOverviewMock.mockReset();
    setVisibilityState("visible");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it("ignores tabs outside the tasks view", () => {
    const host = createHost("chat");

    startTasksPolling(host);
    vi.advanceTimersByTime(5_000);

    expect(loadTasksOverviewMock).not.toHaveBeenCalled();
    stopTasksPolling(host);
  });

  it("polls the overview from the Tasks tab", () => {
    const host = createHost("tasks");

    startTasksPolling(host);
    vi.advanceTimersByTime(5_000);

    expect(loadTasksOverviewMock).toHaveBeenCalledTimes(1);
    expect(loadTasksOverviewMock).toHaveBeenCalledWith(host, { quiet: true });
    stopTasksPolling(host);
  });

  it("suspends polling when the document is hidden", () => {
    const host = createHost("tasks");
    setVisibilityState("hidden");

    startTasksPolling(host);
    vi.advanceTimersByTime(5_000);

    expect(loadTasksOverviewMock).not.toHaveBeenCalled();
    stopTasksPolling(host);
  });
});

describe("startChatRecoveryPolling", () => {
  beforeEach(async () => {
    await loadSubject();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: globalThis,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {},
    });
    vi.useFakeTimers();
    loadChatHistoryMock.mockReset();
    setVisibilityState("visible");
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
  });

  it("ignora o recovery polling quando não há run activa", async () => {
    const host = createHost("chat");

    startChatRecoveryPolling(host);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(host.client?.request).not.toHaveBeenCalled();
    expect(loadChatHistoryMock).not.toHaveBeenCalled();
    stopChatRecoveryPolling(host);
  });

  it("não limpa uma run ainda marcada como running", async () => {
    const host = createHost("chat", {
      chatRunId: "run-1",
      chatStreamStartedAt: 5_000,
    });
    host.client?.request.mockResolvedValue({
      sessions: [
        {
          key: "main",
          kind: "direct",
          updatedAt: 6_000,
          status: "running",
        },
      ],
    });

    startChatRecoveryPolling(host);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
    stopChatRecoveryPolling(host);
  });

  it("recupera um chat preso quando a sessão já terminou depois do arranque local", async () => {
    const host = createHost("chat", {
      chatRunId: "run-1",
      chatStream: "stuck stream",
      chatStreamStartedAt: 5_000,
    });
    host.client?.request.mockResolvedValue({
      sessions: [
        {
          key: "main",
          kind: "direct",
          updatedAt: 9_000,
          status: "done",
          endedAt: 8_500,
        },
      ],
    });

    startChatRecoveryPolling(host);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(loadChatHistoryMock).toHaveBeenCalledWith(host, {
      silent: true,
      preserveEphemeral: false,
    });
    expect(host.chatRunId).toBeNull();
    expect(host.chatFinalizing).toBe(false);
    expect(host.chatStream).toBeNull();
    expect(host.chatStreamStartedAt).toBeNull();
    stopChatRecoveryPolling(host);
  });

  it("ignora estado terminal antigo que pertence à run anterior", async () => {
    const host = createHost("chat", {
      chatRunId: "run-1",
      chatStreamStartedAt: 9_000,
    });
    host.client?.request.mockResolvedValue({
      sessions: [
        {
          key: "main",
          kind: "direct",
          updatedAt: 6_500,
          status: "done",
          endedAt: 6_000,
        },
      ],
    });

    startChatRecoveryPolling(host);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(loadChatHistoryMock).not.toHaveBeenCalled();
    stopChatRecoveryPolling(host);
  });

  it("força recovery quando o chat ficou preso em finalizing", async () => {
    const host = createHost("chat", {
      chatFinalizing: true,
      chatStream: "finishing",
    });
    host.client?.request.mockResolvedValue({
      sessions: [
        {
          key: "main",
          kind: "direct",
          updatedAt: 9_000,
          status: "done",
          endedAt: 8_500,
        },
      ],
    });

    startChatRecoveryPolling(host);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(loadChatHistoryMock).toHaveBeenCalledWith(host, {
      silent: true,
      preserveEphemeral: false,
    });
    expect(host.chatRunId).toBeNull();
    expect(host.chatFinalizing).toBe(false);
    expect(host.chatStream).toBeNull();
    stopChatRecoveryPolling(host);
  });
});
