import { describe, expect, it } from "vitest";
import { buildConnectorRows } from "./connector-state.ts";

describe("buildConnectorRows", () => {
  it("keeps ready connectors connectable when no authorization snapshot exists yet", () => {
    const rows = buildConnectorRows(
      [
        {
          id: "github",
          title: "GitHub",
          providerLabel: "GitHub",
          category: "development",
          connectLabel: "Connect with GitHub",
          summary: "Repositories and pull requests.",
          availability: "ready",
          scopes: ["repo"],
        },
      ],
      [],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.authorization.health).toBe("healthy");
    expect(rows[0]?.status).toBe("ready");
  });
});
