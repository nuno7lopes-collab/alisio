import { beforeEach, describe, expect, it } from "vitest";
import {
  resetMemoryToolMockState,
  setMemoryBackend,
} from "../../../test/helpers/memory-tool-manager-mock.js";
import {
  asAlisioConfig,
  createAutoCitationsMemorySearchTool,
  createMemorySearchToolOrThrow,
} from "./tools.test-helpers.js";

beforeEach(() => {
  resetMemoryToolMockState({ backend: "builtin" });
});

describe("memory search citations", () => {
  it("appends stable locator citations when citations are enabled", async () => {
    const cfg = asAlisioConfig({
      memory: { citations: "on", retrieval: { tracing: { enabled: false } } },
      agents: { list: [{ id: "main", default: true }] },
    });
    const tool = createMemorySearchToolOrThrow({ config: cfg });
    const result = await tool.execute("call_citations_on", { query: "Project Atlas" });
    const details = result.details as {
      results: Array<{ snippet: string; citation?: string }>;
    };

    expect(details.results[0]?.snippet).toMatch(/Source: memory:\/\/profiles\/local-main\//);
    expect(details.results[0]?.citation).toMatch(/^memory:\/\/profiles\/local-main\//);
  });

  it("leaves snippets untouched when citations are off", async () => {
    const cfg = asAlisioConfig({
      memory: { citations: "off", retrieval: { tracing: { enabled: false } } },
      agents: { list: [{ id: "main", default: true }] },
    });
    const tool = createMemorySearchToolOrThrow({ config: cfg });
    const result = await tool.execute("call_citations_off", { query: "Project Atlas" });
    const details = result.details as {
      results: Array<{ snippet: string; citation?: string }>;
    };

    expect(details.results[0]?.snippet).not.toMatch(/Source:/);
    expect(details.results[0]?.citation).toBeUndefined();
  });

  it("clamps decorated snippets to the qmd injected budget", async () => {
    setMemoryBackend("qmd");
    const cfg = asAlisioConfig({
      memory: {
        citations: "on",
        backend: "qmd",
        qmd: { limits: { maxInjectedChars: 80 } },
        retrieval: { tracing: { enabled: false } },
      },
      agents: { list: [{ id: "main", default: true }] },
    });
    const tool = createMemorySearchToolOrThrow({ config: cfg });
    const result = await tool.execute("call_citations_qmd", { query: "Project Atlas" });
    const details = result.details as {
      results: Array<{ snippet: string; citation?: string }>;
    };

    expect(details.results[0]?.snippet.length).toBeLessThanOrEqual(80);
  });

  it("honors auto mode for direct chats", async () => {
    const tool = createAutoCitationsMemorySearchTool("agent:main:discord:dm:u123");
    const result = await tool.execute("auto_mode_direct", { query: "Project Atlas" });
    const details = result.details as { results: Array<{ snippet: string }> };

    expect(details.results[0]?.snippet).toMatch(/Source:/);
  });

  it("suppresses citations for auto mode in group chats", async () => {
    const tool = createAutoCitationsMemorySearchTool("agent:main:discord:group:c123");
    const result = await tool.execute("auto_mode_group", { query: "Project Atlas" });
    const details = result.details as { results: Array<{ snippet: string }> };

    expect(details.results[0]?.snippet).not.toMatch(/Source:/);
  });
});
