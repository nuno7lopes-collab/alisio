/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { makeChannelBusyKey } from "../channels-shared.ts";
import {
  approveChannelPairingRequest,
  continueChannelSetup,
  loadChannels,
  rejectChannelPairingRequest,
  startChannelSetup,
  startWebChannelLogin,
  waitWebChannelLogin,
} from "../controllers/channels.ts";
import { countConnectedChannelAccounts, summarizeChannelsSnapshot } from "./channel-display.ts";
import { renderChannels } from "./channels.ts";

function findButton(container: ParentNode, label: string) {
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
    channelsLoginAccountId: null,
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
    expect(onOpenSupportUrl).toHaveBeenCalledWith(
      "https://docs.\u006fpen\u0063law.ai/channels/telegram",
    );
  });

  it("marks Telegram as waiting for the first DM instead of fully configured", () => {
    const container = document.createElement("div");

    render(
      renderChannels(
        createProps({
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
                docsPath: "/channels/telegram",
              },
            ],
            channelIssues: {},
            channels: {
              telegram: {
                configured: true,
                dmOnboardingState: "waiting_for_first_dm",
                setupAvailable: true,
              },
            },
            channelAccounts: {
              telegram: [
                {
                  accountId: "default",
                  configured: true,
                  dmOnboardingState: "waiting_for_first_dm",
                  pendingPairingRequests: 0,
                  probe: {
                    ok: true,
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

    expect(container.textContent).toContain("Waiting for first message");
    expect(container.textContent).toContain(
      "Telegram is connected, but your account still needs to be confirmed. Open Finish setup to use the Telegram setup link.",
    );
    expect(findButton(container, "Finish setup")).toBeDefined();
  });

  it("shows Telegram pending approval state on the channel card", () => {
    const container = document.createElement("div");

    render(
      renderChannels(
        createProps({
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
                docsPath: "/channels/telegram",
              },
            ],
            channelIssues: {
              telegram: [
                {
                  channel: "telegram",
                  accountId: "default",
                  kind: "intent",
                  message: "2 pending Telegram DM approval requests waiting for approval.",
                  fix: "Open Telegram setup again and send a message from the account that should use the bot. \u004fpen\u0043law will finish the first approval automatically.",
                },
              ],
            },
            channels: {
              telegram: {
                configured: true,
                dmOnboardingState: "pending_approval",
                pendingPairingRequests: 2,
                setupAvailable: true,
              },
            },
            channelAccounts: {
              telegram: [
                {
                  accountId: "default",
                  configured: true,
                  dmOnboardingState: "pending_approval",
                  pendingPairingRequests: 2,
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

    expect(container.textContent).toContain("Pending approval");
    expect(container.textContent).toContain(
      "2 Telegram access requests are waiting for approval before the first chat can start.",
    );
  });

  it("renders pending Telegram requests with approve and deny actions", () => {
    const container = document.createElement("div");
    const onApproveChannelPairing = vi.fn();
    const onRejectChannelPairing = vi.fn();

    render(
      renderChannels(
        createProps({
          onApproveChannelPairing,
          onRejectChannelPairing,
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
                docsPath: "/channels/telegram",
              },
            ],
            channelIssues: {},
            channels: {
              telegram: {
                configured: true,
                dmOnboardingState: "pending_approval",
                pendingPairingRequests: 1,
                setupAvailable: true,
              },
            },
            channelAccounts: {
              telegram: [
                {
                  accountId: "default",
                  configured: true,
                  dmOnboardingState: "pending_approval",
                  pendingPairingRequests: 1,
                  pendingPairing: [
                    {
                      requestId: "6074269928",
                      label: "Nuno",
                      detail: "@nuno · 6074269928",
                    },
                  ],
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

    expect(container.textContent).toContain("Pending Telegram requests");
    expect(container.textContent).toContain("Nuno");
    expect(container.textContent).toContain("@nuno · 6074269928");
    findButton(container, "Approve")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onApproveChannelPairing).toHaveBeenCalledWith("telegram", "default", "6074269928");
    findButton(container, "Deny")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onRejectChannelPairing).toHaveBeenCalledWith("telegram", "default", "6074269928");
  });

  it("keeps the native WhatsApp QR flow exposed", () => {
    const container = document.createElement("div");
    const onStartWhatsAppLink = vi.fn();

    render(
      renderChannels(
        createProps({
          loginQrDataUrl: "data:image/png;base64,abc",
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
      "Scan this QR in WhatsApp to link the number to Alisio.",
    );
    findButton(container, "Show QR")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onStartWhatsAppLink).toHaveBeenCalledWith(false, "default");
    expect(findButton(container, "Configure")).toBeUndefined();
  });

  it("mostra o QR apenas para a conta WhatsApp activa", () => {
    const container = document.createElement("div");

    render(
      renderChannels(
        createProps({
          loginQrDataUrl: "data:image/png;base64,abc",
          loginAccountId: "work",
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
                connected: false,
                setupAvailable: true,
                linkMode: "qr",
              },
            },
            channelAccounts: {
              whatsapp: [
                {
                  accountId: "default",
                  name: "Personal",
                  configured: true,
                  linked: false,
                  running: true,
                  self: {
                    e164: "+351911111111",
                  },
                },
                {
                  accountId: "work",
                  name: "Work",
                  configured: true,
                  linked: true,
                  connected: true,
                  self: {
                    e164: "+351922222222",
                  },
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

    const accounts = [...container.querySelectorAll(".channel-account")];
    expect(accounts).toHaveLength(2);
    expect(accounts[0]?.textContent).toContain("+351911111111");
    expect(accounts[0]?.querySelector(".qr-wrap img")).toBeNull();
    expect(accounts[0]?.textContent).toContain("Show QR");
    expect(accounts[1]?.textContent).toContain("+351922222222");
    expect(accounts[1]?.querySelector(".qr-wrap img")).not.toBeNull();
    expect(container.textContent).not.toContain("false");
  });

  it("não replica o QR do WhatsApp para Telegram ou Discord quando a conta activa é default", () => {
    const container = document.createElement("div");

    render(
      renderChannels(
        createProps({
          loginQrDataUrl: "data:image/png;base64,abc",
          snapshot: {
            ts: Date.now(),
            channelOrder: ["telegram", "whatsapp", "discord"],
            channelLabels: {
              telegram: "Telegram",
              whatsapp: "WhatsApp",
              discord: "Discord",
            },
            channelDetailLabels: {
              telegram: "Telegram",
              whatsapp: "WhatsApp",
              discord: "Discord",
            },
            channelMeta: [
              {
                id: "telegram",
                label: "Telegram",
                detailLabel: "Telegram",
                docsPath: "/channels/telegram",
              },
              {
                id: "whatsapp",
                label: "WhatsApp",
                detailLabel: "WhatsApp",
                docsPath: "/channels/whatsapp",
              },
              {
                id: "discord",
                label: "Discord",
                detailLabel: "Discord",
                docsPath: "/channels/discord",
              },
            ],
            channels: {
              telegram: { configured: true, linked: true, connected: true, setupAvailable: true },
              whatsapp: {
                configured: true,
                linked: false,
                running: true,
                setupAvailable: true,
                linkMode: "qr",
              },
              discord: { configured: true, linked: true, connected: true, setupAvailable: true },
            },
            channelAccounts: {
              telegram: [{ accountId: "default", configured: true, linked: true, connected: true }],
              whatsapp: [{ accountId: "default", configured: true, linked: false, running: true }],
              discord: [{ accountId: "default", configured: true, linked: true, connected: true }],
            },
            channelDefaultAccountId: {
              telegram: "default",
              whatsapp: "default",
              discord: "default",
            },
          },
        }),
      ),
      container,
    );

    const cards = [...container.querySelectorAll(".channel-card")];
    expect(cards).toHaveLength(3);
    expect(cards[0]?.textContent).toContain("Telegram");
    expect(cards[0]?.querySelector(".qr-wrap img")).toBeNull();
    expect(cards[1]?.textContent).toContain("WhatsApp");
    expect(cards[1]?.querySelector(".qr-wrap img")).not.toBeNull();
    expect(cards[2]?.textContent).toContain("Discord");
    expect(cards[2]?.querySelector(".qr-wrap img")).toBeNull();
    expect(container.querySelectorAll(".qr-wrap img")).toHaveLength(1);
  });

  it("mostra 'Edit channel' no WhatsApp já ligado sem duplicar a acção de QR", () => {
    const container = document.createElement("div");

    render(
      renderChannels(
        createProps({
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
                linked: true,
                connected: true,
                setupAvailable: true,
                linkMode: "qr",
              },
            },
            channelAccounts: {
              whatsapp: [
                {
                  accountId: "default",
                  configured: true,
                  linked: true,
                  connected: true,
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

    expect(findButton(container, "Show QR")).toBeUndefined();
    expect(findButton(container, "Relink")).not.toBeNull();
    expect(findButton(container, "Edit channel")).not.toBeNull();
  });

  it("oculta a mensagem global de acção enquanto o QR do WhatsApp está visível", () => {
    const container = document.createElement("div");

    render(
      renderChannels(
        createProps({
          actionMessage: "Still waiting for the QR scan.",
          loginQrDataUrl: "data:image/png;base64,abc",
          snapshot: {
            ts: Date.now(),
            channelOrder: ["whatsapp"],
            channelLabels: { whatsapp: "WhatsApp" },
            channelDetailLabels: { whatsapp: "WhatsApp" },
            channelMeta: [
              {
                id: "whatsapp",
                label: "WhatsApp",
                detailLabel: "WhatsApp",
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

    expect(container.querySelector(".channel-feedback--ok")).toBeNull();
    expect(container.textContent).not.toContain("Still waiting for the QR scan.");
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

  it("shows finish setup when the channel is still only available through setup-only mode", () => {
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
                docsPath: "/channels/telegram",
              },
            ],
            channelIssues: {},
            channels: {
              telegram: {
                configured: false,
                linked: false,
                running: false,
                setupAvailable: true,
                setupOnly: true,
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

    findButton(container, "Finish setup")?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(onStartChannelSetup).toHaveBeenCalledWith("telegram");
  });

  it("shows fix setup when a configured channel is stuck in setup-only mode", () => {
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
                docsPath: "/channels/telegram",
              },
            ],
            channelIssues: {
              telegram: [
                {
                  channel: "telegram",
                  accountId: "default",
                  kind: "config",
                  message:
                    "Channel configuration is saved, but the runtime channel is not loaded on this host yet.",
                },
              ],
            },
            channels: {
              telegram: {
                configured: true,
                linked: true,
                running: false,
                setupAvailable: true,
                setupOnly: true,
              },
            },
            channelAccounts: {
              telegram: [
                {
                  accountId: "default",
                  configured: true,
                  linked: true,
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
    findButton(container, "Fix setup")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
    expect(onOpenSupportUrl).toHaveBeenCalledWith(
      "https://docs.\u006fpen\u0063law.ai/channels/telegram",
    );
  });

  it("evita duplicar os passos compactos quando o setup do canal já está aberto", () => {
    const container = document.createElement("div");

    render(
      renderChannels(
        createProps({
          setupSessionId: "wiz-telegram-1",
          setupChannelId: "telegram",
          setupStep: {
            id: "step-token",
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

    const matchingSteps = [...container.querySelectorAll(".channel-step__text")].filter((step) =>
      step.textContent?.includes("Create the bot in BotFather."),
    );
    expect(matchingSteps).toHaveLength(1);
  });

  it("keeps channel summary helpers aligned with setup-only and running states", () => {
    const snapshot = {
      ts: Date.now(),
      channelOrder: ["telegram", "whatsapp", "discord"],
      channelLabels: {
        telegram: "Telegram",
        whatsapp: "WhatsApp",
        discord: "Discord",
      },
      channelDetailLabels: {
        telegram: "Telegram",
        whatsapp: "WhatsApp",
        discord: "Discord",
      },
      channelMeta: [],
      channelIssues: {
        telegram: [
          {
            channel: "telegram",
            accountId: "default",
            kind: "config" as const,
            message:
              "Channel configuration is saved, but the runtime channel is not loaded on this host yet.",
          },
        ],
      },
      channels: {
        telegram: {
          configured: true,
          setupAvailable: true,
          setupOnly: true,
        },
        whatsapp: {
          configured: true,
          linked: true,
          connected: true,
          setupAvailable: true,
        },
        discord: {
          configured: false,
          setupAvailable: true,
        },
      },
      channelAccounts: {
        telegram: [
          {
            accountId: "default",
            configured: true,
          },
        ],
        whatsapp: [
          {
            accountId: "default",
            configured: true,
            linked: true,
            connected: true,
          },
        ],
        discord: [
          {
            accountId: "default",
            configured: false,
          },
        ],
      },
      channelDefaultAccountId: {
        telegram: "default",
        whatsapp: "default",
        discord: "default",
      },
    };

    expect(countConnectedChannelAccounts(snapshot)).toBe(1);
    expect(summarizeChannelsSnapshot(snapshot)).toMatchObject({
      totalChannels: 3,
      connectedChannels: 1,
      attentionChannels: 1,
      activeChannels: 2,
      connectedAccounts: 1,
    });
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

  it("limpa o estado stale do setup quando o gateway já não tem wizard em curso", async () => {
    const snapshot = {
      ts: Date.now(),
      wizard: {
        running: false,
        sessionId: null,
        channelId: null,
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
    const request = vi.fn(async () => snapshot);
    const state = createChannelsControllerState({
      client: { request } as never,
      channelsSetupSessionId: "wiz-stale-1",
      channelsSetupChannelId: "telegram",
      channelsSetupError: "wizard already running",
      channelsSetupStep: {
        id: "step-stale",
        type: "text",
        message: "stale",
      },
      channelsSetupDraftText: "abc",
    });

    await loadChannels(state, true);

    expect(state.channelsSetupSessionId).toBeNull();
    expect(state.channelsSetupChannelId).toBeNull();
    expect(state.channelsSetupError).toBeNull();
    expect(state.channelsSetupStep).toBeNull();
    expect(state.channelsSetupDraftText).toBe("");
  });

  it("limpa o QR guardado localmente quando o snapshot já mostra o WhatsApp ligado", async () => {
    const snapshot = {
      ts: Date.now(),
      wizard: {
        running: false,
        sessionId: null,
        channelId: null,
      },
      channelOrder: ["whatsapp"],
      channelLabels: { whatsapp: "WhatsApp" },
      channelDetailLabels: { whatsapp: "WhatsApp" },
      channelSystemImages: {},
      channelMeta: [],
      channelIssues: {},
      channels: {
        whatsapp: {
          configured: true,
          linked: true,
          connected: true,
          setupAvailable: true,
          linkMode: "qr",
        },
      },
      channelAccounts: {
        whatsapp: [
          {
            accountId: "work",
            configured: true,
            linked: true,
            connected: true,
          },
        ],
      },
      channelDefaultAccountId: {
        whatsapp: "work",
      },
    };
    const request = vi.fn(async () => snapshot);
    const state = createChannelsControllerState({
      client: { request } as never,
      channelsLoginQrDataUrl: "data:image/png;base64,stale",
      channelsLoginAccountId: "work",
    });

    await loadChannels(state, true);

    expect(state.channelsLoginQrDataUrl).toBeNull();
    expect(state.channelsLoginAccountId).toBeNull();
  });

  it("troca o erro esperado de restart por uma mensagem neutra depois de guardar", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "wizard.next") {
        return {
          done: true,
          status: "done",
        };
      }
      if (method === "channels.status") {
        throw new Error("gateway closed (1012): service restart");
      }
      throw new Error(`unexpected method ${method}`);
    });
    const state = createChannelsControllerState({
      client: { request } as never,
      channelsSetupSessionId: "wiz-telegram-1",
      channelsSetupChannelId: "telegram",
      channelsSetupStep: {
        id: "step-keep-token",
        type: "confirm",
        message: "Keep the current token",
      },
    });

    await continueChannelSetup(state, {
      stepId: "step-keep-token",
      value: true,
    });

    expect(state.channelsError).toBeNull();
    expect(state.channelsActionMessage).toBe(
      "Channel saved. Alisio is restarting to apply the connection.",
    );
  });

  it("salta o passo legado de login inline do WhatsApp e responde false", async () => {
    const snapshot = {
      ts: Date.now(),
      wizard: {
        running: false,
        sessionId: null,
        channelId: null,
      },
      channelOrder: ["whatsapp"],
      channelLabels: { whatsapp: "WhatsApp" },
      channelDetailLabels: { whatsapp: "WhatsApp" },
      channelSystemImages: {},
      channelMeta: [],
      channelIssues: {},
      channels: {},
      channelAccounts: {},
      channelDefaultAccountId: {},
    };
    const request = vi.fn(async (method: string) => {
      if (method === "wizard.start") {
        return {
          sessionId: "wiz-whatsapp-1",
          done: false,
          status: "running",
          step: {
            id: "step-link",
            type: "confirm",
            message: "Link WhatsApp now (QR)?",
            initialValue: true,
          },
        };
      }
      if (method === "wizard.next") {
        return {
          done: true,
          status: "done",
        };
      }
      return snapshot;
    });
    const state = createChannelsControllerState({
      client: { request } as never,
    });

    await startChannelSetup(state, "whatsapp");

    expect(request).toHaveBeenNthCalledWith(1, "wizard.start", {
      surface: "channel",
      channel: "whatsapp",
    });
    expect(request).toHaveBeenNthCalledWith(2, "wizard.next", {
      sessionId: "wiz-whatsapp-1",
      answer: {
        stepId: "step-link",
        value: false,
      },
    });
    expect(state.channelsActionMessage).toBe(
      "Channel saved. Open the WhatsApp QR when you are ready to finish linking.",
    );
  });

  it("limpa o QR stale quando arrancar o login WhatsApp falha", async () => {
    const request = vi.fn(async () => {
      throw new Error("boom");
    });
    const state = createChannelsControllerState({
      client: { request } as never,
      channelsLoginQrDataUrl: "data:image/png;base64,stale",
      channelsLoginAccountId: "work",
    });

    await startWebChannelLogin(state, { accountId: "work" });

    expect(request).toHaveBeenCalledWith("web.login.start", {
      force: false,
      timeoutMs: 30_000,
      accountId: "work",
    });
    expect(state.channelsLoginQrDataUrl).toBeNull();
    expect(state.channelsLoginAccountId).toBeNull();
    expect(state.channelsError).toBe("boom");
  });

  it("mantém o estado ocupado enquanto o wait automático do WhatsApp fica pendente", async () => {
    let resolveWait!: (value: { connected?: boolean; accountId?: string | null }) => void;
    const waitPromise = new Promise<{ connected?: boolean; accountId?: string | null }>(
      (resolve) => {
        resolveWait = resolve;
      },
    );
    const snapshot = {
      ts: Date.now(),
      channelOrder: ["whatsapp"],
      channelLabels: { whatsapp: "WhatsApp" },
      channelDetailLabels: { whatsapp: "WhatsApp" },
      channelSystemImages: {},
      channelMeta: [],
      channelIssues: {},
      channels: {},
      channelAccounts: {},
      channelDefaultAccountId: {},
    };
    const request = vi.fn(async (method: string) => {
      if (method === "web.login.start") {
        return {
          qrDataUrl: "data:image/png;base64,new",
          accountId: "default",
          connected: false,
        };
      }
      if (method === "web.login.wait") {
        return await waitPromise;
      }
      return snapshot;
    });
    const state = createChannelsControllerState({
      client: { request } as never,
    });

    await startWebChannelLogin(state);

    expect(state.channelsBusyKey).toBe(
      makeChannelBusyKey({
        channelId: "whatsapp",
        action: "login-wait",
        accountId: "default",
      }),
    );

    resolveWait({ connected: false, accountId: "default" });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("reutiliza a conta activa ao esperar pelo login WhatsApp", async () => {
    const snapshot = {
      ts: Date.now(),
      channelOrder: ["whatsapp"],
      channelLabels: { whatsapp: "WhatsApp" },
      channelDetailLabels: { whatsapp: "WhatsApp" },
      channelSystemImages: {},
      channelMeta: [],
      channelIssues: {},
      channels: {},
      channelAccounts: {},
      channelDefaultAccountId: {},
    };
    const request = vi.fn(async (method: string) => {
      if (method === "web.login.wait") {
        return {
          connected: true,
          message: "linked",
          accountId: "work",
        };
      }
      return snapshot;
    });
    const state = createChannelsControllerState({
      client: { request } as never,
      channelsLoginQrDataUrl: "data:image/png;base64,active",
      channelsLoginAccountId: "work",
    });

    await waitWebChannelLogin(state);

    expect(request).toHaveBeenNthCalledWith(1, "web.login.wait", {
      timeoutMs: 120_000,
      accountId: "work",
    });
    expect(state.channelsLoginQrDataUrl).toBeNull();
    expect(state.channelsLoginAccountId).toBeNull();
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

  it("aprova um pedido Telegram pelo gateway e refresca o estado", async () => {
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
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "channels.pairing.approve") {
        return {
          channel: "telegram",
          accountId: "default",
          requestId: "6074269928",
        };
      }
      if (method === "channels.status") {
        return snapshot;
      }
      throw new Error(`unexpected method ${method} ${JSON.stringify(params)}`);
    });
    const state = createChannelsControllerState({
      client: { request } as never,
    });

    await approveChannelPairingRequest(state, {
      channelId: "telegram",
      accountId: "default",
      requestId: "6074269928",
    });

    expect(request).toHaveBeenNthCalledWith(1, "channels.pairing.approve", {
      channel: "telegram",
      requestId: "6074269928",
      accountId: "default",
    });
    expect(state.channelsActionMessage).toBe(
      "Telegram account approved. Send a message to start chatting.",
    );
    expect(state.channelsBusyKey).toBeNull();
  });

  it("rejeita um pedido Telegram pelo gateway e refresca o estado", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
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
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "channels.pairing.reject") {
        return {
          channel: "telegram",
          accountId: "default",
          requestId: "6074269928",
        };
      }
      if (method === "channels.status") {
        return snapshot;
      }
      throw new Error(`unexpected method ${method} ${JSON.stringify(params)}`);
    });
    const state = createChannelsControllerState({
      client: { request } as never,
    });

    try {
      await rejectChannelPairingRequest(state, {
        channelId: "telegram",
        accountId: "default",
        requestId: "6074269928",
      });
    } finally {
      confirmSpy.mockRestore();
    }

    expect(request).toHaveBeenNthCalledWith(1, "channels.pairing.reject", {
      channel: "telegram",
      requestId: "6074269928",
      accountId: "default",
    });
    expect(state.channelsActionMessage).toBe("Access request denied.");
    expect(state.channelsBusyKey).toBeNull();
  });
});
