import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceBootstrapFile } from "./workspace.js";

vi.mock("./workspace.js", () => ({
  loadWorkspaceBootstrapSnapshot: vi.fn(),
}));

function makeFile(name: string, content: string): WorkspaceBootstrapFile {
  return {
    name: name as WorkspaceBootstrapFile["name"],
    path: `/ws/${name}`,
    content,
    missing: false,
  };
}

function makeSnapshot(
  files: WorkspaceBootstrapFile[],
  fingerprint: string,
): Awaited<ReturnType<typeof import("./workspace.js").loadWorkspaceBootstrapSnapshot>> {
  return { files, fingerprint };
}

describe("getOrLoadBootstrapFiles", () => {
  const files = [makeFile("AGENTS.md", "# Agent"), makeFile("SOUL.md", "# Soul")];
  let clearAllBootstrapSnapshots: typeof import("./bootstrap-cache.js").clearAllBootstrapSnapshots;
  let getOrLoadBootstrapFiles: typeof import("./bootstrap-cache.js").getOrLoadBootstrapFiles;
  let workspaceModule: typeof import("./workspace.js");

  const mockLoad = () => vi.mocked(workspaceModule.loadWorkspaceBootstrapSnapshot);

  beforeEach(async () => {
    vi.resetModules();
    ({ clearAllBootstrapSnapshots, getOrLoadBootstrapFiles } =
      await import("./bootstrap-cache.js"));
    workspaceModule = await import("./workspace.js");
    clearAllBootstrapSnapshots();
    mockLoad().mockResolvedValue(makeSnapshot(files, "fp-1"));
  });

  afterEach(() => {
    clearAllBootstrapSnapshots();
    vi.clearAllMocks();
  });

  it("loads from disk on first call and caches", async () => {
    const result = await getOrLoadBootstrapFiles({
      workspaceDir: "/ws",
      sessionKey: "session-1",
    });

    expect(result).toBe(files);
    expect(mockLoad()).toHaveBeenCalledTimes(1);
  });

  it("returns the cached snapshot when the fingerprint is unchanged", async () => {
    const sameFingerprintFiles = [makeFile("AGENTS.md", "# Agent clone")];
    mockLoad()
      .mockResolvedValueOnce(makeSnapshot(files, "fp-stable"))
      .mockResolvedValueOnce(makeSnapshot(sameFingerprintFiles, "fp-stable"));

    const first = await getOrLoadBootstrapFiles({ workspaceDir: "/ws", sessionKey: "session-1" });
    const result = await getOrLoadBootstrapFiles({ workspaceDir: "/ws", sessionKey: "session-1" });

    expect(first).toBe(files);
    expect(result).toBe(files);
    expect(mockLoad()).toHaveBeenCalledTimes(2);
  });

  it("refreshes the cached snapshot when the fingerprint changes", async () => {
    const files2 = [makeFile("AGENTS.md", "# Agent v2")];
    mockLoad()
      .mockResolvedValueOnce(makeSnapshot(files, "fp-1"))
      .mockResolvedValueOnce(makeSnapshot(files2, "fp-2"));

    const first = await getOrLoadBootstrapFiles({ workspaceDir: "/ws", sessionKey: "session-1" });
    const second = await getOrLoadBootstrapFiles({ workspaceDir: "/ws", sessionKey: "session-1" });

    expect(first).toBe(files);
    expect(second).toBe(files2);
    expect(mockLoad()).toHaveBeenCalledTimes(2);
  });

  it("different session keys get independent caches", async () => {
    const files2 = [makeFile("AGENTS.md", "# Agent v2")];
    mockLoad()
      .mockResolvedValueOnce(makeSnapshot(files, "fp-1"))
      .mockResolvedValueOnce(makeSnapshot(files2, "fp-2"));

    const r1 = await getOrLoadBootstrapFiles({ workspaceDir: "/ws", sessionKey: "session-1" });
    const r2 = await getOrLoadBootstrapFiles({ workspaceDir: "/ws", sessionKey: "session-2" });

    expect(r1).toBe(files);
    expect(r2).toBe(files2);
    expect(mockLoad()).toHaveBeenCalledTimes(2);
  });
});

describe("clearBootstrapSnapshot", () => {
  let clearAllBootstrapSnapshots: typeof import("./bootstrap-cache.js").clearAllBootstrapSnapshots;
  let clearBootstrapSnapshot: typeof import("./bootstrap-cache.js").clearBootstrapSnapshot;
  let getOrLoadBootstrapFiles: typeof import("./bootstrap-cache.js").getOrLoadBootstrapFiles;
  let workspaceModule: typeof import("./workspace.js");

  const mockLoad = () => vi.mocked(workspaceModule.loadWorkspaceBootstrapSnapshot);

  beforeEach(async () => {
    vi.resetModules();
    ({ clearAllBootstrapSnapshots, clearBootstrapSnapshot, getOrLoadBootstrapFiles } =
      await import("./bootstrap-cache.js"));
    workspaceModule = await import("./workspace.js");
    clearAllBootstrapSnapshots();
    mockLoad().mockResolvedValue(makeSnapshot([makeFile("AGENTS.md", "content")], "fp-1"));
  });

  afterEach(() => {
    clearAllBootstrapSnapshots();
    vi.clearAllMocks();
  });

  it("clears a single session entry", async () => {
    await getOrLoadBootstrapFiles({ workspaceDir: "/ws", sessionKey: "sk" });
    clearBootstrapSnapshot("sk");

    // Next call should hit disk again.
    await getOrLoadBootstrapFiles({ workspaceDir: "/ws", sessionKey: "sk" });
    expect(mockLoad()).toHaveBeenCalledTimes(2);
  });

  it("does not affect other sessions", async () => {
    await getOrLoadBootstrapFiles({ workspaceDir: "/ws", sessionKey: "sk1" });
    await getOrLoadBootstrapFiles({ workspaceDir: "/ws", sessionKey: "sk2" });

    clearBootstrapSnapshot("sk1");

    // sk2 should still be cached.
    await getOrLoadBootstrapFiles({ workspaceDir: "/ws", sessionKey: "sk2" });
    expect(mockLoad()).toHaveBeenCalledTimes(3);
  });
});
