import { describe, expect, test } from "vitest";
import {
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
  normalizeGatewayClientId,
} from "./protocol/client-info.js";
import { validateConnectParams } from "./protocol/index.js";

function makeConnectParams(clientId: string) {
  return {
    minProtocol: 1,
    maxProtocol: 1,
    client: {
      id: clientId,
      version: "dev",
      platform: "macos",
      mode: GATEWAY_CLIENT_MODES.UI,
    },
    role: "operator",
    scopes: [],
    caps: ["tool-events"],
    commands: [],
    permissions: {},
  };
}

describe("connect params client id validation", () => {
  test("accepts the macOS client id as a valid canonical gateway client id", () => {
    const ok = validateConnectParams(makeConnectParams(GATEWAY_CLIENT_IDS.MACOS_APP));
    expect(ok).toBe(true);
    expect(validateConnectParams.errors ?? []).toHaveLength(0);
  });

  test("normalizes the macOS canonical client id unchanged", () => {
    const clientId = GATEWAY_CLIENT_IDS.MACOS_APP;
    const ok = validateConnectParams(makeConnectParams(clientId));
    expect(ok).toBe(true);
    expect(normalizeGatewayClientId(clientId)).toBe(GATEWAY_CLIENT_IDS.MACOS_APP);
  });

  test("rejects removed mobile-only client ids", () => {
    const ok = validateConnectParams(makeConnectParams("alisio-mobile"));
    expect(ok).toBe(false);
    expect(normalizeGatewayClientId("alisio-mobile")).toBeUndefined();
  });

  test("accepts the legacy Control UI client id and normalizes it", () => {
    const ok = validateConnectParams({
      ...makeConnectParams("alisio-control-ui"),
      client: {
        id: "alisio-control-ui",
        version: "dev",
        platform: "web",
        mode: GATEWAY_CLIENT_MODES.WEBCHAT,
      },
    });
    expect(ok).toBe(true);
    expect(normalizeGatewayClientId("alisio-control-ui")).toBe(GATEWAY_CLIENT_IDS.CONTROL_UI);
  });
});
