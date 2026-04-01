import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  evaluatePersonSubagentGuard,
  evaluatePersonToolCallGuard,
  resolveActivePersonAgentConfig,
  resolvePersonWorkspaceSummary,
} from "./person-agent.js";

function createCfg(): OpenClawConfig {
  return {
    agents: {
      defaults: {
        userTimezone: "Europe/Lisbon",
      },
      list: [
        {
          id: "main",
          default: true,
          name: "Nuno",
          person: {
            enabled: true,
          },
        },
      ],
    },
  };
}

describe("person-agent", () => {
  it("builds an active runtime profile from person config", () => {
    const cfg = createCfg();
    const person = resolveActivePersonAgentConfig({
      cfg,
      agentId: "main",
      agent: cfg.agents!.list![0],
    });

    expect(person).toMatchObject({
      status: "active",
      scope: "personal_and_work",
      autonomyMode: "draft-first",
      starterPack: "browser-first",
      profile: {
        name: "Nuno",
        timezone: "Europe/Lisbon",
      },
    });
  });

  it("builds a suggested workspace summary for the default agent even before activation", () => {
    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "main", default: true, name: "Nuno" }],
      },
    };

    const summary = resolvePersonWorkspaceSummary({
      cfg,
      agentId: "main",
      defaultAgentId: "main",
      agent: cfg.agents!.list![0],
    });

    expect(summary).toMatchObject({
      status: "suggested",
      profile: {
        name: "Nuno",
      },
      connectedAccounts: {
        status: "missing",
        totalProfiles: 0,
      },
    });
  });

  it("blocks mutating draft-first tool calls", () => {
    const cfg = createCfg();
    const person = resolveActivePersonAgentConfig({
      cfg,
      agentId: "main",
      agent: cfg.agents!.list![0],
    });

    expect(
      evaluatePersonToolCallGuard({
        person,
        toolName: "exec",
        toolParams: { cmd: "rm -rf /tmp/nope" },
      }),
    ).toMatchObject({ block: true });
    expect(
      evaluatePersonToolCallGuard({
        person,
        toolName: "browser",
        toolParams: {
          action: "act",
          request: { kind: "fill", fields: [{ ref: "email", value: "test@example.com" }] },
        },
      }),
    ).toMatchObject({ block: true });
    expect(
      evaluatePersonToolCallGuard({
        person,
        toolName: "subagents",
        toolParams: { action: "kill", target: "all" },
      }),
    ).toMatchObject({ block: true });
    expect(
      evaluatePersonToolCallGuard({
        person,
        toolName: "web_search",
        toolParams: { q: "latest mcp tools" },
      }),
    ).toBeNull();
  });

  it("allows only configured specialists for delegated spawns", () => {
    const cfg = createCfg();
    const person = resolveActivePersonAgentConfig({
      cfg,
      agentId: "main",
      agent: cfg.agents!.list![0],
    });

    expect(
      evaluatePersonSubagentGuard({
        person,
        requesterAgentId: "main",
        targetAgentId: "research-specialist",
      }),
    ).toBeNull();
    expect(
      evaluatePersonSubagentGuard({
        person,
        requesterAgentId: "main",
        targetAgentId: "finance-specialist",
      }),
    ).toMatchObject({ block: true });
  });
});
