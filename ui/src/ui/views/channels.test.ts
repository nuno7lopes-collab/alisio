/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { loadChannels, startChannelSetup } from "../controllers/channels.ts";
import { renderChannels } from "./channels.ts";

function findButton(container: HTMLElement, label: string) {
  return [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(label),
  );
}

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
    loginConnected: null,
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
    onOpenSupportUrl: vi.fn(),
    ...overrides,
  };
}

function createChannelsControllerState(
  overrides?: Partial<Parameters<typeof loadChannels>[0]>,
): Parameters<typeof loadChannels>[0] {
  return {
    client: null,
    connected: true,
    channelsLoading: false,
    setupWizardSessionId: null,
    setupWizardStep: null,
    setupWizardStatus: null,
    setupWizardError: null,
    channelsSnapshot: null,
    channelsError: null,
    channelsLastSuccess: null,
    channelsBusyKey: null,
    channelsActionMessage: null,
    channelsLoginQrDataUrl: null,
    channelsLoginConnected: null,
    channelsSetupLoading: false,
    channelsSetupSubmitting: false,
    channelsSetupSessionId: null,
    channelsSetupStep: null,
    channelsSetupStatus: null,
    channelsSetupError: null,
    channelsSetupDraftText: "",
    channelsSetupDraftConfirm: false,
    channelsSetupDraftSelectIndex: 0,
    channelsSetupDraftMultiIndexes: [],
    channelsSetupChannelId: null,
    ...overrides,
  };
}

describe("channels view", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("shows setup guidance and issues for manually configured channels", () => {
    const container = document.createElement("div");
    const onOpenSupportUrl = vi.fn();

    render(
      renderChannels(
        createProps({
          onOpenSupportUrl,
          snapshot: {
            ts: Date.now(),
            channelOrder: ["telegram"],
            channelLabels: { telegram: "Telegram" },
            channelDetailLabels: { telegram: "Bot, groups, and direct messages" },
            channelMeta: [
              {
                id: "telegram",
                label: "Telegram",
                detailLabel: "Bot, groups, and direct messages",
                blurb: "Use a Telegram bot to keep talking to the same assistant.",
                docsPath: "/channels/telegram",
              },
            ],
            channelIssues: {
              telegram: [
                {
                  channel: "telegram",
                  accountId: "default",
                  kind: "permissions",
                  message: "The bot is missing access to the target group.",
                  fix: "Add the bot to the group before testing replies.",
                },
              ],
            },
            channels: {
              telegram: {
                configured: true,
                linked: true,
                running: true,
                setupAvailable: true,
              },
            },
            channelAccounts: {
              telegram: [
                {
                  accountId: "default",
                  configured: true,
                  linked: true,
                  running: true,
                  probe: {
                    ok: false,
                    bot: {
                      username: "alizia_bot",
                    },
                  },
                },
              ],
            },
            channelDefaultAccountId: {
              telegram: "default",
            },
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Needs attention");
    expect(container.textContent).toContain("@alizia_bot");
    expect(container.textContent).toContain("The bot is missing access to the target group.");
    expect(container.textContent).toContain("Create the bot in BotFather.");
    expect(container.textContent).toContain("Paste the bot token here.");
    expect(container.textContent).toContain("Direct messages reuse the main session");
    findButton(container, "View setup guide")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(onOpenSupportUrl).toHaveBeenCalledWith("https://docs.openclaw.ai/channels/telegram");
  });

  it("keeps the native WhatsApp QR flow exposed", () => {
    const container = document.createElement("div");
    const onStartWhatsAppLink = vi.fn();

    render(
      renderChannels(
        createProps({
          loginQrDataUrl: "data:image/png;base64,abc",
          loginConnected: false,
          onStartWhatsAppLink,
          snapshot: {
            ts: Date.now(),
            channelOrder: ["whatsapp"],
            channelLabels: { whatsapp: "WhatsApp" },
            channelDetailLabels: { whatsapp: "Phone link and QR pairing" },
            channelMeta: [
              {
                id: "whatsapp",
                label: "WhatsApp",
                detailLabel: "Phone link and QR pairing",
                docsPath: "/channels/whatsapp",
              },
            ],
            channels: {
              whatsapp: {
                configured: true,
                linked: false,
                running: true,
                setupAvailable: true,
                linkMode: "qr",
              },
            },
            channelAccounts: {
              whatsapp: [
                {
                  accountId: "default",
                  configured: true,
                  running: true,
                },
              ],
            },
            channelDefaultAccountId: {
              whatsapp: "default",
            },
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".qr-wrap img")).not.toBeNull();
    expect(container.textContent).toContain(
      "Scan this QR code in WhatsApp to link the number to Alisio.",
    );
    findButton(container, "Show QR")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onStartWhatsAppLink).toHaveBeenCalledWith(false);
  });

  it("starts the real setup flow for channels that are not configured yet", () => {
    const container = document.createElement("div");
    const onStartChannelSetup = vi.fn();

    render(
      renderChannels(
        createProps({
          onStartChannelSetup,
          snapshot: {
            ts: Date.now(),
            channelOrder: ["telegram"],
            channelLabels: { telegram: "Telegram" },
            channelDetailLabels: { telegram: "Bot, groups, and direct messages" },
            channelMeta: [
              {
                id: "telegram",
                label: "Telegram",
                detailLabel: "Bot, groups, and direct messages",
                blurb: "Use a Telegram bot to keep talking to the same assistant.",
                docsPath: "/channels/telegram",
              },
            ],
            channels: {
              telegram: {
                configured: false,
                linked: false,
                running: false,
                setupAvailable: true,
              },
            },
            channelAccounts: {
              telegram: [
                {
                  accountId: "default",
                  configured: false,
                  linked: false,
                  running: false,
                },
              ],
            },
            channelDefaultAccountId: {
              telegram: "default",
            },
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Create the bot in BotFather.");
    expect(container.textContent).toContain("Paste the bot token here.");
    findButton(container, "Connect")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onStartChannelSetup).toHaveBeenCalledWith("telegram");
  });

  it("shows a friendlier setup panel with guide access for current wizard steps", () => {
    const container = document.createElement("div");
    const onOpenSupportUrl = vi.fn();

    render(
      renderChannels(
        createProps({
          onOpenSupportUrl,
          setupSessionId: "wiz-1",
          setupChannelId: "telegram",
          setupStep: {
            id: "step-1",
            type: "text",
            title: "Telegram bot token",
            message: "Paste the token from BotFather",
            sensitive: true,
          },
          snapshot: {
            ts: Date.now(),
            channelOrder: ["telegram"],
            channelLabels: { telegram: "Telegram" },
            channelDetailLabels: { telegram: "Bot, groups, and direct messages" },
            channelMeta: [
              {
                id: "telegram",
                label: "Telegram",
                detailLabel: "Bot, groups, and direct messages",
                blurb: "Use a Telegram bot to keep talking to the same assistant.",
                docsPath: "/channels/telegram",
              },
            ],
            channels: {
              telegram: {
                configured: false,
                linked: false,
                running: false,
                setupAvailable: true,
              },
            },
            channelAccounts: {
              telegram: [
                {
                  accountId: "default",
                  configured: false,
                },
              ],
            },
            channelDefaultAccountId: {
              telegram: "default",
            },
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("3 steps");
    expect(container.textContent).toContain("This value stays hidden while you type it.");
    expect(container.textContent).toContain("Save and continue");
    findButton(container, "View setup guide")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(onOpenSupportUrl).toHaveBeenCalledWith("https://docs.openclaw.ai/channels/telegram");
  });

  it("reutiliza o snapshot recente dos canais sem novo pedido quando não há probe", async () => {
    const snapshot = {
      ts: Date.now(),
      channelOrder: ["telegram"],
      channelLabels: { telegram: "Telegram" },
      channelDetailLabels: { telegram: "Telegram" },
      channelSystemImages: {},
      channelMeta: [],
      channelIssues: {},
      channels: {},
      channelAccounts: {},
      channelDefaultAccountId: {},
    };
    const request = vi.fn(async () => snapshot);
    const state = createChannelsControllerState({
      client: { request } as never,
      channelsSnapshot: snapshot,
      channelsLastSuccess: Date.now(),
    });

    await loadChannels(state, false);

    expect(request).not.toHaveBeenCalled();
    expect(state.channelsSnapshot).toBe(snapshot);
  });

  it("ignora a cache dos canais quando é pedido probe", async () => {
    const snapshot = {
      ts: Date.now(),
      channelOrder: ["telegram"],
      channelLabels: { telegram: "Telegram" },
      channelDetailLabels: { telegram: "Telegram" },
      channelSystemImages: {},
      channelMeta: [],
      channelIssues: {},
      channels: {},
      channelAccounts: {},
      channelDefaultAccountId: {},
    };
    const request = vi.fn(async () => snapshot);
    const state = createChannelsControllerState({
      client: { request } as never,
      channelsSnapshot: snapshot,
      channelsLastSuccess: Date.now(),
    });

    await loadChannels(state, true);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("channels.status", {
      probe: true,
      timeoutMs: 8000,
    });
  });

  it("recupera um wizard de canal em curso a partir do snapshot do gateway", async () => {
    const snapshot = {
      ts: Date.now(),
      wizard: {
        running: true,
        sessionId: "wiz-telegram-1",
        channelId: "telegram",
      },
      channelOrder: ["telegram"],
      channelLabels: { telegram: "Telegram" },
      channelDetailLabels: { telegram: "Telegram" },
      channelSystemImages: {},
      channelMeta: [],
      channelIssues: {},
      channels: {},
      channelAccounts: {},
      channelDefaultAccountId: {},
    };
    const request = vi.fn(async (method: string) => {
      if (method === "channels.status") {
        return snapshot;
      }
      return {
        done: false,
        status: "running",
        step: {
          id: "step-token",
          type: "text",
          title: "Telegram bot token",
          message: "Paste the token from BotFather",
          sensitive: true,
        },
      };
    });
    const state = createChannelsControllerState({
      client: { request } as never,
    });

    await loadChannels(state, true);

    expect(request).toHaveBeenNthCalledWith(1, "channels.status", {
      probe: true,
      timeoutMs: 8000,
    });
    expect(request).toHaveBeenNthCalledWith(2, "wizard.next", {
      sessionId: "wiz-telegram-1",
    });
    expect(state.channelsSetupSessionId).toBe("wiz-telegram-1");
    expect(state.channelsSetupChannelId).toBe("telegram");
    expect(state.channelsSetupStep).toMatchObject({
      id: "step-token",
      type: "text",
      title: "Telegram bot token",
      sensitive: true,
    });
  });

  it("cancela um wizard antigo do onboarding antes de arrancar o setup do canal", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "wizard.cancel") {
        return { status: "cancelled", error: "cancelled" };
      }
      return {
        sessionId: "wiz-telegram-1",
        done: false,
        status: "running",
        step: {
          id: "step-token",
          type: "text",
          title: "Telegram bot token",
          message: "Paste the token from BotFather",
          sensitive: true,
        },
      };
    });
    const state = createChannelsControllerState({
      client: { request } as never,
      setupWizardSessionId: "wiz-onboarding-1",
      setupWizardStep: {
        id: "setup-1",
        type: "note",
        message: "Old setup wizard",
      },
      setupWizardStatus: "running",
    });

    await startChannelSetup(state, "telegram");

    expect(request).toHaveBeenNthCalledWith(1, "wizard.cancel", {
      sessionId: "wiz-onboarding-1",
    });
    expect(request).toHaveBeenNthCalledWith(2, "wizard.start", {
      surface: "channel",
      channel: "telegram",
    });
    expect(state.setupWizardSessionId).toBeNull();
    expect(state.channelsSetupStep).toMatchObject({
      type: "text",
      title: "Telegram bot token",
    });
  });

  it("salta a nota introdutória e mostra logo o campo do token do Telegram", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "wizard.start") {
        return {
          sessionId: "wiz-telegram-1",
          done: false,
          status: "running",
          step: {
            id: "step-note",
            type: "note",
            title: "Telegram bot token",
            message: "Create the bot in BotFather.",
          },
        };
      }
      return {
        done: false,
        status: "running",
        step: {
          id: "step-token",
          type: "text",
          title: "Telegram bot token",
          message: "Paste the token from BotFather",
          sensitive: true,
        },
      };
    });
    const state = createChannelsControllerState({
      client: { request } as never,
    });

    await startChannelSetup(state, "telegram");

    expect(request).toHaveBeenNthCalledWith(1, "wizard.start", {
      surface: "channel",
      channel: "telegram",
    });
    expect(request).toHaveBeenNthCalledWith(2, "wizard.next", {
      sessionId: "wiz-telegram-1",
      answer: {
        stepId: "step-note",
      },
    });
    expect(state.channelsSetupStep).toMatchObject({
      id: "step-token",
      type: "text",
      title: "Telegram bot token",
      sensitive: true,
    });
  });
});
