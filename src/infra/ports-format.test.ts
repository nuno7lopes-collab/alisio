import { describe, expect, it } from "vitest";
import {
  buildPortHints,
  classifyPortListener,
  formatPortDiagnostics,
  formatPortListener,
  isDualStackLoopbackGatewayListeners,
} from "./ports-format.js";

describe("ports-format", () => {
  it.each([
    [{ commandLine: "ssh -N -L 40705:127.0.0.1:40705 user@host" }, "ssh"],
    [{ command: "ssh" }, "ssh"],
    [{ commandLine: "node /Users/me/Projects/alisio/dist/entry.js gateway" }, "gateway"],
    [{ commandLine: "python -m http.server 40705" }, "unknown"],
  ] as const)("classifies port listener %j", (listener, expected) => {
    expect(classifyPortListener(listener, 40705)).toBe(expected);
  });

  it("builds ordered hints for mixed listener kinds and multiplicity", () => {
    expect(
      buildPortHints(
        [
          { commandLine: "node dist/index.js alisio gateway" },
          { commandLine: "ssh -N -L 40705:127.0.0.1:40705" },
          { commandLine: "python -m http.server 40705" },
        ],
        40705,
      ),
    ).toEqual([
      expect.stringContaining("Gateway already running locally."),
      "SSH tunnel already bound to this port. Close the tunnel or use a different local port in -L.",
      "Another process is listening on this port.",
      expect.stringContaining("Multiple listeners detected"),
    ]);
    expect(buildPortHints([], 40705)).toEqual([]);
  });

  it("treats single-process loopback dual-stack gateway listeners as benign", () => {
    const listeners = [
      { pid: 4242, commandLine: "alisio-gateway", address: "127.0.0.1:40705" },
      { pid: 4242, commandLine: "alisio-gateway", address: "[::1]:40705" },
    ];
    expect(isDualStackLoopbackGatewayListeners(listeners, 40705)).toBe(true);
    expect(buildPortHints(listeners, 40705)).toEqual([
      expect.stringContaining("Gateway already running locally."),
    ]);
  });

  it.each([
    [
      { pid: 123, user: "alice", commandLine: "ssh -N", address: "::1" },
      "pid 123 alice: ssh -N (::1)",
    ],
    [{ command: "ssh", address: "127.0.0.1:40705" }, "pid ?: ssh (127.0.0.1:40705)"],
    [{}, "pid ?: unknown"],
  ] as const)("formats port listener %j", (listener, expected) => {
    expect(formatPortListener(listener)).toBe(expected);
  });

  it("formats free and busy port diagnostics", () => {
    expect(
      formatPortDiagnostics({
        port: 40705,
        status: "free",
        listeners: [],
        hints: [],
      }),
    ).toEqual(["Port 40705 is free."]);

    const lines = formatPortDiagnostics({
      port: 40705,
      status: "busy",
      listeners: [{ pid: 123, user: "alice", commandLine: "ssh -N -L 40705:127.0.0.1:40705" }],
      hints: buildPortHints([{ pid: 123, commandLine: "ssh -N -L 40705:127.0.0.1:40705" }], 40705),
    });
    expect(lines[0]).toContain("Port 40705 is already in use");
    expect(lines).toContain("- pid 123 alice: ssh -N -L 40705:127.0.0.1:40705");
    expect(lines.some((line) => line.includes("SSH tunnel"))).toBe(true);
  });
});
