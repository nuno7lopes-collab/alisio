import { describe, expect, it } from "vitest";
import type { ComputerSessionState } from "../types.ts";
import {
  deriveBrowserPaneBrowserStateFromMessages,
  getBrowserPaneAvailableSurfaces,
  hasBrowserPaneBrowserActivity,
  hasBrowserPaneToolOutputActivity,
  resolveBrowserPaneSurface,
} from "./browser-pane.ts";

const COMPUTER_SESSION_STUB = {} as ComputerSessionState;

describe("browser pane helpers", () => {
  it("ignores empty browser and tool-output payloads", () => {
    expect(
      hasBrowserPaneBrowserActivity({
        title: "   ",
        subtitle: "",
        url: "",
        screenshotUrl: null,
        status: " ",
      }),
    ).toBe(false);
    expect(
      hasBrowserPaneToolOutputActivity({
        content: null,
        error: null,
      }),
    ).toBe(false);
  });

  it("returns only surfaces with real activity", () => {
    expect(
      getBrowserPaneAvailableSurfaces({
        browser: {
          title: "Browser sandbox",
          url: "https://docs.alisio.ai",
        },
        computer: COMPUTER_SESSION_STUB,
        toolOutput: {
          content: "result",
          error: null,
        },
      }),
    ).toEqual(["tool_output", "preview", "computer"]);
  });

  it("does not create ghost browser or tool-output surfaces", () => {
    expect(
      getBrowserPaneAvailableSurfaces({
        browser: {
          title: "",
          subtitle: " ",
          url: "",
          screenshotUrl: "",
          status: "",
        },
        toolOutput: {
          content: null,
          error: "",
        },
      }),
    ).toEqual([]);
  });

  it("falls back to the first active surface when the preferred one is unavailable", () => {
    expect(
      resolveBrowserPaneSurface({
        preferredSurface: "tool_output",
        browser: {
          title: "Browser sandbox",
          url: "https://docs.alisio.ai",
        },
        toolOutput: {
          content: null,
          error: null,
        },
      }),
    ).toEqual({
      kind: "preview",
      preview: {
        title: "Browser sandbox",
        url: "https://docs.alisio.ai",
      },
    });
  });

  it("derives browser pane state from browser tool history", () => {
    expect(
      deriveBrowserPaneBrowserStateFromMessages([
        {
          role: "assistant",
          toolName: "browser",
          toolPhase: "result",
          content: [
            { type: "toolcall", name: "browser", arguments: { action: "open" } },
            {
              type: "toolresult",
              name: "browser",
              text: '{"ok":true}',
              details: {
                ok: true,
                url: "https://grokopedia.com",
              },
            },
          ],
        },
      ]),
    ).toEqual({
      url: "https://grokopedia.com",
      status: "ready",
    });
  });

  it("keeps browser errors visible when the latest browser tool failed", () => {
    expect(
      deriveBrowserPaneBrowserStateFromMessages([
        {
          role: "assistant",
          toolName: "browser",
          toolPhase: "result",
          toolError: true,
          content: [
            { type: "toolcall", name: "browser", arguments: { action: "open" } },
            {
              type: "toolresult",
              name: "browser",
              text: "Privacy error: invalid certificate on target site",
              details: {
                message: "Privacy error: invalid certificate on target site",
                url: "https://grokopedia.com",
              },
            },
          ],
        },
      ]),
    ).toEqual({
      subtitle: "Privacy error: invalid certificate on target site",
      url: "https://grokopedia.com",
      status: "error",
    });
  });
});
