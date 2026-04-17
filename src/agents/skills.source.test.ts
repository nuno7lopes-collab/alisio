import { describe, expect, it } from "vitest";
import { normalizeRuntimeSkillSource } from "./skills/source.js";

describe("normalizeRuntimeSkillSource", () => {
  it("preserves canonical and unknown sources", () => {
    expect(normalizeRuntimeSkillSource("alisio-plugin")).toBe("alisio-plugin");
    expect(normalizeRuntimeSkillSource("agents-skills-project")).toBe("agents-skills-project");
    expect(normalizeRuntimeSkillSource("custom-source")).toBe("custom-source");
    expect(normalizeRuntimeSkillSource("  ")).toBe("unknown");
  });
});
