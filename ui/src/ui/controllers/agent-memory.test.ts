import { describe, expect, it, vi } from "vitest";
import { GatewayRequestError } from "../gateway.ts";
import {
  deleteAgentMemoryFile,
  loadAgentMemoryFiles,
  saveAgentMemoryFile,
  type AgentMemoryState,
} from "./agent-memory.ts";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createState(): { state: AgentMemoryState; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn();
  const state: AgentMemoryState = {
    client: { request } as unknown as AgentMemoryState["client"],
    connected: true,
    memorySelectedAgentId: null,
    memoryAgentId: null,
    memoryLoading: false,
    memoryError: null,
    memoryList: null,
    memoryContents: {},
    memoryDrafts: {},
    memoryActive: null,
    memorySaving: false,
    memoryDeleting: false,
  };
  return { state, request };
}

describe("agent-memory controller", () => {
  it("loads memory files through the dedicated memory scope and opens the main file", async () => {
    const { state, request } = createState();
    request
      .mockResolvedValueOnce({
        agentId: "main",
        workspace: "/workspace/main",
        files: [
          {
            name: "MEMORY.md",
            path: "/workspace/main/MEMORY.md",
            missing: false,
            size: 12,
            updatedAtMs: 10,
          },
          {
            name: "memory/2026-04-06.md",
            path: "/workspace/main/memory/2026-04-06.md",
            missing: false,
            size: 8,
            updatedAtMs: 20,
          },
        ],
      })
      .mockResolvedValueOnce({
        agentId: "main",
        workspace: "/workspace/main",
        file: {
          name: "MEMORY.md",
          path: "/workspace/main/MEMORY.md",
          missing: false,
          size: 12,
          updatedAtMs: 10,
          content: "# Main memory",
        },
      });

    await loadAgentMemoryFiles(state, "main");

    expect(request).toHaveBeenNthCalledWith(1, "agents.files.list", {
      agentId: "main",
      scope: "memory",
    });
    expect(request).toHaveBeenNthCalledWith(2, "agents.files.get", {
      agentId: "main",
      name: "MEMORY.md",
    });
    expect(state.memorySelectedAgentId).toBe("main");
    expect(state.memoryActive).toBe("MEMORY.md");
    expect(state.memoryDrafts["MEMORY.md"]).toBe("# Main memory");
  });

  it("falls back to the legacy file list when memory scope is not supported yet", async () => {
    const { state, request } = createState();
    state.memoryAgentId = "main";
    state.memoryList = {
      agentId: "main",
      workspace: "/workspace/main",
      files: [
        {
          name: "MEMORY.md",
          path: "/workspace/main/MEMORY.md",
          missing: false,
          size: 12,
          updatedAtMs: 10,
        },
        {
          name: "memory/2026-04-06.md",
          path: "/workspace/main/memory/2026-04-06.md",
          missing: false,
          size: 8,
          updatedAtMs: 20,
        },
      ],
    };
    request
      .mockRejectedValueOnce(
        new GatewayRequestError({
          code: "INVALID_REQUEST",
          message: "invalid agents.files.list params: at root: unexpected property 'scope'",
        }),
      )
      .mockResolvedValueOnce({
        agentId: "main",
        workspace: "/workspace/main",
        files: [
          {
            name: "AGENTS.md",
            path: "/workspace/main/AGENTS.md",
            missing: false,
            size: 4,
            updatedAtMs: 2,
          },
          {
            name: "MEMORY.md",
            path: "/workspace/main/MEMORY.md",
            missing: false,
            size: 12,
            updatedAtMs: 10,
          },
        ],
      })
      .mockResolvedValueOnce({
        agentId: "main",
        workspace: "/workspace/main",
        file: {
          name: "MEMORY.md",
          path: "/workspace/main/MEMORY.md",
          missing: false,
          size: 12,
          updatedAtMs: 10,
          content: "# Main memory",
        },
      });

    await loadAgentMemoryFiles(state, "main");

    expect(request).toHaveBeenNthCalledWith(1, "agents.files.list", {
      agentId: "main",
      scope: "memory",
    });
    expect(request).toHaveBeenNthCalledWith(2, "agents.files.list", {
      agentId: "main",
    });
    expect(state.memoryError).toBeNull();
    expect(state.memoryList?.files.map((file) => file.name)).toEqual([
      "MEMORY.md",
      "memory/2026-04-06.md",
    ]);
  });

  it("keeps memory notes sorted by freshness after saving", async () => {
    const { state, request } = createState();
    state.memoryList = {
      agentId: "main",
      workspace: "/workspace/main",
      files: [
        {
          name: "MEMORY.md",
          path: "/workspace/main/MEMORY.md",
          missing: false,
          size: 12,
          updatedAtMs: 10,
        },
        {
          name: "memory/2026-04-05.md",
          path: "/workspace/main/memory/2026-04-05.md",
          missing: false,
          size: 8,
          updatedAtMs: 30,
        },
        {
          name: "memory/2026-04-04.md",
          path: "/workspace/main/memory/2026-04-04.md",
          missing: false,
          size: 8,
          updatedAtMs: 20,
        },
      ],
    };
    request.mockResolvedValue({
      ok: true,
      agentId: "main",
      workspace: "/workspace/main",
      file: {
        name: "memory/2026-04-04.md",
        path: "/workspace/main/memory/2026-04-04.md",
        missing: false,
        size: 9,
        updatedAtMs: 50,
        content: "# Updated",
      },
    });

    await saveAgentMemoryFile(state, "main", "memory/2026-04-04.md", "# Updated");

    expect(state.memoryList?.files.map((file) => file.name)).toEqual([
      "MEMORY.md",
      "memory/2026-04-04.md",
      "memory/2026-04-05.md",
    ]);
  });

  it("prefers obsidian long-term memory when it is present", async () => {
    const { state, request } = createState();
    request
      .mockResolvedValueOnce({
        agentId: "main",
        workspace: "/workspace/main",
        files: [
          {
            name: "MEMORY.md",
            path: "/workspace/main/MEMORY.md",
            missing: false,
            size: 12,
            updatedAtMs: 10,
          },
          {
            name: "obsidian/Alisio Memory/long-term.md",
            path: "/workspace/main/Alisio Memory/long-term.md",
            missing: false,
            size: 18,
            updatedAtMs: 20,
          },
        ],
      })
      .mockResolvedValueOnce({
        agentId: "main",
        workspace: "/workspace/main",
        file: {
          name: "obsidian/Alisio Memory/long-term.md",
          path: "/workspace/main/Alisio Memory/long-term.md",
          missing: false,
          size: 18,
          updatedAtMs: 20,
          content: "# Obsidian memory",
        },
      });

    await loadAgentMemoryFiles(state, "main");

    expect(state.memoryActive).toBe("obsidian/Alisio Memory/long-term.md");
    expect(state.memoryDrafts["obsidian/Alisio Memory/long-term.md"]).toBe("# Obsidian memory");
  });

  it("uses the delete endpoint and clears active note state", async () => {
    const { state, request } = createState();
    state.memorySelectedAgentId = "main";
    state.memoryList = {
      agentId: "main",
      workspace: "/workspace/main",
      files: [
        {
          name: "memory/2026-04-06.md",
          path: "/workspace/main/memory/2026-04-06.md",
          missing: false,
          size: 10,
          updatedAtMs: 1,
        },
      ],
    };
    state.memoryActive = "memory/2026-04-06.md";
    state.memoryContents = { "memory/2026-04-06.md": "# Note" };
    state.memoryDrafts = { "memory/2026-04-06.md": "# Note" };
    request.mockResolvedValue({
      ok: true,
      agentId: "main",
      workspace: "/workspace/main",
      name: "memory/2026-04-06.md",
      deleted: true,
    });

    await deleteAgentMemoryFile(state, "main", "memory/2026-04-06.md");

    expect(request).toHaveBeenCalledWith("agents.files.delete", {
      agentId: "main",
      name: "memory/2026-04-06.md",
    });
    expect(state.memoryActive).toBeNull();
    expect(state.memoryContents["memory/2026-04-06.md"]).toBeUndefined();
    expect(state.memoryDrafts["memory/2026-04-06.md"]).toBeUndefined();
    expect(state.memoryList?.files).toEqual([]);
  });

  it("ignores stale list responses after switching to another agent", async () => {
    const mainList = deferred<unknown>();
    const { state, request } = createState();

    request.mockImplementation((method: string, params: { agentId: string; name?: string }) => {
      if (method === "agents.files.list" && params.agentId === "main") {
        return mainList.promise;
      }
      if (method === "agents.files.list" && params.agentId === "other") {
        return Promise.resolve({
          agentId: "other",
          workspace: "/workspace/other",
          files: [
            {
              name: "MEMORY.md",
              path: "/workspace/other/MEMORY.md",
              missing: false,
              size: 12,
              updatedAtMs: 20,
            },
          ],
        });
      }
      if (method === "agents.files.get" && params.agentId === "other") {
        return Promise.resolve({
          agentId: "other",
          workspace: "/workspace/other",
          file: {
            name: "MEMORY.md",
            path: "/workspace/other/MEMORY.md",
            missing: false,
            size: 12,
            updatedAtMs: 20,
            content: "# Other memory",
          },
        });
      }
      if (method === "agents.files.get" && params.agentId === "main") {
        return Promise.resolve({
          agentId: "main",
          workspace: "/workspace/main",
          file: {
            name: "MEMORY.md",
            path: "/workspace/main/MEMORY.md",
            missing: false,
            size: 12,
            updatedAtMs: 10,
            content: "# Main memory",
          },
        });
      }
      throw new Error(`unexpected request: ${method} ${params.agentId}`);
    });

    const firstLoad = loadAgentMemoryFiles(state, "main");
    const secondLoad = loadAgentMemoryFiles(state, "other");

    mainList.resolve({
      agentId: "main",
      workspace: "/workspace/main",
      files: [
        {
          name: "MEMORY.md",
          path: "/workspace/main/MEMORY.md",
          missing: false,
          size: 12,
          updatedAtMs: 10,
        },
      ],
    });

    await Promise.all([firstLoad, secondLoad]);

    expect(state.memorySelectedAgentId).toBe("other");
    expect(state.memoryAgentId).toBe("other");
    expect(state.memoryList?.agentId).toBe("other");
    expect(state.memoryActive).toBe("MEMORY.md");
    expect(state.memoryDrafts["MEMORY.md"]).toBe("# Other memory");
  });
});
