import { describe, expect, it } from "vitest";
import { buildPlatformRuntimeLogHints, buildPlatformServiceStartHints } from "./runtime-hints.js";

describe("buildPlatformRuntimeLogHints", () => {
  it("renders launchd log hints on darwin", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        env: {
          ALISIO_STATE_DIR: "/tmp/alisio-state",
          ALISIO_LOG_PREFIX: "gateway",
        },
        systemdServiceName: "alisio-gateway",
        windowsTaskName: "Alisio Gateway",
      }),
    ).toEqual([
      "Launchd stdout (if installed): /tmp/alisio-state/logs/gateway.log",
      "Launchd stderr (if installed): /tmp/alisio-state/logs/gateway.err.log",
    ]);
  });

  it("renders systemd and windows hints by platform", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "linux",
        systemdServiceName: "alisio-gateway",
        windowsTaskName: "Alisio Gateway",
      }),
    ).toEqual(["Logs: journalctl --user -u alisio-gateway.service -n 200 --no-pager"]);
    expect(
      buildPlatformRuntimeLogHints({
        platform: "win32",
        systemdServiceName: "alisio-gateway",
        windowsTaskName: "Alisio Gateway",
      }),
    ).toEqual(['Logs: schtasks /Query /TN "Alisio Gateway" /V /FO LIST']);
  });
});

describe("buildPlatformServiceStartHints", () => {
  it("builds platform-specific service start hints", () => {
    expect(
      buildPlatformServiceStartHints({
        platform: "darwin",
        installCommand: "alisio gateway install",
        startCommand: "alisio gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.alisio.gateway.plist",
        systemdServiceName: "alisio-gateway",
        windowsTaskName: "Alisio Gateway",
      }),
    ).toEqual([
      "alisio gateway install",
      "alisio gateway",
      "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.alisio.gateway.plist",
    ]);
    expect(
      buildPlatformServiceStartHints({
        platform: "linux",
        installCommand: "alisio gateway install",
        startCommand: "alisio gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.alisio.gateway.plist",
        systemdServiceName: "alisio-gateway",
        windowsTaskName: "Alisio Gateway",
      }),
    ).toEqual([
      "alisio gateway install",
      "alisio gateway",
      "systemctl --user start alisio-gateway.service",
    ]);
  });
});
