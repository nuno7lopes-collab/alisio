import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectMarkerLineWithGateway, findExtraGatewayServices } from "./inspect.js";

const { execSchtasksMock } = vi.hoisted(() => ({
  execSchtasksMock: vi.fn(),
}));

vi.mock("./schtasks-exec.js", () => ({
  execSchtasks: (...args: unknown[]) => execSchtasksMock(...args),
}));

// Real content from the alisio-gateway.service unit file (the canonical gateway unit).
const GATEWAY_SERVICE_CONTENTS = `\
[Unit]
Description=Alisio Gateway (v2026.3.8)
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/node /home/alisio/.npm-global/lib/node_modules/alisio/dist/entry.js gateway run --port 40705
Restart=always
Environment=ALISIO_SERVICE_MARKER=alisio
Environment=ALISIO_SERVICE_KIND=gateway
Environment=ALISIO_SERVICE_VERSION=2026.3.8

[Install]
WantedBy=default.target
`;

const LEGACY_ALISIO_GATEWAY_CONTENTS = `\
[Unit]
Description=Alisio Gateway
After=network-online.target

[Service]
ExecStart=/usr/bin/node /home/alisio/.npm-global/lib/node_modules/alisio/dist/entry.js gateway run --port 40705
Environment=ALISIO_SERVICE_MARKER=alisio
Environment=ALISIO_SERVICE_KIND=gateway

[Install]
WantedBy=default.target
`;

// Real content from the alisio-test.service unit file (a non-gateway alisio service).
const TEST_SERVICE_CONTENTS = `\
[Unit]
Description=Alisio test service
After=default.target

[Service]
Type=simple
ExecStart=/bin/sh -c 'while true; do sleep 60; done'
Restart=on-failure

[Install]
WantedBy=default.target
`;

const CUSTOM_ALISIO_GATEWAY_CONTENTS = `\
[Unit]
Description=Custom Alisio Gateway
[Service]
ExecStart=/usr/bin/node /opt/alisio/dist/entry.js gateway run --port 40705
Environment=HOME=/home/alisio
`;

describe("detectMarkerLineWithGateway", () => {
  it("returns null for alisio-test.service (alisio only in description, no gateway on same line)", () => {
    expect(detectMarkerLineWithGateway(TEST_SERVICE_CONTENTS)).toBeNull();
  });

  it("returns alisio for the canonical gateway unit (ExecStart has both alisio and gateway)", () => {
    expect(detectMarkerLineWithGateway(GATEWAY_SERVICE_CONTENTS)).toBe("alisio");
  });

  it("returns alisio for a non-canonical alisio gateway unit", () => {
    expect(detectMarkerLineWithGateway(CUSTOM_ALISIO_GATEWAY_CONTENTS)).toBe("alisio");
  });

  it("handles line continuations — marker and gateway split across physical lines", () => {
    const contents = `[Service]\nExecStart=/usr/bin/node /opt/alisio/dist/entry.js \\\n  gateway run --port 40705\n`;
    expect(detectMarkerLineWithGateway(contents)).toBe("alisio");
  });
});

describe("findExtraGatewayServices (linux / scanSystemdDir) — real filesystem", () => {
  // These tests write real .service files to a temp dir and call findExtraGatewayServices
  // with that dir as HOME. No platform mocking or fs mocking needed.
  // Only runs on Linux/macOS where the linux branch of findExtraGatewayServices is active.
  const isLinux = process.platform === "linux";

  it.skipIf(!isLinux)("does not report alisio-test.service as a gateway service", async () => {
    const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-test-"));
    const systemdDir = path.join(tmpHome, ".config", "systemd", "user");
    try {
      await fs.mkdir(systemdDir, { recursive: true });
      await fs.writeFile(path.join(systemdDir, "alisio-test.service"), TEST_SERVICE_CONTENTS);
      const result = await findExtraGatewayServices({ HOME: tmpHome });
      expect(result).toEqual([]);
    } finally {
      await fs.rm(tmpHome, { recursive: true, force: true });
    }
  });

  it.skipIf(!isLinux)(
    "does not report the canonical alisio-gateway.service as an extra service",
    async () => {
      const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-test-"));
      const systemdDir = path.join(tmpHome, ".config", "systemd", "user");
      try {
        await fs.mkdir(systemdDir, { recursive: true });
        await fs.writeFile(
          path.join(systemdDir, "alisio-gateway.service"),
          GATEWAY_SERVICE_CONTENTS,
        );
        const result = await findExtraGatewayServices({ HOME: tmpHome });
        expect(result).toEqual([]);
      } finally {
        await fs.rm(tmpHome, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!isLinux)(
    "reports a legacy alisio-gateway service as an extra gateway service",
    async () => {
      const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-test-"));
      const systemdDir = path.join(tmpHome, ".config", "systemd", "user");
      const unitPath = path.join(systemdDir, "alisio-gateway.service");
      try {
        await fs.mkdir(systemdDir, { recursive: true });
        await fs.writeFile(unitPath, LEGACY_ALISIO_GATEWAY_CONTENTS);
        const result = await findExtraGatewayServices({ HOME: tmpHome });
        expect(result).toEqual([
          {
            platform: "linux",
            label: "alisio-gateway.service",
            detail: `unit: ${unitPath}`,
            scope: "user",
            marker: "alisio",
            legacy: true,
          },
        ]);
      } finally {
        await fs.rm(tmpHome, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(!isLinux)(
    "reports a custom alisio gateway service as an extra gateway service",
    async () => {
      const tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-test-"));
      const systemdDir = path.join(tmpHome, ".config", "systemd", "user");
      const unitPath = path.join(systemdDir, "custom-alisio-gateway.service");
      try {
        await fs.mkdir(systemdDir, { recursive: true });
        await fs.writeFile(unitPath, CUSTOM_ALISIO_GATEWAY_CONTENTS);
        const result = await findExtraGatewayServices({ HOME: tmpHome });
        expect(result).toEqual([
          {
            platform: "linux",
            label: "custom-alisio-gateway.service",
            detail: `unit: ${unitPath}`,
            scope: "user",
            marker: "alisio",
            legacy: false,
          },
        ]);
      } finally {
        await fs.rm(tmpHome, { recursive: true, force: true });
      }
    },
  );
});

describe("findExtraGatewayServices (win32)", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: "win32",
    });
    execSchtasksMock.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  });

  it("skips schtasks queries unless deep mode is enabled", async () => {
    const result = await findExtraGatewayServices({});
    expect(result).toEqual([]);
    expect(execSchtasksMock).not.toHaveBeenCalled();
  });

  it("returns empty results when schtasks query fails", async () => {
    execSchtasksMock.mockResolvedValueOnce({
      code: 1,
      stdout: "",
      stderr: "error",
    });

    const result = await findExtraGatewayServices({}, { deep: true });
    expect(result).toEqual([]);
  });

  it("collects non-canonical Windows gateway tasks from schtasks output", async () => {
    execSchtasksMock.mockResolvedValueOnce({
      code: 0,
      stdout: [
        "TaskName: Alisio Gateway",
        "Task To Run: C:\\Program Files\\Alisio\\alisio.exe gateway run",
        "",
        "TaskName: Custom Alisio Gateway",
        "Task To Run: C:\\Program Files\\Alisio\\alisio.exe gateway run --profile work",
        "",
        "TaskName: Other Task",
        "Task To Run: C:\\tools\\helper.exe",
        "",
      ].join("\n"),
      stderr: "",
    });

    const result = await findExtraGatewayServices({}, { deep: true });
    expect(result).toEqual([
      {
        platform: "win32",
        label: "Custom Alisio Gateway",
        detail:
          "task: Custom Alisio Gateway, run: C:\\Program Files\\Alisio\\alisio.exe gateway run --profile work",
        scope: "system",
        marker: "alisio",
        legacy: false,
      },
    ]);
  });
});
