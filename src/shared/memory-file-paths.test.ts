import { describe, expect, it } from "vitest";
import {
  buildCanonicalMemoryNotePath,
  getLongTermMemoryFilePriority,
  isDailyMemoryNoteFileName,
  isLongTermMemoryFileName,
  isMemoryNoteFileName,
  normalizeMemoryNoteRole,
  resolveManualMemoryNoteRoot,
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

  it("prefers MEMORY.md ahead of note files", () => {
    expect(getLongTermMemoryFilePriority("MEMORY.md")).toBeLessThan(
      getLongTermMemoryFilePriority("memory/2026-04-07.md"),
    );
  });

  it("infers the manual memory directory from note files", () => {
    expect(resolveManualMemoryNoteRoot(["MEMORY.md", "memory/2026-04-07.md"])).toBe("memory");
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

  it("slugifies note path components safely", () => {
    expect(slugifyMemoryNotePathComponent("Física avançada")).toBe("fisica-avancada");
    expect(slugifyMemoryNotePathComponent("!!!", "fallback")).toBe("fallback");
  });
});
