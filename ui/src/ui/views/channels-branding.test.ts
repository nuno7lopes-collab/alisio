/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderChannels } from "./channels.ts";

function createProps(overrides?: Record<string, unknown>) {
  return {
    connected: true,
    loading: false,
    error: null,
    snapshot: null,
    lastSuccess: Date.now(),
    busyKey: null,
    actionMessage: null,
    loginQrDataUrl: null,
    loginAccountId: null,
    setupLoading: false,
    setupSubmitting: false,
    setupSessionId: null,
    setupStep: null,
    setupStatus: null,
    setupError: null,
    setupDraftText: "",
    setupDraftConfirm: false,
    setupDraftSelectIndex: 0,
    setupDraftMultiIndexes: [],
    setupChannelId: null,
    onRefresh: vi.fn(),
    onStartChannelSetup: vi.fn(),
    onContinueSetup: vi.fn(),
    onCancelSetup: vi.fn(),
    onSetupDraftTextChange: vi.fn(),
    onSetupDraftConfirmChange: vi.fn(),
    onSetupDraftSelectIndexChange: vi.fn(),
    onSetupDraftMultiIndexesChange: vi.fn(),
    onStartWhatsAppLink: vi.fn(),
    onWaitWhatsAppLink: vi.fn(),
    onLogoutChannel: vi.fn(),
    onApproveChannelPairing: vi.fn(),
    onRejectChannelPairing: vi.fn(),
    onOpenSupportUrl: vi.fn(),
    ...overrides,
  };
}

describe("channels branding", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("renders official local brand icons for branded channels", () => {
    const container = document.createElement("div");

    render(
      renderChannels(
        createProps({
          snapshot: {
            ts: Date.now(),
            channelSurfaceMode: "product",
            channelOrder: ["whatsapp", "telegram"],
            channelLabels: { whatsapp: "WhatsApp", telegram: "Telegram" },
            channelDetailLabels: { whatsapp: "WhatsApp", telegram: "Telegram" },
            channelMeta: [
              { id: "whatsapp", label: "WhatsApp", detailLabel: "WhatsApp" },
              { id: "telegram", label: "Telegram", detailLabel: "Telegram" },
            ],
            channelIssues: {},
            channels: {
              whatsapp: { configured: true, linked: true, running: true },
              telegram: { configured: true, linked: true, running: true },
            },
            channelAccounts: {
              whatsapp: [],
              telegram: [],
            },
            channelDefaultAccountId: {},
          },
        }),
      ),
      container,
    );

    const iconUrls = [
      ...container.querySelectorAll<HTMLImageElement>(".channel-card__icon img"),
    ].map((img) => img.getAttribute("src"));

    expect(iconUrls).toContain("brand-icons/whatsapp.png");
    expect(iconUrls).toContain("brand-icons/telegram.svg");
  });
});
