import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ensureAgentWorkspace } from "../agents/workspace.js";
import type { AlisioConfig } from "../config/config.js";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import {
  listPersonalContextDocuments,
  readPersonalContextDocument,
  readPersonalContextSummary,
  searchPersonalContextDocuments,
} from "./personal-context.js";

const getActiveMemorySearchManager = vi.hoisted(() => vi.fn());

vi.mock("../plugins/memory-runtime.js", () => ({
  getActiveMemorySearchManager,
}));

function createCfg(workspaceDir: string): AlisioConfig {
  return {
    session: { mainKey: "main" },
    agents: {
      defaults: {
        workspace: workspaceDir,
      },
      list: [{ id: "main", default: true, name: "Nuno" }],
    },
  };
}

describe("readPersonalContextSummary", () => {
  it("describes bootstrap, identity, main memory, operational memory, and session policy", async () => {
    const workspaceRoot = await makeTempWorkspace("alisio-personal-context-");
    const workspaceDir = path.join(workspaceRoot, "accounts", "user-1");
    const cfg = createCfg(workspaceRoot);
    await fs.mkdir(workspaceDir, { recursive: true });
    await ensureAgentWorkspace({ dir: workspaceDir, ensureBootstrapFiles: true });
    await writeWorkspaceFile({
      dir: workspaceDir,
      name: "IDENTITY.md",
      content: "# IDENTITY.md\n\n- **Name:** Maré\n- **Emoji:** 🦞\n",
    });
    await writeWorkspaceFile({
      dir: workspaceDir,
      name: "MEMORY.md",
      content: "# Memory\n\n- Prefers concise replies.\n",
    });
    await fs.mkdir(path.join(workspaceDir, "memory", "backlog", "2026-04-20"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "memory", "physics.md"),
      "# Physics\n\nStudy notes.\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "2026-04-20.md"),
      "# Daily\n\nWhat happened today.\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "backlog", "2026-04-20", "loop.md"),
      "# Loop\n\nOpen item.\n",
      "utf8",
    );

    const summary = await readPersonalContextSummary({
      cfg,
      agentId: "main",
      workspaceDir,
      mainKey: "main",
      accountId: "user-1",
    });

    expect(summary).toMatchObject({
      version: 1,
      accountScope: {
        scopeRoot: "account",
        accountId: "user-1",
        source: "account_id",
        authenticated: true,
        authRequired: true,
        workspaceMode: "account_scoped",
        workspaceRoot: "accounts/user-1",
      },
      deviceBinding: {
        binding: "account_bound",
        runtime: "local",
        current: true,
        accountId: "user-1",
      },
      runtimeContract: {
        scopeRoot: "account",
        backendShared: ["account", "auth", "linked_devices", "session_index", "automations"],
        localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"],
      },
      bootstrap: {
        path: "BOOTSTRAP.md",
        state: "completed",
        availability: "setup_only",
      },
      identity: {
        path: "IDENTITY.md",
        availability: "all_sessions",
        resolved: {
          name: "Maré",
        },
      },
      soul: {
        path: "SOUL.md",
        availability: "all_sessions",
      },
      preferences: {
        path: "USER.md",
        availability: "all_sessions",
      },
      memory: {
        main: {
          path: "MEMORY.md",
          present: true,
          availability: "private_direct_sessions",
        },
        operational: {
          root: "memory",
          backlogRoot: "memory/backlog",
          availability: "retrieval_only",
          topicCount: 1,
          dailyCount: 1,
          backlogCount: 1,
        },
      },
      documentCounts: {
        expectedCount: 11,
        presentCount: 11,
        agentFileCount: 3,
        identityFileCount: 3,
        setupFileCount: 1,
        memoryFileCount: 4,
        mainMemoryCount: 1,
        topicNoteCount: 1,
        dailyNoteCount: 1,
        backlogNoteCount: 1,
      },
      access: {
        accountScopeRequired: true,
        directRead: {
          method: "agents.files.get",
          locator: "workspace_relative_path",
          pathParam: "name",
          readableKinds: [
            "agent_instructions",
            "agent_tools",
            "agent_heartbeat",
            "setup_bootstrap",
            "identity",
            "soul",
            "preferences",
            "main_memory",
            "topic_note",
            "daily_note",
            "backlog_note",
          ],
        },
        indexedRead: {
          runtime: "memory_index",
          tool: "memory_get",
          readableKinds: ["main_memory", "topic_note", "daily_note", "backlog_note"],
        },
        search: {
          runtime: "memory_index",
          tool: "memory_search",
          readableKinds: ["main_memory", "topic_note", "daily_note", "backlog_note"],
        },
      },
      sessionPolicy: {
        main: {
          kind: "main",
          role: "default_personal_session",
          key: "agent:main:main",
          inherits: ["identity", "soul", "preferences", "main_memory"],
        },
        direct: {
          kind: "direct",
          role: "private_direct_session",
          inherits: ["identity", "soul", "preferences", "main_memory"],
        },
        group: {
          kind: "group",
          role: "shared_session",
          inherits: ["identity", "soul", "preferences"],
        },
      },
    });
    expect(summary.documents.map((document) => document.path)).toEqual([
      "AGENTS.md",
      "TOOLS.md",
      "HEARTBEAT.md",
      "BOOTSTRAP.md",
      "IDENTITY.md",
      "SOUL.md",
      "USER.md",
      "MEMORY.md",
      "memory/physics.md",
      "memory/2026-04-20.md",
      "memory/backlog/2026-04-20/loop.md",
    ]);
    expect(summary.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "identity",
          group: "identity",
          path: "IDENTITY.md",
          accountScoped: true,
          injected: true,
          indexed: false,
          sessionKinds: ["main", "direct", "group", "subagent", "cron"],
        }),
        expect.objectContaining({
          kind: "setup_bootstrap",
          group: "setup",
          path: "BOOTSTRAP.md",
          availability: "setup_only",
          sessionKinds: ["main", "direct"],
        }),
        expect.objectContaining({
          kind: "main_memory",
          path: "MEMORY.md",
          memoryRole: "main",
          indexed: true,
          injected: true,
          sessionKinds: ["main", "direct"],
        }),
        expect.objectContaining({
          kind: "topic_note",
          path: "memory/physics.md",
          memoryRole: "topic",
          availability: "retrieval_only",
          indexed: true,
          injected: false,
          deletable: true,
          sessionKinds: [],
        }),
        expect.objectContaining({
          kind: "daily_note",
          path: "memory/2026-04-20.md",
          memoryRole: "daily",
        }),
        expect.objectContaining({
          kind: "backlog_note",
          path: "memory/backlog/2026-04-20/loop.md",
          memoryRole: "backlog",
        }),
      ]),
    );

    getActiveMemorySearchManager.mockResolvedValueOnce({
      manager: {
        search: vi.fn(),
        readFile: vi.fn().mockResolvedValue({
          path: "memory/physics.md",
          text: "Indexed study notes.",
        }),
        status: vi.fn(),
        probeEmbeddingAvailability: vi.fn(),
        probeVectorAvailability: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      },
    });

    await expect(
      readPersonalContextDocument({
        cfg,
        agentId: "main",
        workspaceDir,
        accountId: "user-1",
        path: "memory/physics.md",
        from: 3,
        lines: 1,
      }),
    ).resolves.toMatchObject({
      document: expect.objectContaining({
        kind: "topic_note",
        path: "memory/physics.md",
      }),
      content: "Indexed study notes.",
      missing: false,
      fromLine: 3,
      toLine: 3,
    });

    getActiveMemorySearchManager.mockResolvedValueOnce({
      manager: {
        search: vi.fn().mockResolvedValue([
          {
            path: "memory/physics.md",
            startLine: 1,
            endLine: 1,
            score: 0.98,
            snippet: "# Physics",
            source: "memory",
          },
        ]),
        readFile: vi.fn(),
        status: vi.fn(),
        probeEmbeddingAvailability: vi.fn(),
        probeVectorAvailability: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      },
    });

    const searchResults = await searchPersonalContextDocuments({
      cfg,
      agentId: "main",
      workspaceDir,
      accountId: "user-1",
      query: "physics",
    });
    expect(searchResults[0]).toMatchObject({
      document: expect.objectContaining({
        kind: "topic_note",
        path: "memory/physics.md",
      }),
      excerpt: "# Physics",
      startLine: 1,
      endLine: 1,
    });
  });

  it("requires account scope before listing or summarizing personal context", async () => {
    const workspaceRoot = await makeTempWorkspace("alisio-personal-context-scope-");
    const workspaceDir = path.join(workspaceRoot, "accounts", "user-1");
    const cfg = createCfg(workspaceRoot);
    await fs.mkdir(workspaceDir, { recursive: true });

    await expect(
      listPersonalContextDocuments({
        workspaceDir,
        accountId: "",
      }),
    ).rejects.toThrow("personal context requires an authenticated accountId");

    await expect(
      readPersonalContextSummary({
        cfg,
        agentId: "main",
        workspaceDir,
        mainKey: "main",
        accountId: "",
      }),
    ).rejects.toThrow("personal context requires an authenticated accountId");

    await expect(
      listPersonalContextDocuments({
        workspaceDir,
        accountId: "user-2",
      }),
    ).rejects.toThrow("personal context workspace must be account-scoped for user-2");

    await expect(
      readPersonalContextSummary({
        cfg,
        agentId: "main",
        workspaceDir,
        mainKey: "main",
        accountId: "user-2",
      }),
    ).rejects.toThrow("personal context workspace must be account-scoped for user-2");
  });
});
