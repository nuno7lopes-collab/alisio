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
      platform: "ios",
      mode: GATEWAY_CLIENT_MODES.NODE,
    },
    role: "node",
    scopes: [],
    caps: ["canvas"],
    commands: ["system.notify"],
    permissions: {},
  };
}

describe("connect params client id validation", () => {
  test.each([GATEWAY_CLIENT_IDS.IOS_APP, GATEWAY_CLIENT_IDS.ANDROID_APP])(
    "accepts %s as a valid canonical gateway client id",
    (clientId) => {
      const ok = validateConnectParams(makeConnectParams(clientId));
      expect(ok).toBe(true);
      expect(validateConnectParams.errors ?? []).toHaveLength(0);
    },
  );

  test.each([
    ["openclaw-ios", GATEWAY_CLIENT_IDS.IOS_APP],
    ["openclaw-android", GATEWAY_CLIENT_IDS.ANDROID_APP],
  ])("accepts legacy %s during the rollout window", (legacyClientId, canonicalClientId) => {
    const ok = validateConnectParams(makeConnectParams(legacyClientId));
    expect(ok).toBe(true);
    expect(normalizeGatewayClientId(legacyClientId)).toBe(canonicalClientId);
  });

  test("rejects unknown client ids", () => {
    const ok = validateConnectParams(makeConnectParams("openclaw-mobile"));
    expect(ok).toBe(false);
  });
});
