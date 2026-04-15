import { chromium } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as chromeModule from "./chrome.js";
import {
  closePlaywrightBrowserConnection,
  getPageForTargetId,
  listPagesViaPlaywright,
} from "./pw-session.js";

const connectOverCdpSpy = vi.spyOn(chromium, "connectOverCDP");
const getChromeWebSocketUrlSpy = vi.spyOn(chromeModule, "getChromeWebSocketUrl");

type BrowserMockBundle = {
  browser: import("playwright-core").Browser;
  browserClose: ReturnType<typeof vi.fn>;
};

function createPage(targetId: string, url: string) {
  let context: import("playwright-core").BrowserContext;
  const session = {
    send: vi.fn(async (method: string) =>
      method === "Target.getTargetInfo" ? { targetInfo: { targetId } } : {},
    ),
    detach: vi.fn(async () => {}),
  };
  const page = {
    on: vi.fn(),
    context: () => context,
    title: vi.fn(async () => `title:${targetId}`),
    url: vi.fn(() => url),
  } as unknown as import("playwright-core").Page;

  context = {
    pages: vi.fn(() => [page]),
    on: vi.fn(),
    newCDPSession: vi.fn(async () => session),
  } as unknown as import("playwright-core").BrowserContext;

  return { page, context };
}

function createBrowserWithPagesFactory(
  pagesFactory: () => import("playwright-core").Page[],
): BrowserMockBundle {
  const browserClose = vi.fn(async () => {});
  const context = {
    pages: vi.fn(() => pagesFactory()),
    on: vi.fn(),
  } as unknown as import("playwright-core").BrowserContext;
  const browser = {
    contexts: () => [context],
    on: vi.fn(),
    off: vi.fn(),
    close: browserClose,
  } as unknown as import("playwright-core").Browser;
  return { browser, browserClose };
}

afterEach(async () => {
  vi.useRealTimers();
  connectOverCdpSpy.mockReset();
  getChromeWebSocketUrlSpy.mockReset();
  await closePlaywrightBrowserConnection().catch(() => {});
});

describe("pw-session page recovery", () => {
  it("waits briefly for tabs to appear before failing", async () => {
    vi.useFakeTimers();
    const { page } = createPage("TARGET_A", "https://example.com");
    let calls = 0;
    const browser = createBrowserWithPagesFactory(() => {
      calls += 1;
      return calls >= 2 ? [page] : [];
    });

    connectOverCdpSpy.mockResolvedValue(browser.browser);
    getChromeWebSocketUrlSpy.mockResolvedValue(null);

    const pending = getPageForTargetId({
      cdpUrl: "http://127.0.0.1:9222",
      targetId: "TARGET_A",
    });

    await vi.advanceTimersByTimeAsync(60);
    await expect(pending).resolves.toBe(page);
    expect(connectOverCdpSpy).toHaveBeenCalledTimes(1);
  });

  it("reconnects once when a cached CDP attachment reports no tabs", async () => {
    vi.useFakeTimers();
    const emptyBrowser = createBrowserWithPagesFactory(() => []);
    const { page } = createPage("TARGET_B", "https://example.com/login");
    const recoveredBrowser = createBrowserWithPagesFactory(() => [page]);

    connectOverCdpSpy
      .mockResolvedValueOnce(emptyBrowser.browser)
      .mockResolvedValueOnce(recoveredBrowser.browser);
    getChromeWebSocketUrlSpy.mockResolvedValue(null);

    const pending = getPageForTargetId({
      cdpUrl: "http://127.0.0.1:9333",
      targetId: "TARGET_B",
    });

    await vi.advanceTimersByTimeAsync(800);
    await expect(pending).resolves.toBe(page);
    expect(connectOverCdpSpy).toHaveBeenCalledTimes(2);
    expect(emptyBrowser.browserClose).toHaveBeenCalledTimes(1);
  });

  it("recovers listPagesViaPlaywright after reconnecting an empty attachment", async () => {
    vi.useFakeTimers();
    const emptyBrowser = createBrowserWithPagesFactory(() => []);
    const { page } = createPage("TARGET_C", "https://example.com/dashboard");
    const recoveredBrowser = createBrowserWithPagesFactory(() => [page]);

    connectOverCdpSpy
      .mockResolvedValueOnce(emptyBrowser.browser)
      .mockResolvedValueOnce(recoveredBrowser.browser);
    getChromeWebSocketUrlSpy.mockResolvedValue(null);

    const pending = listPagesViaPlaywright({
      cdpUrl: "http://127.0.0.1:9444",
    });

    await vi.advanceTimersByTimeAsync(800);
    await expect(pending).resolves.toEqual([
      {
        targetId: "TARGET_C",
        title: "title:TARGET_C",
        url: "https://example.com/dashboard",
        type: "page",
      },
    ]);
    expect(connectOverCdpSpy).toHaveBeenCalledTimes(2);
  });
});
