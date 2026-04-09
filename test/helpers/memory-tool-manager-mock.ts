import { vi } from "vitest";

export type SearchImpl = () => Promise<unknown[]>;
export type MemoryReadParams = { relPath: string; from?: number; lines?: number };
export type MemoryReadResult = { text: string; path: string };
type MemoryBackend = "builtin" | "qmd";
type CanonicalStorePayload = {
  state: "pending-sync" | "ready";
  path: string;
  profileId: string;
  profileSource: string;
  workspaceScope: string;
  workspaceDir: string;
  backend: MemoryBackend;
  entities: number;
  relations: number;
  projections: number;
  projectionInterface: "markdown-vault";
  syncMode: "local-first";
  cloudSync: "unavailable" | "enabled" | "error";
  projectionSources: Array<"workspace-memory" | "obsidian-memory">;
  lastSyncedAt?: string;
  lastError?: string;
};

let backend: MemoryBackend = "builtin";
let searchImpl: SearchImpl = async () => [];
let readFileImpl: (params: MemoryReadParams) => Promise<MemoryReadResult> = async (params) => ({
  text: "",
  path: params.relPath,
});
let canonicalStoreStatus: CanonicalStorePayload | null = {
  state: "ready",
  path: "/workspace/.alisio/memory/profiles/local-main/canonical.sqlite",
  profileId: "local-main",
  profileSource: "local-profile",
  workspaceScope: "scope-main",
  workspaceDir: "/workspace",
  backend: "builtin",
  entities: 1,
  relations: 0,
  projections: 1,
  projectionInterface: "markdown-vault",
  syncMode: "local-first",
  cloudSync: "unavailable",
  projectionSources: ["workspace-memory"],
  lastSyncedAt: "2026-04-08T10:00:00.000Z",
};

const stubManager = {
  search: vi.fn(async () => await searchImpl()),
  readFile: vi.fn(async (params: MemoryReadParams) => await readFileImpl(params)),
  status: () => ({
    backend,
    files: 1,
    chunks: 1,
    dirty: false,
    workspaceDir: "/workspace",
    dbPath: "/workspace/.memory/index.sqlite",
    provider: "builtin",
    model: "builtin",
    requestedProvider: "builtin",
    sources: ["memory" as const],
    sourceCounts: [{ source: "memory" as const, files: 1, chunks: 1 }],
    custom: canonicalStoreStatus ? { canonicalStore: canonicalStoreStatus } : undefined,
  }),
  sync: vi.fn(),
  probeVectorAvailability: vi.fn(async () => true),
  close: vi.fn(),
};

const getMemorySearchManagerMock = vi.fn(async () => ({ manager: stubManager }));
const readAgentMemoryFileMock = vi.fn(
  async (params: MemoryReadParams) => await readFileImpl(params),
);

const { memoryIndexModuleId, memoryToolsRuntimeModuleId } = vi.hoisted(() => ({
  memoryIndexModuleId: "../../extensions/memory-core/src/memory/index.js",
  memoryToolsRuntimeModuleId: "../../extensions/memory-core/src/tools.runtime.js",
}));

vi.mock(memoryIndexModuleId, () => ({
  getMemorySearchManager: getMemorySearchManagerMock,
}));

vi.mock("../../packages/memory-host-sdk/src/host/read-file.js", () => ({
  readAgentMemoryFile: readAgentMemoryFileMock,
}));

vi.mock(memoryToolsRuntimeModuleId, () => ({
  resolveMemoryBackendConfig: ({
    cfg,
  }: {
    cfg?: { memory?: { backend?: string; qmd?: unknown } };
  }) => ({
    backend,
    qmd: cfg?.memory?.qmd,
  }),
  getMemorySearchManager: getMemorySearchManagerMock,
  readAgentMemoryFile: readAgentMemoryFileMock,
}));

export function setMemoryBackend(next: MemoryBackend): void {
  backend = next;
}

export function setMemorySearchImpl(next: SearchImpl): void {
  searchImpl = next;
}

export function setMemoryReadFileImpl(
  next: (params: MemoryReadParams) => Promise<MemoryReadResult>,
): void {
  readFileImpl = next;
}

export function resetMemoryToolMockState(overrides?: {
  backend?: MemoryBackend;
  searchImpl?: SearchImpl;
  readFileImpl?: (params: MemoryReadParams) => Promise<MemoryReadResult>;
  canonicalStoreStatus?: CanonicalStorePayload | null;
}): void {
  backend = overrides?.backend ?? "builtin";
  searchImpl = overrides?.searchImpl ?? (async () => []);
  readFileImpl =
    overrides?.readFileImpl ??
    (async (params: MemoryReadParams) => ({ text: "", path: params.relPath }));
  canonicalStoreStatus =
    overrides?.canonicalStoreStatus ??
    ({
      state: "ready",
      path: "/workspace/.alisio/memory/profiles/local-main/canonical.sqlite",
      profileId: "local-main",
      profileSource: "local-profile",
      workspaceScope: "scope-main",
      workspaceDir: "/workspace",
      backend,
      entities: 1,
      relations: 0,
      projections: 1,
      projectionInterface: "markdown-vault",
      syncMode: "local-first",
      cloudSync: "unavailable",
      projectionSources: ["workspace-memory"],
      lastSyncedAt: "2026-04-08T10:00:00.000Z",
    } satisfies CanonicalStorePayload);
  vi.clearAllMocks();
}

export function setCanonicalStoreStatus(next: CanonicalStorePayload | null): void {
  canonicalStoreStatus = next;
}

export function getMemorySearchManagerMockCalls(): number {
  return getMemorySearchManagerMock.mock.calls.length;
}

export function getReadAgentMemoryFileMockCalls(): number {
  return readAgentMemoryFileMock.mock.calls.length;
}
