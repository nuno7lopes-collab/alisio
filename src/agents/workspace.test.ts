import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  ensureAgentWorkspace,
  filterBootstrapFilesForSession,
  loadWorkspaceBootstrapFiles,
  readWorkspaceSetupSummary,
  resolveDefaultAgentWorkspaceDir,
  type WorkspaceBootstrapFile,
} from "./workspace.js";

const getMemoryEntries = (files: WorkspaceBootstrapFile[]) =>
  files.filter((file) => file.name === DEFAULT_MEMORY_FILENAME);

describe("resolveDefaultAgentWorkspaceDir", () => {
  it("uses ALISIO_HOME for default workspace resolution", () => {
    const dir = resolveDefaultAgentWorkspaceDir({
      ALISIO_HOME: "/srv/alisio-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv);

    expect(dir).toBe(path.join(path.resolve("/srv/alisio-home"), ".alisio", "workspace"));
  });

  it("uses ALISIO_STATE_DIR for default workspace resolution", () => {
    const dir = resolveDefaultAgentWorkspaceDir({
      ALISIO_STATE_DIR: "/srv/alisio-state",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv);

    expect(dir).toBe(path.join(path.resolve("/srv/alisio-state"), "workspace"));
  });
});

const WORKSPACE_STATE_PATH_SEGMENTS = [".alisio", "workspace-state.json"] as const;

async function readWorkspaceState(dir: string): Promise<{
  version: number;
  bootstrapSeededAt?: string;
  setupCompletedAt?: string;
}> {
  const raw = await fs.readFile(path.join(dir, ...WORKSPACE_STATE_PATH_SEGMENTS), "utf-8");
  return JSON.parse(raw) as {
    version: number;
    bootstrapSeededAt?: string;
    setupCompletedAt?: string;
  };
}

async function expectBootstrapSeeded(dir: string) {
  await expect(fs.access(path.join(dir, DEFAULT_BOOTSTRAP_FILENAME))).resolves.toBeUndefined();
  const state = await readWorkspaceState(dir);
  expect(state.bootstrapSeededAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
}

async function expectCompletedWithoutBootstrap(dir: string) {
  await expect(fs.access(path.join(dir, DEFAULT_IDENTITY_FILENAME))).resolves.toBeUndefined();
  await expect(fs.access(path.join(dir, DEFAULT_BOOTSTRAP_FILENAME))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const state = await readWorkspaceState(dir);
  expect(state.setupCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
}

function expectSubagentAllowedBootstrapNames(files: WorkspaceBootstrapFile[]) {
  const names = files.map((file) => file.name);
  expect(names).toContain("AGENTS.md");
  expect(names).toContain("TOOLS.md");
  expect(names).toContain("SOUL.md");
  expect(names).toContain("IDENTITY.md");
  expect(names).toContain("USER.md");
  expect(names).not.toContain("HEARTBEAT.md");
  expect(names).not.toContain("BOOTSTRAP.md");
  expect(names).not.toContain("MEMORY.md");
}

describe("ensureAgentWorkspace", () => {
  it("creates BOOTSTRAP.md and records a seeded marker for brand new workspaces", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectBootstrapSeeded(tempDir);
    expect((await readWorkspaceState(tempDir)).setupCompletedAt).toBeUndefined();
  });

  it("recovers partial initialization by creating BOOTSTRAP.md when marker is missing", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_AGENTS_FILENAME, content: "existing" });

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectBootstrapSeeded(tempDir);
  });

  it("does not recreate BOOTSTRAP.md after completion, even when a core file is recreated", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");
    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_IDENTITY_FILENAME, content: "custom" });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_USER_FILENAME, content: "custom" });
    await fs.unlink(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME));
    await fs.unlink(path.join(tempDir, DEFAULT_TOOLS_FILENAME));

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expect(fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.access(path.join(tempDir, DEFAULT_TOOLS_FILENAME))).resolves.toBeUndefined();
    const state = await readWorkspaceState(tempDir);
    expect(state.setupCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("marks stale bootstrap workspaces as completed once identity or memory exists", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");
    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_IDENTITY_FILENAME, content: "custom" });

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    const state = await readWorkspaceState(tempDir);
    expect(state.setupCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    await expect(
      fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME)),
    ).resolves.toBeUndefined();
  });

  it("does not re-seed BOOTSTRAP.md for legacy completed workspaces without state marker", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_IDENTITY_FILENAME, content: "custom" });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_USER_FILENAME, content: "custom" });

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expect(fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const state = await readWorkspaceState(tempDir);
    expect(state.bootstrapSeededAt).toBeUndefined();
    expect(state.setupCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("treats memory-backed workspaces as existing even when template files are missing", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");
    await fs.mkdir(path.join(tempDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "memory", "2026-02-25.md"), "# Daily log\nSome notes");
    await fs.writeFile(path.join(tempDir, "MEMORY.md"), "# Long-term memory\nImportant stuff");

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expect(fs.access(path.join(tempDir, DEFAULT_IDENTITY_FILENAME))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const state = await readWorkspaceState(tempDir);
    expect(state.setupCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    const memoryContent = await fs.readFile(path.join(tempDir, "MEMORY.md"), "utf-8");
    expect(memoryContent).toBe("# Long-term memory\nImportant stuff");
  });

  it("treats git-backed workspaces as existing even when template files are missing", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");
    await fs.mkdir(path.join(tempDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".git", "HEAD"), "ref: refs/heads/main\n");

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectCompletedWithoutBootstrap(tempDir);
  });

  it("ignores removed onboardingCompletedAt markers and seeds bootstrap flow instead", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");
    await fs.mkdir(path.join(tempDir, ".alisio"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, ...WORKSPACE_STATE_PATH_SEGMENTS),
      JSON.stringify({
        version: 1,
        onboardingCompletedAt: "2026-03-15T02:30:00.000Z",
      }),
    );

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectBootstrapSeeded(tempDir);
    await expect(
      fs.access(path.join(tempDir, ...WORKSPACE_STATE_PATH_SEGMENTS)),
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, ".alisio"))).resolves.toBeUndefined();
  });
});

describe("loadWorkspaceBootstrapFiles", () => {
  const expectSingleMemoryEntry = (
    files: Awaited<ReturnType<typeof loadWorkspaceBootstrapFiles>>,
    content: string,
  ) => {
    const memoryEntries = getMemoryEntries(files);
    expect(memoryEntries).toHaveLength(1);
    expect(memoryEntries[0]?.missing).toBe(false);
    expect(memoryEntries[0]?.content).toBe(content);
  };

  it("includes MEMORY.md when present", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: "MEMORY.md", content: "memory" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    expectSingleMemoryEntry(files, "memory");
  });

  it("omits memory entries when no memory files exist", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    expect(getMemoryEntries(files)).toHaveLength(0);
  });

  it("omits BOOTSTRAP.md from injected bootstrap files once setup is complete", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");
    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_IDENTITY_FILENAME, content: "custom" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);

    expect(files.map((file) => file.name)).not.toContain(DEFAULT_BOOTSTRAP_FILENAME);
    await expect(
      fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME)),
    ).resolves.toBeUndefined();
    const state = await readWorkspaceState(tempDir);
    expect(state.setupCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("treats hardlinked bootstrap aliases as missing", async () => {
    if (process.platform === "win32") {
      return;
    }
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-workspace-hardlink-"));
    try {
      const workspaceDir = path.join(rootDir, "workspace");
      const outsideDir = path.join(rootDir, "outside");
      await fs.mkdir(workspaceDir, { recursive: true });
      await fs.mkdir(outsideDir, { recursive: true });
      const outsideFile = path.join(outsideDir, DEFAULT_AGENTS_FILENAME);
      const linkPath = path.join(workspaceDir, DEFAULT_AGENTS_FILENAME);
      await fs.writeFile(outsideFile, "outside", "utf-8");
      try {
        await fs.link(outsideFile, linkPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EXDEV") {
          return;
        }
        throw err;
      }

      const files = await loadWorkspaceBootstrapFiles(workspaceDir);
      const agents = files.find((file) => file.name === DEFAULT_AGENTS_FILENAME);
      expect(agents?.missing).toBe(true);
      expect(agents?.content).toBeUndefined();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe("readWorkspaceSetupSummary", () => {
  it("reports pending setup for a freshly seeded bootstrap workspace", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");
    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expect(readWorkspaceSetupSummary(tempDir)).resolves.toMatchObject({
      state: "pending",
      bootstrapFilePresent: true,
    });
  });

  it("reports completed setup once durable signals exist", async () => {
    const tempDir = await makeTempWorkspace("alisio-workspace-");
    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_MEMORY_FILENAME, content: "seed" });

    await expect(readWorkspaceSetupSummary(tempDir)).resolves.toMatchObject({
      state: "completed",
      bootstrapFilePresent: true,
    });
  });
});

describe("filterBootstrapFilesForSession", () => {
  const mockFiles: WorkspaceBootstrapFile[] = [
    { name: "AGENTS.md", path: "/w/AGENTS.md", content: "", missing: false },
    { name: "SOUL.md", path: "/w/SOUL.md", content: "", missing: false },
    { name: "TOOLS.md", path: "/w/TOOLS.md", content: "", missing: false },
    { name: "IDENTITY.md", path: "/w/IDENTITY.md", content: "", missing: false },
    { name: "USER.md", path: "/w/USER.md", content: "", missing: false },
    { name: "HEARTBEAT.md", path: "/w/HEARTBEAT.md", content: "", missing: false },
    { name: "BOOTSTRAP.md", path: "/w/BOOTSTRAP.md", content: "", missing: false },
    { name: "MEMORY.md", path: "/w/MEMORY.md", content: "", missing: false },
  ];

  it("returns all files for main session (no sessionKey)", () => {
    const result = filterBootstrapFilesForSession(mockFiles);
    expect(result).toHaveLength(mockFiles.length);
  });

  it("returns all files for direct sessions", () => {
    const result = filterBootstrapFilesForSession(mockFiles, "agent:default:discord:direct:user-1");
    expect(result).toHaveLength(mockFiles.length);
  });

  it("keeps MEMORY.md for the canonical main session key", () => {
    const result = filterBootstrapFilesForSession(mockFiles, "agent:default:main");
    expect(result).toHaveLength(mockFiles.length);
  });

  it("omits MEMORY.md for shared channel sessions", () => {
    const result = filterBootstrapFilesForSession(
      mockFiles,
      "agent:default:discord:channel:chan-1",
    );
    expect(result).toHaveLength(mockFiles.length - 2);
    expect(getMemoryEntries(result)).toHaveLength(0);
    expect(result.map((file) => file.name)).not.toContain("BOOTSTRAP.md");
  });

  it("omits MEMORY.md for shared group sessions", () => {
    const result = filterBootstrapFilesForSession(mockFiles, "agent:default:slack:group:g-1");
    expect(result).toHaveLength(mockFiles.length - 2);
    expect(getMemoryEntries(result)).toHaveLength(0);
    expect(result.map((file) => file.name)).not.toContain("BOOTSTRAP.md");
  });

  it("filters to allowlist for subagent sessions", () => {
    const result = filterBootstrapFilesForSession(mockFiles, "agent:default:subagent:task-1");
    expectSubagentAllowedBootstrapNames(result);
  });

  it("filters to allowlist for cron sessions", () => {
    const result = filterBootstrapFilesForSession(mockFiles, "agent:default:cron:daily-check");
    expectSubagentAllowedBootstrapNames(result);
  });
});
