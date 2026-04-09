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

  it("enforces the Free connector limit for new connections only", () => {
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
    ).toMatchObject({
      ok: false,
      code: "connector_limit_reached",
    });
    expect(
      gateAlisioConnectorConnection({
        plan: "free",
        connectedCount: 1,
        connectorAlreadyConnected: true,
      }),
    ).toEqual({ ok: true });
    expect(
      gateAlisioConnectorConnection({
        plan: "plus",
        connectedCount: 8,
      }),
    ).toEqual({ ok: true });
  });

  it("keeps organizations behind Plus while allowing personal mode", () => {
    expect(gateAlisioOrganizationMembership({ plan: "free", mode: "none" })).toEqual({
      ok: true,
    });
    expect(
      gateAlisioOrganizationMembership({
        plan: "free",
        mode: "owner",
      }),
    ).toMatchObject({
      ok: false,
      code: "organizations_plus_required",
    });
    expect(
      gateAlisioOrganizationMembership({
        plan: "plus",
        mode: "member",
      }),
    ).toEqual({ ok: true });
  });
});
