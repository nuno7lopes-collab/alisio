import { beforeEach, describe, expect, it, vi } from "vitest";

let page: Record<string, unknown> | null = null;
const primaryLocators = new Map<string, Record<string, unknown>>();
const semanticLocators = new Map<string, Record<string, unknown>>();

const forceDisconnectPlaywrightForTarget = vi.fn(async () => {});
const getPageForTargetId = vi.fn(async () => {
  if (!page) {
    throw new Error("test: page not set");
  }
  return page;
});
const ensurePageState = vi.fn(() => ({}));
const restoreRoleRefsForTarget = vi.fn(() => {});
const refLocator = vi.fn((_: unknown, ref: string) => {
  const locator = primaryLocators.get(ref);
  if (!locator) {
    throw new Error(`test: missing primary locator for ${ref}`);
  }
  return locator;
});
const semanticRefLocator = vi.fn((_: unknown, ref: string) => semanticLocators.get(ref) ?? null);

vi.mock("./pw-session.js", () => ({
  ensurePageState,
  forceDisconnectPlaywrightForTarget,
  getPageForTargetId,
  refLocator,
  restoreRoleRefsForTarget,
  semanticRefLocator,
}));

let fillFormViaPlaywright: typeof import("./pw-tools-core.interactions.js").fillFormViaPlaywright;
let clickViaPlaywright: typeof import("./pw-tools-core.interactions.js").clickViaPlaywright;
let typeViaPlaywright: typeof import("./pw-tools-core.interactions.js").typeViaPlaywright;

describe("pw-tools-core interactions ref recovery", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    primaryLocators.clear();
    semanticLocators.clear();
    page = {};
    refLocator.mockImplementation((_: unknown, ref: string) => {
      const locator = primaryLocators.get(ref);
      if (!locator) {
        throw new Error(`test: missing primary locator for ${ref}`);
      }
      return locator;
    });
    semanticRefLocator.mockImplementation(
      (_: unknown, ref: string) => semanticLocators.get(ref) ?? null,
    );
    ({ clickViaPlaywright, fillFormViaPlaywright, typeViaPlaywright } =
      await import("./pw-tools-core.interactions.js"));
  });

  it("falls back to semantic role resolution when an aria ref goes stale mid-form", async () => {
    const fillUser = vi.fn(async () => {});
    const fillPasswordPrimary = vi.fn(async () => {
      throw new Error('Timeout 2000ms exceeded. waiting for locator("aria-ref=e19")');
    });
    const fillPasswordSemantic = vi.fn(async () => {});

    primaryLocators.set("e15", { fill: fillUser });
    primaryLocators.set("e19", { fill: fillPasswordPrimary });
    semanticLocators.set("e19", { fill: fillPasswordSemantic });

    await fillFormViaPlaywright({
      cdpUrl: "http://127.0.0.1:9222",
      targetId: "tab-1",
      fields: [
        { ref: "e15", type: "text", value: "alice@example.com" },
        { ref: "e19", type: "text", value: "secret" },
      ],
    });

    expect(fillUser).toHaveBeenCalledOnce();
    expect(fillPasswordPrimary).toHaveBeenCalledOnce();
    expect(fillPasswordSemantic).toHaveBeenCalledOnce();
    expect(forceDisconnectPlaywrightForTarget).not.toHaveBeenCalled();
  });

  it("reconnects and retries once when the target detaches during a ref action", async () => {
    const detachedFill = vi.fn(async () => {
      throw new Error("Target page, context or browser has been closed");
    });
    const recoveredFill = vi.fn(async () => {});

    let callCount = 0;
    refLocator.mockImplementation(() => {
      callCount += 1;
      return callCount === 1
        ? ({ fill: detachedFill } as Record<string, unknown>)
        : ({ fill: recoveredFill } as Record<string, unknown>);
    });

    await typeViaPlaywright({
      cdpUrl: "http://127.0.0.1:9222",
      targetId: "tab-1",
      ref: "e1",
      text: "alice",
    });

    expect(detachedFill).toHaveBeenCalledOnce();
    expect(recoveredFill).toHaveBeenCalledOnce();
    expect(forceDisconnectPlaywrightForTarget).toHaveBeenCalledWith({
      cdpUrl: "http://127.0.0.1:9222",
      targetId: "tab-1",
      reason: "retry type aborted after detached target",
    });
  });

  it("disconnects Playwright when a ref action is aborted by the caller", async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    const never = new Promise<void>(() => {});
    const fill = vi.fn(() => {
      started();
      return never;
    });
    primaryLocators.set("e1", { fill });

    const ctrl = new AbortController();
    const pending = typeViaPlaywright({
      cdpUrl: "http://127.0.0.1:9222",
      targetId: "tab-1",
      ref: "e1",
      text: "alice",
      signal: ctrl.signal,
    });

    await startedPromise;
    ctrl.abort(new Error("aborted by test"));

    await expect(pending).rejects.toThrow("aborted by test");
    expect(forceDisconnectPlaywrightForTarget).toHaveBeenCalledWith({
      cdpUrl: "http://127.0.0.1:9222",
      targetId: "tab-1",
      reason: "type aborted",
    });
  });

  it("falls back to geometric clicks when the semantic ref is covered by an overlay", async () => {
    const scrollIntoViewIfNeeded = vi.fn(async () => {});
    const boundingBox = vi.fn(async () => ({ x: 10, y: 20, width: 40, height: 30 }));
    const click = vi.fn(async () => {
      throw new Error('Element "e1" is not interactable (hidden or covered).');
    });
    const mouseMove = vi.fn(async () => {});
    const mouseClick = vi.fn(async () => {});
    const keyboardDown = vi.fn(async () => {});
    const keyboardUp = vi.fn(async () => {});

    primaryLocators.set("e1", {
      click,
      scrollIntoViewIfNeeded,
      boundingBox,
    });
    page = {
      mouse: {
        move: mouseMove,
        click: mouseClick,
      },
      keyboard: {
        down: keyboardDown,
        up: keyboardUp,
      },
    };

    const executionPath = vi.fn();
    await clickViaPlaywright({
      cdpUrl: "http://127.0.0.1:9222",
      targetId: "tab-1",
      ref: "e1",
      modifiers: ["Shift"],
      onExecutionPath: executionPath,
    });

    expect(click).toHaveBeenCalledOnce();
    expect(scrollIntoViewIfNeeded).toHaveBeenCalledOnce();
    expect(mouseMove).toHaveBeenCalledWith(30, 35);
    expect(mouseClick).toHaveBeenCalledWith(30, 35, {
      button: undefined,
      clickCount: 1,
    });
    expect(keyboardDown).toHaveBeenCalledWith("Shift");
    expect(keyboardUp).toHaveBeenCalledWith("Shift");
    expect(executionPath).toHaveBeenCalledWith({
      layer: "geometric",
      recovered: true,
      recoveryCode: "overlay",
    });
  });
});
