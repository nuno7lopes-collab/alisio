import { describe, expect, it } from "vitest";
import {
  getLongTermMemoryFilePriority,
  isLongTermMemoryFileName,
  isMemoryNoteFileName,
  resolveManualMemoryNoteRoot,
} from "./memory-file-paths.js";

describe("memory-file-paths", () => {
  it("classifies MEMORY.md as the long-term file", () => {
    expect(isLongTermMemoryFileName("MEMORY.md")).toBe(true);
    expect(isMemoryNoteFileName("memory/2026-04-08.md")).toBe(true);
    expect(isMemoryNoteFileName("MEMORY.md")).toBe(false);
  });

  it("prefers MEMORY.md ahead of note files", () => {
    expect(getLongTermMemoryFilePriority("MEMORY.md")).toBeLessThan(
      getLongTermMemoryFilePriority("memory/2026-04-07.md"),
    );
  });

  it("infers the manual memory directory from note files", () => {
    expect(resolveManualMemoryNoteRoot(["MEMORY.md", "memory/2026-04-07.md"])).toBe("memory");
  });
});
