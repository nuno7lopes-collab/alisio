import { describe, expect, it } from "vitest";
import {
  countAlisioLimitedConnectorSlots,
  gateAlisioConnectorConnection,
  gateAlisioOrganizationMembership,
} from "./alisio-plan-gating.js";

describe("alisio-plan-gating", () => {
  it("counts connector slots that should stay within the plan limit", () => {
    expect(
      countAlisioLimitedConnectorSlots([
        { state: "connected" },
        { state: "needs_reconnect" },
        { state: "not_connected" },
      ]),
    ).toBe(2);
  });

  it("allows new connector connections on Free and Plus", () => {
    expect(
      gateAlisioConnectorConnection({
        plan: "free",
        connectedCount: 0,
      }),
    ).toEqual({ ok: true });
    expect(
      gateAlisioConnectorConnection({
        plan: "free",
        connectedCount: 1,
      }),
    ).toEqual({ ok: true });
    expect(
      gateAlisioConnectorConnection({
        plan: "free",
        connectedCount: 1,
        connectorAlreadyConnected: true,
      }),
    ).toEqual({ ok: true });
    expect(
      gateAlisioConnectorConnection({
        plan: "free",
        connectedCount: 8,
      }),
    ).toEqual({ ok: true });
    expect(
      gateAlisioConnectorConnection({
        plan: "plus",
        connectedCount: 8,
      }),
    ).toEqual({ ok: true });
  });

  it("allows organizations on both Free and Plus while keeping personal mode valid", () => {
    expect(gateAlisioOrganizationMembership({ plan: "free", mode: "none" })).toEqual({
      ok: true,
    });
    expect(
      gateAlisioOrganizationMembership({
        plan: "free",
        mode: "owner",
      }),
    ).toEqual({ ok: true });
    expect(
      gateAlisioOrganizationMembership({
        plan: "plus",
        mode: "member",
      }),
    ).toEqual({ ok: true });
  });
});
