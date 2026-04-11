import { describe, expect, it } from "vitest";
import { buildAlisioChromeLaunchArgs } from "./chrome.js";

describe("browser chrome launch args", () => {
  it("does not force an about:blank tab at startup", () => {
    const args = buildAlisioChromeLaunchArgs({
      resolved: {
        enabled: true,
        controlPort: 40707,
        cdpProtocol: "http",
        cdpHost: "127.0.0.1",
        cdpIsLoopback: true,
        cdpPortRangeStart: 40716,
        cdpPortRangeEnd: 40726,
        evaluateEnabled: false,
        remoteCdpTimeoutMs: 1500,
        remoteCdpHandshakeTimeoutMs: 3000,
        extraArgs: [],
        color: "#FF4500",
        headless: false,
        noSandbox: false,
        attachOnly: false,
        ssrfPolicy: { allowPrivateNetwork: true },
        defaultProfile: "alisio",
        profiles: {
          alisio: { cdpPort: 40716, color: "#FF4500" },
        },
      },
      profile: {
        name: "alisio",
        cdpUrl: "http://127.0.0.1:40716",
        cdpPort: 40716,
        cdpHost: "127.0.0.1",
        cdpIsLoopback: true,
        color: "#FF4500",
        driver: "alisio",
        attachOnly: false,
      },
      userDataDir: "/tmp/alisio-test-user-data",
    });

    expect(args).not.toContain("about:blank");
    expect(args).toContain("--remote-debugging-port=40716");
    expect(args).toContain("--user-data-dir=/tmp/alisio-test-user-data");
  });
});
