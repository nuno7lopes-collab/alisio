import { describe, expect, it } from "vitest";
import {
  getLongTermMemoryFilePriority,
  isLongTermMemoryFileName,
  isMemoryNoteFileName,
  resolveManualMemoryNoteRoot,
} from "./memory-file-paths.js";

describe("memory-file-paths", () => {
  it("classifies obsidian long-term and daily files", () => {
    expect(isLongTermMemoryFileName("obsidian/Alisio Memory/long-term.md")).toBe(true);
    expect(isMemoryNoteFileName("obsidian/Alisio Memory/daily/2026-04-08.md")).toBe(true);
    expect(isMemoryNoteFileName("obsidian/Alisio Memory/long-term.md")).toBe(false);
  });

  it("prefers obsidian long-term files ahead of legacy long-term files", () => {
    expect(getLongTermMemoryFilePriority("obsidian/Alisio Memory/long-term.md")).toBeLessThan(
      getLongTermMemoryFilePriority("MEMORY.md"),
    );
  });

  it("infers the obsidian daily directory from an obsidian memory list", () => {
    expect(
      resolveManualMemoryNoteRoot([
        "MEMORY.md",
        "obsidian/Alisio Memory/long-term.md",
        "memory/2026-04-07.md",
      ]),
    ).toBe("obsidian/Alisio Memory/daily");
  });
});
