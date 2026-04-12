import { describe, expect, it } from "vitest";
import { normalizeRuntimeSkillSource } from "./skills/source.js";

describe("normalizeRuntimeSkillSource", () => {
  it("normalizes legacy aliases and preserves canonical or unknown sources", () => {
    expect(normalizeRuntimeSkillSource("alisio-plugin")).toBe("alisio-plugin");
    expect(normalizeRuntimeSkillSource("openclaw-plugin")).toBe("alisio-plugin");
    expect(normalizeRuntimeSkillSource("openclaw-managed")).toBe("alisio-managed");
    expect(normalizeRuntimeSkillSource("agents-skills-project")).toBe("agents-skills-project");
    expect(normalizeRuntimeSkillSource("custom-source")).toBe("custom-source");
    expect(normalizeRuntimeSkillSource("  ")).toBe("unknown");
  });
});
