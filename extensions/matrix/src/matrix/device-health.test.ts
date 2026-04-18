import { describe, expect, it } from "vitest";
import { isAlisioManagedMatrixDevice, summarizeMatrixDeviceHealth } from "./device-health.js";

describe("matrix device health", () => {
  it("detects Alisio-managed device names", () => {
    expect(isAlisioManagedMatrixDevice("Alisio Gateway")).toBe(true);
    expect(isAlisioManagedMatrixDevice("Alisio Debug")).toBe(true);
    expect(isAlisioManagedMatrixDevice("Element Mac")).toBe(false);
    expect(isAlisioManagedMatrixDevice(null)).toBe(false);
  });

  it("summarizes stale Alisio-managed devices separately from the current device", () => {
    const summary = summarizeMatrixDeviceHealth([
      {
        deviceId: "du314Zpw3A",
        displayName: "Alisio Gateway",
        current: true,
      },
      {
        deviceId: "BritdXC6iL",
        displayName: "Alisio Gateway",
        current: false,
      },
      {
        deviceId: "G6NJU9cTgs",
        displayName: "Alisio Debug",
        current: false,
      },
      {
        deviceId: "phone123",
        displayName: "Element Mac",
        current: false,
      },
    ]);

    expect(summary.currentDeviceId).toBe("du314Zpw3A");
    expect(summary.currentAlisioDevices).toEqual([
      expect.objectContaining({ deviceId: "du314Zpw3A" }),
    ]);
    expect(summary.staleAlisioDevices).toEqual([
      expect.objectContaining({ deviceId: "BritdXC6iL" }),
      expect.objectContaining({ deviceId: "G6NJU9cTgs" }),
    ]);
  });
});
