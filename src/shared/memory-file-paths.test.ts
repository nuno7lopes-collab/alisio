import { describe, expect, it } from "vitest";
import {
  CANONICAL_INDEXED_MEMORY_FILE_KINDS,
  CANONICAL_NON_INDEXED_MEMORY_FILE_KINDS,
  CANONICAL_ROOT_MEMORY_FILE_NAMES,
  buildCanonicalMemoryNotePath,
  compareCanonicalMemoryFileOrder,
  getCanonicalMemoryFileAvailability,
  getCanonicalMemoryFileGroup,
  getCanonicalMemoryFileSessionKinds,
  getCanonicalMemoryFileSortRank,
  isCanonicalMemoryFileName,
  isCanonicalIndexedMemoryKind,
  isCanonicalOperationalMemoryKind,
  isDailyMemoryNoteFileName,
  isLongTermMemoryFileName,
  isMemoryNoteFileName,
  listCanonicalRootMemoryFileNames,
  normalizeMemoryNoteRole,
  resolveCanonicalMemoryFileKind,
  resolveCanonicalMemoryFileMemoryRole,
  resolveMemoryNoteRole,
  slugifyMemoryNotePathComponent,
} from "./memory-file-paths.js";

describe("memory-file-paths", () => {
  it("classifies MEMORY.md as the long-term file", () => {
    expect(isLongTermMemoryFileName("MEMORY.md")).toBe(true);
    expect(isMemoryNoteFileName("memory/2026-04-08.md")).toBe(true);
    expect(isMemoryNoteFileName("MEMORY.md")).toBe(false);
    expect(isDailyMemoryNoteFileName("memory/2026-04-08.md")).toBe(true);
    expect(isDailyMemoryNoteFileName("memory/backlog/2026-04-08/topic.md")).toBe(false);
  });

  it("exposes one canonical root-file catalog with session-aware filtering", () => {
    expect(CANONICAL_ROOT_MEMORY_FILE_NAMES).toEqual([
      "AGENTS.md",
      "TOOLS.md",
      "HEARTBEAT.md",
      "BOOTSTRAP.md",
      "IDENTITY.md",
      "SOUL.md",
      "USER.md",
      "MEMORY.md",
    ]);
    expect(listCanonicalRootMemoryFileNames({ sessionKind: "group" })).toEqual([
      "AGENTS.md",
      "TOOLS.md",
      "HEARTBEAT.md",
      "IDENTITY.md",
      "SOUL.md",
      "USER.md",
    ]);
    expect(listCanonicalRootMemoryFileNames({ sessionKind: "subagent" })).toEqual([
      "AGENTS.md",
      "TOOLS.md",
      "IDENTITY.md",
      "SOUL.md",
      "USER.md",
    ]);
  });

  it("normalizes canonical memory note roles", () => {
    expect(normalizeMemoryNoteRole("main")).toBe("main");
    expect(normalizeMemoryNoteRole("BACKLOG")).toBe("backlog");
    expect(normalizeMemoryNoteRole("invalid")).toBeNull();
  });

  it("builds canonical note paths by role", () => {
    expect(buildCanonicalMemoryNotePath({ role: "main", title: "Memory" })).toBe("MEMORY.md");
    expect(buildCanonicalMemoryNotePath({ role: "topic", title: "Project Atlas" })).toBe(
      "memory/project-atlas.md",
    );
    expect(
      buildCanonicalMemoryNotePath({
        role: "daily",
        title: "ignored",
        dateStamp: "2026-04-18",
      }),
    ).toBe("memory/2026-04-18.md");
    expect(
      buildCanonicalMemoryNotePath({
        role: "backlog",
        title: "Physics Study",
        dateStamp: "2026-04-18",
      }),
    ).toBe("memory/backlog/2026-04-18/physics-study.md");
  });

  it("resolves note roles from explicit metadata, paths, and taxonomy", () => {
    expect(resolveMemoryNoteRole({ path: "MEMORY.md" })).toBe("main");
    expect(resolveMemoryNoteRole({ path: "memory/2026-04-18.md" })).toBe("daily");
    expect(resolveMemoryNoteRole({ path: "memory/backlog/2026-04-18/physics-study.md" })).toBe(
      "backlog",
    );
    expect(resolveMemoryNoteRole({ path: "memory/project-atlas.md" })).toBe("topic");
    expect(resolveMemoryNoteRole({ path: "memory/project-atlas.md", memoryRole: "backlog" })).toBe(
      "backlog",
    );
    expect(resolveMemoryNoteRole({ path: "memory/random.md", tags: ["daily"] })).toBe("daily");
  });

  it("classifies canonical personal memory files with closed kinds", () => {
    expect(resolveCanonicalMemoryFileKind("AGENTS.md")).toBe("agent_instructions");
    expect(resolveCanonicalMemoryFileKind("TOOLS.md")).toBe("agent_tools");
    expect(resolveCanonicalMemoryFileKind("HEARTBEAT.md")).toBe("agent_heartbeat");
    expect(resolveCanonicalMemoryFileKind("BOOTSTRAP.md")).toBe("setup_bootstrap");
    expect(resolveCanonicalMemoryFileKind("IDENTITY.md")).toBe("identity");
    expect(resolveCanonicalMemoryFileKind("SOUL.md")).toBe("soul");
    expect(resolveCanonicalMemoryFileKind("USER.md")).toBe("preferences");
    expect(resolveCanonicalMemoryFileKind("MEMORY.md")).toBe("main_memory");
    expect(resolveCanonicalMemoryFileKind("memory/2026-04-18.md")).toBe("daily_note");
    expect(resolveCanonicalMemoryFileKind("memory/project-atlas.md")).toBe("topic_note");
    expect(resolveCanonicalMemoryFileKind("memory/backlog/2026-04-18/loop.md")).toBe(
      "backlog_note",
    );
    expect(resolveCanonicalMemoryFileKind("notes/project.md")).toBeNull();
    expect(isCanonicalMemoryFileName("memory/project-atlas.md")).toBe(true);
    expect(isCanonicalIndexedMemoryKind("main_memory")).toBe(true);
    expect(isCanonicalOperationalMemoryKind("topic_note")).toBe(true);
    expect(isCanonicalOperationalMemoryKind("main_memory")).toBe(false);
    expect(getCanonicalMemoryFileAvailability("main_memory")).toBe("private_direct_sessions");
    expect(getCanonicalMemoryFileGroup("identity")).toBe("identity");
    expect(getCanonicalMemoryFileSessionKinds("main_memory")).toEqual(["main", "direct"]);
    expect(resolveCanonicalMemoryFileMemoryRole("backlog_note")).toBe("backlog");
    expect(CANONICAL_INDEXED_MEMORY_FILE_KINDS).toEqual([
      "main_memory",
      "topic_note",
      "daily_note",
      "backlog_note",
    ]);
    expect(CANONICAL_NON_INDEXED_MEMORY_FILE_KINDS).toEqual([
      "agent_instructions",
      "agent_tools",
      "agent_heartbeat",
      "setup_bootstrap",
      "identity",
      "soul",
      "preferences",
    ]);
    expect(getCanonicalMemoryFileSortRank("main_memory")).toBeLessThan(
      getCanonicalMemoryFileSortRank("topic_note"),
    );
  });

  it("orders canonical files by kind first and recency second", () => {
    expect(
      compareCanonicalMemoryFileOrder(
        { path: "memory/2026-04-18.md", updatedAtMs: 50 },
        { path: "memory/project-atlas.md", updatedAtMs: 100 },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareCanonicalMemoryFileOrder(
        { path: "memory/project-atlas.md", updatedAtMs: 10 },
        { path: "memory/project-beta.md", updatedAtMs: 100 },
      ),
    ).toBeGreaterThan(0);
    expect(
      compareCanonicalMemoryFileOrder(
        { path: "MEMORY.md", updatedAtMs: 0 },
        { path: "memory/project-atlas.md", updatedAtMs: 1_000 },
      ),
    ).toBeLessThan(0);
  });

  it("slugifies note path components safely", () => {
    expect(slugifyMemoryNotePathComponent("Física avançada")).toBe("fisica-avancada");
    expect(slugifyMemoryNotePathComponent("!!!", "fallback")).toBe("fallback");
  });
});
