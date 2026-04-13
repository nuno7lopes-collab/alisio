import { describe, expect, test } from "vitest";
import type { AlisioConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { buildGatewaySessionRow } from "./session-utils.js";

const baseCfg = {
  session: { mainKey: "main" },
  agents: { list: [{ id: "main", default: true }] },
} as AlisioConfig;

describe("buildGatewaySessionRow heartbeat display fallback", () => {
  test("ignores synthetic heartbeat placeholder origin labels", () => {
    const row = buildGatewaySessionRow({
      cfg: baseCfg,
      storePath: "/tmp/sessions.json",
      store: {},
      key: "agent:main:main",
      entry: {
        sessionId: "sess-main",
        updatedAt: Date.now(),
        origin: {
          label: "heartbeat",
          provider: "webchat",
          surface: "webchat",
          from: "heartbeat",
          to: "heartbeat",
        },
      } as SessionEntry,
    });

    expect(row.displayName).toBeUndefined();
  });

  test("keeps legitimate origin labels as the last visible fallback", () => {
    const row = buildGatewaySessionRow({
      cfg: baseCfg,
      storePath: "/tmp/sessions.json",
      store: {},
      key: "agent:main:main",
      entry: {
        sessionId: "sess-main",
        updatedAt: Date.now(),
        origin: {
          label: "Nuno",
          provider: "webchat",
          surface: "webchat",
          from: "nuno",
          to: "main",
        },
      } as SessionEntry,
    });

    expect(row.displayName).toBe("Nuno");
  });
});
