/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeReservedExternalPopup,
  navigateReservedExternalPopup,
  openExternalUrlSafe,
  openExternalTarget,
  reserveExternalPopup,
  resolveSafeExternalUrl,
} from "./open-external-url.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveSafeExternalUrl", () => {
  const baseHref = "https://\u006fpen\u0063law.ai/chat";

  it("allows absolute https URLs", () => {
    expect(resolveSafeExternalUrl("https://example.com/a.png?x=1#y", baseHref)).toBe(
      "https://example.com/a.png?x=1#y",
    );
  });

  it("allows relative URLs resolved against the current origin", () => {
    expect(resolveSafeExternalUrl("/assets/pic.png", baseHref)).toBe(
      "https://\u006fpen\u0063law.ai/assets/pic.png",
    );
  });

  it("allows blob URLs", () => {
    expect(resolveSafeExternalUrl("blob:https://\u006fpen\u0063law.ai/abc-123", baseHref)).toBe(
      "blob:https://\u006fpen\u0063law.ai/abc-123",
    );
  });

  it("allows data image URLs when enabled", () => {
    expect(
      resolveSafeExternalUrl("data:image/png;base64,iVBORw0KGgo=", baseHref, {
        allowDataImage: true,
      }),
    ).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("rejects non-image data URLs", () => {
    expect(
      resolveSafeExternalUrl("data:text/html,<script>alert(1)</script>", baseHref, {
        allowDataImage: true,
      }),
    ).toBeNull();
  });

  it("rejects SVG data image URLs", () => {
    expect(
      resolveSafeExternalUrl(
        "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' />",
        baseHref,
        {
          allowDataImage: true,
        },
      ),
    ).toBeNull();
  });

  it("rejects base64-encoded SVG data image URLs", () => {
    expect(
      resolveSafeExternalUrl(
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIC8+",
        baseHref,
        {
          allowDataImage: true,
        },
      ),
    ).toBeNull();
  });

  it("rejects data image URLs unless explicitly enabled", () => {
    expect(resolveSafeExternalUrl("data:image/png;base64,iVBORw0KGgo=", baseHref)).toBeNull();
  });

  it("rejects javascript URLs", () => {
    expect(resolveSafeExternalUrl("javascript:alert(1)", baseHref)).toBeNull();
  });

  it("rejects file URLs", () => {
    expect(resolveSafeExternalUrl("file:///tmp/x.png", baseHref)).toBeNull();
  });

  it("rejects empty values", () => {
    expect(resolveSafeExternalUrl("   ", baseHref)).toBeNull();
  });
});

describe("openExternalUrlSafe", () => {
  it("nulls opener when window.open returns a proxy-like object", () => {
    const openedLikeProxy = {
      opener: { postMessage: () => void 0 },
    } as unknown as WindowProxy;
    const openMock = vi
      .spyOn(window, "open")
      .mockImplementation(() => openedLikeProxy as unknown as Window);

    const opened = openExternalUrlSafe("https://example.com/safe.png", {
      baseHref: "https://\u006fpen\u0063law.ai/chat",
    });

    expect(openMock).toHaveBeenCalledWith(
      "https://example.com/safe.png",
      "_blank",
      "noopener,noreferrer",
    );
    expect(opened).toBe(openedLikeProxy);
    expect(openedLikeProxy.opener).toBeNull();
  });
});

describe("reserveExternalPopup", () => {
  it("opens a blank popup synchronously and nulls opener", () => {
    const write = vi.fn();
    const close = vi.fn();
    const openedLikeProxy = {
      opener: { postMessage: () => void 0 },
      document: { write, close },
    } as unknown as WindowProxy;
    const openMock = vi
      .spyOn(window, "open")
      .mockImplementation(() => openedLikeProxy as unknown as Window);

    const opened = reserveExternalPopup();

    expect(openMock).toHaveBeenCalledWith("about:blank", "_blank", "popup,width=520,height=720");
    expect(opened).toBe(openedLikeProxy);
    expect(openedLikeProxy.opener).toBeNull();
    expect(write).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("navigateReservedExternalPopup", () => {
  it("navigates an existing popup to a validated URL", () => {
    const replace = vi.fn();
    const popup = {
      location: { replace },
    } as unknown as WindowProxy;

    expect(
      navigateReservedExternalPopup(popup, "https://example.com/oauth?client_id=abc", {
        baseHref: "https://\u006fpen\u0063law.ai/chat",
      }),
    ).toBe(true);
    expect(replace).toHaveBeenCalledWith("https://example.com/oauth?client_id=abc");
  });

  it("refuses to navigate blocked or invalid targets", () => {
    const replace = vi.fn();
    const popup = {
      location: { replace },
    } as unknown as WindowProxy;

    expect(
      navigateReservedExternalPopup(popup, "javascript:alert(1)", {
        baseHref: "https://\u006fpen\u0063law.ai/chat",
      }),
    ).toBe(false);
    expect(navigateReservedExternalPopup(null, "https://example.com/oauth")).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("closeReservedExternalPopup", () => {
  it("closes a reserved popup safely", () => {
    const close = vi.fn();
    closeReservedExternalPopup({ close } as unknown as WindowProxy);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("openExternalTarget", () => {
  it("falls back to a new tab when the host bridge fails", async () => {
    const openViaHost = vi.fn(async () => {
      throw new Error("bridge failed");
    });
    const windowOpenMock = vi.spyOn(window, "open").mockImplementation(() => ({}) as Window);

    const result = await openExternalTarget("https://example.com/oauth", {
      baseHref: "https://alisio.ai/chat",
      openViaHost,
      preferNewTab: true,
    });

    expect(result).toBe("new-tab");
    expect(openViaHost).toHaveBeenCalledWith("https://example.com/oauth");
    expect(windowOpenMock).toHaveBeenCalledWith(
      "https://example.com/oauth",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("falls back to same-tab navigation when neither host nor new tab launch works", async () => {
    const openViaHost = vi.fn(async () => {
      throw new Error("bridge failed");
    });
    const locationAssign = vi.fn();
    const originalOpen = window.open;
    vi.spyOn(window, "open").mockReturnValue(null);
    vi.stubGlobal("window", {
      location: {
        href: "https://alisio.ai/chat",
        assign: locationAssign,
      },
      open: originalOpen,
    });

    const result = await openExternalTarget("https://example.com/oauth", {
      openViaHost,
      preferNewTab: true,
    });

    expect(result).toBe("same-tab");
    expect(locationAssign).toHaveBeenCalledWith("https://example.com/oauth");
  });
});
