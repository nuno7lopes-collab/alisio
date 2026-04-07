import { describe, expect, it, vi } from "vitest";
import { loadAgentFiles, type AgentFilesState } from "./agent-files.ts";

function createState(): { state: AgentFilesState; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn();
  const state: AgentFilesState = {
    client: { request } as unknown as AgentFilesState["client"],
    connected: true,
    agentFilesLoading: false,
    agentFilesError: null,
    agentFilesList: null,
    agentFileContents: {},
    agentFileDrafts: {},
    agentFileActive: "MEMORY.md",
    agentFileSaving: false,
  };
  return { state, request };
}

describe("agent-files controller", () => {
  it("keeps the legacy files panel focused on bootstrap files only", async () => {
    const { state, request } = createState();
    request.mockResolvedValue({
      agentId: "main",
      workspace: "/workspace/main",
      files: [
        {
          name: "AGENTS.md",
          path: "/workspace/main/AGENTS.md",
          missing: false,
          size: 10,
          updatedAtMs: 1,
        },
        {
          name: "MEMORY.md",
          path: "/workspace/main/MEMORY.md",
          missing: false,
          size: 10,
          updatedAtMs: 1,
        },
        {
          name: "memory.md",
          path: "/workspace/main/memory.md",
          missing: false,
          size: 10,
          updatedAtMs: 1,
        },
        {
          name: "memory/2026-04-06-trip-planning.md",
          path: "/workspace/main/memory/2026-04-06-trip-planning.md",
          missing: false,
          size: 10,
          updatedAtMs: 1,
        },
        {
          name: "obsidian/Alisio Memory/long-term.md",
          path: "/workspace/main/Alisio Memory/long-term.md",
          missing: false,
          size: 10,
          updatedAtMs: 1,
        },
      ],
    });

    await loadAgentFiles(state, "main");

    expect(state.agentFilesList?.files.map((file) => file.name)).toEqual(["AGENTS.md"]);
    expect(state.agentFileActive).toBeNull();
  });
});
