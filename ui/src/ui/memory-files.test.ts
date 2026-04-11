import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMemoryNoteName,
  humanizeMemoryNoteTitle,
  isLongTermMemoryFileName,
  isMemoryNoteFileName,
  todayMemoryDate,
} from "./memory-files.ts";

describe("memory-files", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the local calendar date for new notes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 6, 23, 59, 0));

    expect(todayMemoryDate()).toBe("2026-04-06");
  });

  it("builds dated note paths and avoids duplicates", () => {
    expect(
      buildMemoryNoteName("2026-04-06", "Trip planning", [
        "memory/2026-04-06-trip-planning.md",
        "memory/2026-04-06-trip-planning-2.md",
      ]),
    ).toBe("memory/2026-04-06-trip-planning-3.md");
  });

  it("humanizes dated note names for the UI", () => {
    expect(humanizeMemoryNoteTitle("memory/2026-04-06-trip-planning.md")).toBe("Trip Planning");
    expect(humanizeMemoryNoteTitle("memory/2026-04-06.md")).toBe("2026-04-06");
  });

  it("distinguishes durable memory files from note files", () => {
    expect(isLongTermMemoryFileName("MEMORY.md")).toBe(true);
    expect(isLongTermMemoryFileName("memory.md")).toBe(false);
    expect(isMemoryNoteFileName("memory/2026-04-06.md")).toBe(true);
    expect(isMemoryNoteFileName("AGENTS.md")).toBe(false);
  });
});
