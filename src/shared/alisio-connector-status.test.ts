import { describe, expect, it } from "vitest";
import {
  resolveAlisioConnectorSurfaceUiStatus,
  resolveAlisioConnectorUiStatus,
  summarizeAlisioConnectorSurfaceUiStatuses,
  summarizeAlisioConnectorUiStatuses,
} from "./alisio-connector-status.js";

describe("resolveAlisioConnectorUiStatus", () => {
  it("treats missing config as setup_required before any OAuth session exists", () => {
    expect(
      resolveAlisioConnectorUiStatus({
        definition: { availability: "ready" },
        authorization: {
          state: "not_connected",
          health: "config_missing",
        },
      }),
    ).toBe("setup_required");
  });

  it("prefers needs_reconnect over a stale connected authorization", () => {
    expect(
      resolveAlisioConnectorUiStatus({
        definition: { availability: "ready" },
        authorization: {
          state: "connected",
          health: "needs_reconnect",
        },
      }),
    ).toBe("needs_reconnect");
  });

  it("keeps ready connectors connectable when no authorization exists yet", () => {
    expect(
      resolveAlisioConnectorUiStatus({
        definition: { availability: "ready" },
      }),
    ).toBe("ready");
  });

  it("preserves review and unavailable catalog states without auth data", () => {
    expect(
      resolveAlisioConnectorUiStatus({
        definition: { availability: "in_review" },
      }),
    ).toBe("in_review");
    expect(
      resolveAlisioConnectorUiStatus({
        definition: { availability: "unavailable" },
      }),
    ).toBe("unavailable");
  });
});

describe("resolveAlisioConnectorSurfaceUiStatus", () => {
  it("downgrades catalog-ready connectors without runtime support to in_review", () => {
    expect(
      resolveAlisioConnectorSurfaceUiStatus({
        definition: { id: "acme-ready", availability: "ready" },
      }),
    ).toBe("in_review");
  });

  it("keeps runtime-backed connectors ready when they are truly usable", () => {
    expect(
      resolveAlisioConnectorSurfaceUiStatus({
        definition: { id: "google-calendar", availability: "ready" },
      }),
    ).toBe("ready");
    expect(
      resolveAlisioConnectorSurfaceUiStatus({
        definition: { id: "google-drive", availability: "ready" },
      }),
    ).toBe("ready");
  });

  it("keeps missing-config connectors in setup_required on user-facing surfaces", () => {
    expect(
      resolveAlisioConnectorSurfaceUiStatus({
        definition: { id: "github", availability: "ready" },
        authorization: {
          state: "not_connected",
          health: "config_missing",
        },
      }),
    ).toBe("setup_required");
  });
});

describe("summarizeAlisioConnectorUiStatuses", () => {
  it("counts reconnecting connectors from their real UI status", () => {
    expect(
      summarizeAlisioConnectorUiStatuses({
        definitions: [{ id: "gmail-send", availability: "ready" }],
        authorizations: [
          {
            connectorId: "gmail-send",
            state: "needs_reconnect",
            health: "needs_reconnect",
          },
        ],
      }),
    ).toMatchObject({
      total: 1,
      ready: 0,
      connected: 0,
      needsReconnect: 1,
      unavailable: 0,
      available: 1,
    });
  });

  it("keeps setup_required connectors out of the ready count", () => {
    expect(
      summarizeAlisioConnectorUiStatuses({
        definitions: [
          { id: "gmail-send", availability: "ready" },
          { id: "github", availability: "ready" },
          { id: "notion", availability: "in_review" },
          { id: "vercel", availability: "unavailable" },
        ],
        authorizations: [
          {
            connectorId: "gmail-send",
            state: "not_connected",
            health: "config_missing",
          },
        ],
      }),
    ).toMatchObject({
      total: 4,
      ready: 1,
      connected: 0,
      needsReconnect: 0,
      inReview: 1,
      unavailable: 1,
      available: 3,
    });
  });
});

describe("summarizeAlisioConnectorSurfaceUiStatuses", () => {
  it("counts runtime-unready ready connectors as in review instead of ready", () => {
    expect(
      summarizeAlisioConnectorSurfaceUiStatuses({
        definitions: [
          { id: "gmail-send", availability: "ready" },
          { id: "acme-ready", availability: "ready" },
        ],
        authorizations: [],
      }),
    ).toMatchObject({
      total: 2,
      ready: 1,
      connected: 0,
      needsReconnect: 0,
      inReview: 1,
      unavailable: 0,
      available: 2,
    });
  });

  it("counts missing-config connectors as setup_required on user-facing surfaces", () => {
    expect(
      summarizeAlisioConnectorSurfaceUiStatuses({
        definitions: [{ id: "github", availability: "ready" }],
        authorizations: [
          {
            connectorId: "github",
            state: "not_connected",
            health: "config_missing",
          },
        ],
      }),
    ).toMatchObject({
      total: 1,
      ready: 0,
      connected: 0,
      needsReconnect: 0,
      inReview: 0,
      unavailable: 0,
      available: 1,
    });
  });
});
