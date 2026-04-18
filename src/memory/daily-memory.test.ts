import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildSessionMemoryBacklogNote, writeCanonicalBacklogMemoryNote } from "./daily-memory.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("session backlog memory helpers", () => {
  it("builds canonical backlog notes with explicit backlog metadata", () => {
    const note = buildSessionMemoryBacklogNote({
      nowMs: Date.UTC(2026, 3, 18, 10, 15, 0),
      slug: "physics-study",
      action: "new",
      sessionKey: "agent:main:main",
      sessionId: "session-123",
      source: "chat",
      sessionContent: "user: Quero estudar fisica\nassistant: Vamos mapear mecanica",
    });

    expect(note.relativePath).toBe("memory/backlog/2026-04-18/physics-study.md");
    expect(note.content).toContain("memoryRole: backlog");
    expect(note.content).toContain("backlogStatus: pending");
    expect(note.content).toContain("# Session new - Physics Study");
    expect(note.content).toContain("## Conversation Summary");
    expect(note.content).toContain("user: Quero estudar fisica");
  });

  it("writes unique backlog note paths when the same slug repeats", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-session-backlog-"));
    tempRoots.push(workspaceDir);
    const note = buildSessionMemoryBacklogNote({
      nowMs: Date.UTC(2026, 3, 18, 10, 15, 0),
      slug: "physics-study",
      action: "new",
      sessionKey: "agent:main:main",
      sessionId: "session-123",
      source: "chat",
      sessionContent: "assistant: Primeiro resumo",
    });

    const first = await writeCanonicalBacklogMemoryNote({
      workspaceDir,
      note,
    });
    const second = await writeCanonicalBacklogMemoryNote({
      workspaceDir,
      note,
    });

    expect(first.relativePath).toBe("memory/backlog/2026-04-18/physics-study.md");
    expect(second.relativePath).toBe("memory/backlog/2026-04-18/physics-study-2.md");
    const written = await fs.readFile(path.join(workspaceDir, second.relativePath), "utf8");
    expect(written).toContain("assistant: Primeiro resumo");
  });
});
