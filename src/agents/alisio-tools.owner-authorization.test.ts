import { describe, expect, it } from "vitest";
import "./test-helpers/fast-core-tools.js";
import { createAlisioTools } from "./alisio-tools.js";

function readToolByName() {
  return new Map(createAlisioTools().map((tool) => [tool.name, tool]));
}

describe("createAlisioTools owner authorization", () => {
  it("marks owner-only core tools in raw registration", () => {
    const tools = readToolByName();
    expect(tools.get("cron")?.ownerOnly).toBe(true);
    expect(tools.get("gmail_modify")?.ownerOnly).toBe(true);
    expect(tools.get("gmail_read")?.ownerOnly).toBe(true);
    expect(tools.get("gmail_send")?.ownerOnly).toBe(true);
    expect(tools.get("github")?.ownerOnly).toBe(true);
    expect(tools.get("google_calendar")?.ownerOnly).toBe(true);
    expect(tools.get("google_analytics")?.ownerOnly).toBe(true);
    expect(tools.get("google_docs")?.ownerOnly).toBe(true);
    expect(tools.get("google_drive")?.ownerOnly).toBe(true);
    expect(tools.get("google_forms")?.ownerOnly).toBe(true);
    expect(tools.get("google_sheets")?.ownerOnly).toBe(true);
    expect(tools.get("gateway")?.ownerOnly).toBe(true);
    expect(tools.get("nodes")?.ownerOnly).toBe(true);
    expect(tools.get("youtube")?.ownerOnly).toBe(true);
  });

  it("keeps canvas non-owner-only in raw registration", () => {
    const tools = readToolByName();
    expect(tools.get("canvas")).toBeDefined();
    expect(tools.get("canvas")?.ownerOnly).not.toBe(true);
  });
});
