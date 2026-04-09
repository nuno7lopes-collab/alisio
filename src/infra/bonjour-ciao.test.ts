import { describe, expect, it } from "vitest";

const { classifyCiaoUnhandledRejection, ignoreCiaoUnhandledRejection } =
  await import("./bonjour-ciao.js");

describe("bonjour-ciao", () => {
  it("classifies ciao cancellation rejections separately from side effects", () => {
    expect(classifyCiaoUnhandledRejection(new Error("CIAO PROBING CANCELLED"))).toEqual({
      kind: "cancellation",
      formatted: "CIAO PROBING CANCELLED",
    });
  });

  it("classifies ciao interface assertions separately from side effects", () => {
    expect(
      classifyCiaoUnhandledRejection(
        new Error("Reached illegal state! IPV4 address change from defined to undefined!"),
      ),
    ).toEqual({
      kind: "interface-assertion",
      formatted: "Reached illegal state! IPV4 address change from defined to undefined!",
    });
  });

  it("classifies ciao self-probe races separately from side effects", () => {
    expect(
      classifyCiaoUnhandledRejection(
        new Error(
          "Can't probe for a service which is announced already. Received announcing for service test._alisio-gw._tcp.local.",
        ),
      ),
    ).toEqual({
      kind: "self-probe-race",
      formatted:
        "Can't probe for a service which is announced already. Received announcing for service test._alisio-gw._tcp.local.",
    });
  });

  it("suppresses ciao announcement cancellation rejections", () => {
    expect(ignoreCiaoUnhandledRejection(new Error("Ciao announcement cancelled by shutdown"))).toBe(
      true,
    );
  });

  it("suppresses ciao probing cancellation rejections", () => {
    expect(ignoreCiaoUnhandledRejection(new Error("CIAO PROBING CANCELLED"))).toBe(true);
  });

  it("suppresses lower-case string cancellation reasons too", () => {
    expect(ignoreCiaoUnhandledRejection("ciao announcement cancelled during cleanup")).toBe(true);
  });

  it("suppresses ciao interface assertion rejections as non-fatal", () => {
    const error = Object.assign(
      new Error("Reached illegal state! IPV4 address change from defined to undefined!"),
      { name: "AssertionError" },
    );

    expect(ignoreCiaoUnhandledRejection(error)).toBe(true);
  });

  it("suppresses ciao self-probe races as non-fatal", () => {
    expect(
      ignoreCiaoUnhandledRejection(
        new Error(
          "Can't probe for a service which is announced already. Received announcing for service test._alisio-gw._tcp.local.",
        ),
      ),
    ).toBe(true);
  });

  it("keeps unrelated rejections visible", () => {
    expect(ignoreCiaoUnhandledRejection(new Error("boom"))).toBe(false);
  });
});
