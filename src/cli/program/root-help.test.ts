import { describe, expect, it, vi } from "vitest";

vi.mock("./core-command-descriptors.js", () => ({
  getCoreCliCommandDescriptors: () => [
    {
      name: "status",
      description: "Show status",
      hasSubcommands: false,
    },
  ],
  getCoreCliCommandsWithSubcommands: () => [],
}));

vi.mock("./subcli-descriptors.js", () => ({
  getSubCliEntries: () => [
    {
      name: "config",
      description: "Manage config",
      hasSubcommands: true,
    },
  ],
  getSubCliCommandsWithSubcommands: () => ["config"],
}));

const { renderRootHelpText } = await import("./root-help.js");

describe("root help", () => {
  it("includes core and sub-CLI descriptors without loading plugin commands", async () => {
    const text = await renderRootHelpText();

    expect(text).toContain("status");
    expect(text).toContain("config");
    expect(text).not.toContain("matrix");
  });
});
