import { afterEach, describe, expect, it } from "vitest";
import {
  getChannelBranding,
  getConnectorActionBranding,
  getConnectorBranding,
} from "./connector-branding.ts";

describe("connector-branding", () => {
  afterEach(() => {
    delete window.__ALISIO_CONTROL_UI_BASE_PATH__;
  });

  it("resolves local connector assets by default", () => {
    expect(getConnectorBranding("github", "GitHub").logoUrl).toBe("brand-icons/github.png");
    expect(getConnectorBranding("gmail-send", "Google").logoUrl).toBe("brand-icons/gmail.svg");
  });

  it("prefixes connector and channel assets with the configured base path", () => {
    window.__ALISIO_CONTROL_UI_BASE_PATH__ = "/alisio/";

    expect(getConnectorBranding("github", "GitHub").logoUrl).toBe("/alisio/brand-icons/github.png");
    expect(getChannelBranding("whatsapp")?.logoUrl).toBe("/alisio/brand-icons/whatsapp.png");
  });

  it("falls back to provider branding and leaves unbranded channels alone", () => {
    expect(getConnectorBranding("unknown-connector", "GitHub").logoUrl).toBe(
      "brand-icons/github.png",
    );
    expect(getChannelBranding("irc")).toBeNull();
  });

  it("uses the Google mark for Google connect actions and keeps app logos for others", () => {
    expect(getConnectorActionBranding("gmail-send", "Google").logoUrl).toBe(
      "brand-icons/google.svg",
    );
    expect(getConnectorActionBranding("instagram", "Meta").logoUrl).toBe(
      "brand-icons/instagram.png",
    );
  });
});
