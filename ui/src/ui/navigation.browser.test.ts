import { describe, expect, it, vi } from "vitest";
import "../styles.css";
import type { AlisioApp } from "./app.ts";
import { mountApp as mountTestApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";
import { DEFAULT_THEME_SELECTION } from "./theme.ts";

registerAppMountHooks();

function mountApp(pathname: string) {
  return mountTestApp(pathname);
}

function mountDisconnectedApp(pathname: string) {
  window.history.replaceState({}, "", pathname);
  const app = document.createElement("alisio-app") as AlisioApp;
  document.body.append(app);
  return app;
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function findConfirmButton(app: ReturnType<typeof mountApp>) {
  return Array.from(app.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.trim() === "Confirm",
  );
}

async function confirmPendingGatewayChange(app: ReturnType<typeof mountApp>) {
  const confirmButton = findConfirmButton(app);
  expect(confirmButton).not.toBeUndefined();
  confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await app.updateComplete;
}

function expectConfirmedGatewayChange(app: ReturnType<typeof mountApp>) {
  expect(app.settings.gatewayUrl).toBe("wss://other-gateway.example/\u006fpen\u0063law");
  expect(app.settings.token).toBe("abc123");
  expect(window.location.search).toBe("");
  expect(window.location.hash).toBe("");
}

function createBlockingBootstrap(): AlisioApp["alisioBootstrap"] {
  const runtimeContract: NonNullable<AlisioApp["alisioBootstrap"]>["runtimeContract"] = {
    scopeRoot: "account",
    backendShared: ["account", "auth", "linked_devices", "session_index", "automations"],
    localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"],
  };
  const account = {
    accountId: "user-1",
    scopeRoot: "account" as const,
    canonical: {
      scopeRoot: "account" as const,
      accountId: "user-1",
      source: "account_id" as const,
      authenticated: true,
      authRequired: true as const,
    },
    profile: {
      accountId: "user-1",
      username: "nuno",
      displayName: "Nuno",
      email: "nuno@alisio.local",
      avatarLabel: "N",
      joinedAt: "2026-04-01T00:00:00.000Z",
      plan: "free" as const,
    },
    preferences: {
      language: "pt-PT" as const,
      themeFamily: DEFAULT_THEME_SELECTION.themeFamily,
      themeMode: "dark" as const,
      themeAccents: DEFAULT_THEME_SELECTION.themeAccents,
    },
    session: {
      state: "signed_in" as const,
      profileCompleted: true,
      authRequired: true as const,
      authenticated: true,
      accountId: "user-1",
    },
    devices: [],
    cloud: {
      backend: "supabase" as const,
      available: true,
      missingEnvVars: [],
    },
    deviceBinding: {
      binding: "account_bound" as const,
      runtime: "local" as const,
      current: true,
      accountId: "user-1",
      deviceId: "device-1",
      label: "Mac",
      platform: "macos",
    },
    runtimeContract: {
      ...runtimeContract,
    },
  };
  return {
    accountId: "user-1",
    scopeRoot: "account",
    authRequired: true,
    connectionRequired: false,
    wizardRequired: false,
    wizardRunning: false,
    providerReady: false,
    accountReady: true,
    startupState: "needs_ai",
    organizationState: { mode: "none" },
    connectorSummary: {
      total: 0,
      ready: 0,
      connected: 0,
      needsReconnect: 0,
      inReview: 0,
      unavailable: 0,
      available: 0,
    },
    nextStep: "runtime",
    account,
    ai: { provider: "openai", status: "disconnected" },
    organization: { mode: "none" },
    connectors: {
      catalog: [],
      authorizations: [],
      summary: {
        total: 0,
        ready: 0,
        connected: 0,
        needsReconnect: 0,
        inReview: 0,
        unavailable: 0,
        available: 0,
      },
    },
    wizard: { running: false, sessionId: null },
    models: { total: 0, defaultProvider: "openai", providers: [] },
    deviceBinding: account.deviceBinding,
    runtimeContract,
  };
}

describe("control UI routing", () => {
  it("hydrates the tab from the location", async () => {
    const app = mountApp("/sessions");
    await app.updateComplete;

    expect(app.tab).toBe("chat");
    expect(window.location.pathname).toBe("/chat");
  });

  it("respects /ui base paths", async () => {
    const app = mountApp("/ui/cron");
    await app.updateComplete;

    expect(app.basePath).toBe("/ui");
    expect(app.tab).toBe("cron");
    expect(window.location.pathname).toBe("/ui/cron");
  });

  it("infers nested base paths", async () => {
    const app = mountApp("/apps/\u006fpen\u0063law/cron");
    await app.updateComplete;

    expect(app.basePath).toBe("/apps/\u006fpen\u0063law");
    expect(app.tab).toBe("cron");
    expect(window.location.pathname).toBe("/apps/\u006fpen\u0063law/cron");
  });

  it("honors explicit base path overrides", async () => {
    window.__ALISIO_CONTROL_UI_BASE_PATH__ = "/alisio";
    const app = mountApp("/alisio/sessions");
    await app.updateComplete;

    expect(app.basePath).toBe("/alisio");
    expect(app.tab).toBe("chat");
    expect(window.location.pathname).toBe("/alisio/chat");
  });

  it("updates the URL when clicking nav items", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>('a.nav-item[href="/connections"]');
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("connections");
    expect(window.location.pathname).toBe("/connections");
  });

  it("keeps the selected chat conversation when returning to Chat from another tab", async () => {
    const app = mountApp("/tasks");
    await app.updateComplete;

    const sessionKey = "agent:main:dashboard:chat-2";
    app.sessionKey = sessionKey;
    app.applySettings({
      ...app.settings,
      sessionKey,
      lastActiveSessionKey: sessionKey,
    });
    await app.updateComplete;

    app
      .querySelector<HTMLAnchorElement>('a[data-tab="chat"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await app.updateComplete;

    expect(app.tab).toBe("chat");
    expect(app.sessionKey).toBe(sessionKey);
    expect(app.settings.lastActiveSessionKey).toBe(sessionKey);
  });

  it("keeps the settings header and locale picker in Portuguese after a reload", async () => {
    localStorage.setItem("alisio.i18n.locale", "pt-PT");
    localStorage.setItem("alisio.control.settings.v2", JSON.stringify({ locale: "en" }));

    const app = mountApp("/settings");

    await vi.waitFor(async () => {
      await app.updateComplete;
      expect(app.querySelector(".dashboard-header__title")?.textContent).toContain("Definições");
      expect(
        app.querySelector<HTMLSelectElement>(".alisio-settings-field--inline select")?.value,
      ).toBe("pt-PT");
    });
  });

  it("renders the refreshed top navigation shell", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(app.querySelector(".topnav-shell")).not.toBeNull();
    expect(app.querySelector(".topnav-shell__content")).not.toBeNull();
    expect(app.querySelector(".topnav-shell__actions")).not.toBeNull();
    expect(app.querySelector(".topnav-shell .brand-title")).toBeNull();
  });

  it("keeps the topbar sizing aligned between chat and the other tabs", async () => {
    const chatApp = mountApp("/chat");
    await chatApp.updateComplete;
    const settingsApp = mountApp("/settings");
    await settingsApp.updateComplete;

    const chatTopbar = chatApp.querySelector<HTMLElement>(".topbar");
    const settingsTopbar = settingsApp.querySelector<HTMLElement>(".topbar");
    const chatSearch = chatApp.querySelector<HTMLElement>(".topbar-search");
    const settingsSearch = settingsApp.querySelector<HTMLElement>(".topbar-search");
    expect(chatTopbar).not.toBeNull();
    expect(settingsTopbar).not.toBeNull();
    expect(chatSearch).not.toBeNull();
    expect(settingsSearch).not.toBeNull();
    if (!chatTopbar || !settingsTopbar || !chatSearch || !settingsSearch) {
      return;
    }

    expect(getComputedStyle(settingsTopbar).minHeight).toBe(getComputedStyle(chatTopbar).minHeight);
    expect(getComputedStyle(settingsSearch).minHeight).toBe(getComputedStyle(chatSearch).minHeight);
    expect(getComputedStyle(settingsSearch).minWidth).toBe(getComputedStyle(chatSearch).minWidth);
  });

  it("renders the refreshed sidebar shell structure", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(app.querySelector(".sidebar-shell")).not.toBeNull();
    expect(app.querySelector(".sidebar-shell__header")).not.toBeNull();
    expect(app.querySelector(".sidebar-shell__body")).not.toBeNull();
    expect(app.querySelector(".sidebar-shell__footer")).not.toBeNull();
    expect(app.querySelector(".sidebar-brand")).not.toBeNull();
    expect(app.querySelector(".sidebar-brand__avatar")).not.toBeNull();
    expect(app.querySelector(".sidebar-brand__copy")).not.toBeNull();
    expect(app.querySelector(".sidebar-brand__popover")).not.toBeNull();
    expect(app.querySelector(".sidebar-edge-toggle")).not.toBeNull();
    expect(app.querySelector(".sidebar-context")).toBeNull();
    expect(app.querySelector(".nav-section__label")).not.toBeNull();
  });

  it("uses a dedicated onboarding shell on /setup", async () => {
    const app = mountApp("/setup");
    await app.updateComplete;

    expect(app.querySelector(".setup-frame")).not.toBeNull();
    expect(app.querySelector(".setup-frame__header")).not.toBeNull();
    expect(app.querySelector(".setup-frame__body")).not.toBeNull();
    expect(app.querySelector(".shell")).toBeNull();
    expect(app.querySelector(".sidebar-shell")).toBeNull();
    expect(app.querySelector(".topnav-shell")).toBeNull();
  });

  it("does not flash the setup shell while /chat is reconnecting on reload", async () => {
    const app = mountDisconnectedApp("/chat?session=agent%3Amain%3Amain");
    await app.updateComplete;

    expect(app.connected).toBe(false);
    expect(app.tab).toBe("chat");
    expect(app.querySelector(".setup-frame")).toBeNull();
    expect(app.querySelector(".shell")).not.toBeNull();
  });

  it("still forces setup when bootstrap already says onboarding is incomplete", async () => {
    const app = mountDisconnectedApp("/chat");
    app.alisioBootstrap = createBlockingBootstrap();
    app.requestUpdate();
    await app.updateComplete;

    expect(app.connected).toBe(false);
    expect(app.querySelector(".setup-frame")).not.toBeNull();
    expect(app.querySelector(".shell")).toBeNull();
  });

  it("does not render a desktop sidebar resizer or inject a custom nav width", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.applySettings({ ...app.settings, navWidth: 360 });
    await app.updateComplete;

    expect(app.querySelector(".sidebar-resizer")).toBeNull();
    const shell = app.querySelector<HTMLElement>(".shell");
    expect(shell?.style.getPropertyValue("--shell-nav-width")).toBe("");
  });

  it("hides section labels in collapsed mode", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.applySettings({ ...app.settings, navCollapsed: true });
    await app.updateComplete;

    expect(app.querySelector(".nav-section__label")).toBeNull();
    expect(app.querySelector(".sidebar-brand")).not.toBeNull();
    expect(app.querySelector(".sidebar-brand__copy")).toBeNull();
    expect(app.querySelector(".sidebar-edge-toggle.is-collapsed")).not.toBeNull();
    expect(app.querySelector(".sidebar-context")).toBeNull();
  });

  it("keeps only the account utility available in collapsed mode", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.applySettings({ ...app.settings, navCollapsed: true });
    await app.updateComplete;

    expect(app.querySelector(".sidebar-footer-compact")).not.toBeNull();
    expect(app.querySelector(".sidebar-footer-compact__account")).not.toBeNull();
    expect(app.querySelector(".sidebar-footer-compact__plans")).toBeNull();
  });

  it("keeps the collapsed desktop sidebar compact", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    app.applySettings({ ...app.settings, navCollapsed: true });
    await app.updateComplete;

    const item = app.querySelector<HTMLElement>(".sidebar .nav-item--rail");
    const shell = app.querySelector<HTMLElement>(".sidebar-shell");
    expect(item).not.toBeNull();
    expect(shell).not.toBeNull();
    if (!item || !shell) {
      return;
    }

    const itemStyles = getComputedStyle(item);
    const shellStyles = getComputedStyle(shell);
    expect(itemStyles.width).toBe("42px");
    expect(itemStyles.minHeight).toBe("42px");
    expect(shellStyles.display).toBe("flex");
  });

  it("resets to the main session when opening chat from sidebar navigation", async () => {
    const app = mountApp("/sessions?session=agent:main:subagent:task-123");
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>('a.nav-item[href="/chat"]');
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("chat");
    expect(app.sessionKey).toBe("main");
    expect(window.location.pathname).toBe("/chat");
    expect(window.location.search).toBe("?session=main");
  });

  it("keeps chat and nav usable on narrow viewports", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    const split = app.querySelector(".chat-split-container");
    expect(split).not.toBeNull();
    if (split) {
      expect(getComputedStyle(split).position).not.toBe("fixed");
    }

    const chatMain = app.querySelector(".chat-main");
    expect(chatMain).not.toBeNull();
    if (chatMain) {
      expect(getComputedStyle(chatMain).display).not.toBe("none");
    }

    if (split) {
      split.classList.add("chat-split-container--open");
      await app.updateComplete;
      expect(getComputedStyle(split).position).toBe("fixed");
    }
    if (chatMain) {
      expect(getComputedStyle(chatMain).display).toBe("none");
    }
  });

  it("stacks the refreshed top navigation for narrow viewports", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    const shell = app.querySelector<HTMLElement>(".topnav-shell");
    const content = app.querySelector<HTMLElement>(".topnav-shell__content");
    expect(shell).not.toBeNull();
    expect(content).not.toBeNull();
    if (!shell || !content) {
      return;
    }

    expect(getComputedStyle(shell).flexWrap).toBe("wrap");
    expect(getComputedStyle(content).width).not.toBe("auto");
  });

  it("keeps the mobile topbar nav toggle visible beside the search row", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    const shell = app.querySelector<HTMLElement>(".topnav-shell");
    const toggle = app.querySelector<HTMLElement>(".topbar-nav-toggle");
    const actions = app.querySelector<HTMLElement>(".topnav-shell__actions");
    expect(shell).not.toBeNull();
    expect(toggle).not.toBeNull();
    expect(actions).not.toBeNull();
    if (!shell || !toggle || !actions) {
      return;
    }

    const shellWidth = parseFloat(getComputedStyle(shell).width);
    const toggleWidth = parseFloat(getComputedStyle(toggle).width);
    const actionsWidth = parseFloat(getComputedStyle(actions).width);

    expect(toggleWidth).toBeGreaterThan(0);
    expect(actionsWidth).toBeLessThan(shellWidth);
  });

  it("opens the mobile sidenav as a drawer from the topbar toggle", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    const toggle = app.querySelector<HTMLButtonElement>(".topbar-nav-toggle");
    const shell = app.querySelector<HTMLElement>(".shell");
    const nav = app.querySelector<HTMLElement>(".shell-nav");
    expect(toggle).not.toBeNull();
    expect(shell).not.toBeNull();
    expect(nav).not.toBeNull();
    if (!toggle || !shell || !nav) {
      return;
    }

    expect(shell.classList.contains("shell--nav-drawer-open")).toBe(false);
    toggle.click();
    await app.updateComplete;

    expect(shell.classList.contains("shell--nav-drawer-open")).toBe(true);
    const styles = getComputedStyle(nav);
    expect(styles.position).toBe("fixed");
    expect(styles.transform).not.toBe("none");
  });

  it("closes the mobile sidenav drawer after navigation", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    expect(window.matchMedia("(max-width: 768px)").matches).toBe(true);

    const toggle = app.querySelector<HTMLButtonElement>(".topbar-nav-toggle");
    expect(toggle).not.toBeNull();
    toggle?.click();
    await app.updateComplete;

    const link = app.querySelector<HTMLAnchorElement>('a.nav-item[href="/organization"]');
    const shell = app.querySelector<HTMLElement>(".shell");
    expect(link).not.toBeNull();
    expect(shell?.classList.contains("shell--nav-drawer-open")).toBe(true);
    link?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));

    await app.updateComplete;
    expect(app.tab).toBe("organization");
    expect(shell?.classList.contains("shell--nav-drawer-open")).toBe(false);
  });

  it("auto-scrolls chat history to the latest message", async () => {
    const app = mountApp("/chat");
    await app.updateComplete;

    const initialContainer: HTMLElement | null = app.querySelector(".chat-thread");
    expect(initialContainer).not.toBeNull();
    if (!initialContainer) {
      return;
    }
    initialContainer.style.maxHeight = "180px";
    initialContainer.style.overflow = "auto";

    app.chatMessages = Array.from({ length: 60 }, (_, index) => ({
      role: "assistant",
      content: `Line ${index} - ${"x".repeat(200)}`,
      timestamp: Date.now() + index,
    }));

    await app.updateComplete;
    for (let i = 0; i < 6; i++) {
      await nextFrame();
    }

    const container = app.querySelector(".chat-thread");
    expect(container).not.toBeNull();
    if (!container) {
      return;
    }
    const maxScroll = container.scrollHeight - container.clientHeight;
    expect(maxScroll).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) {
      if (container.scrollTop === maxScroll) {
        break;
      }
      await nextFrame();
    }
    expect(container.scrollTop).toBe(maxScroll);
  });

  it("hydrates token from query params and strips them", async () => {
    const app = mountApp("/ui/overview?token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("alisio.control.settings.v2") ?? "{}").token).toBe(
      undefined,
    );
    expect(window.location.pathname).toBe("/ui/chat");
    expect(window.location.search).toBe("?session=main");
  });

  it("strips password URL params without importing them", async () => {
    const app = mountApp("/ui/overview?password=sekret");
    await app.updateComplete;

    expect(app.password).toBe("");
    expect(window.location.pathname).toBe("/ui/chat");
    expect(window.location.search).toBe("?session=main");
  });

  it("hydrates token from URL hash when settings already set", async () => {
    localStorage.setItem(
      "alisio.control.settings.v2",
      JSON.stringify({
        token: "existing-token",
        gatewayUrl: "wss://gateway.example/\u006fpen\u0063law",
      }),
    );
    const app = mountApp("/ui/overview#token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("alisio.control.settings.v2") ?? "{}")).toMatchObject({
      gatewayUrl: "wss://gateway.example/\u006fpen\u0063law",
    });
    expect(JSON.parse(localStorage.getItem("alisio.control.settings.v2") ?? "{}").token).toBe(
      undefined,
    );
    expect(window.location.pathname).toBe("/ui/chat");
    expect(window.location.hash).toBe("");
  });

  it("hydrates token from URL hash and strips it", async () => {
    const app = mountApp("/ui/overview#token=abc123");
    await app.updateComplete;

    expect(app.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("alisio.control.settings.v2") ?? "{}").token).toBe(
      undefined,
    );
    expect(window.location.pathname).toBe("/ui/chat");
    expect(window.location.hash).toBe("");
  });

  it("clears the current token when the gateway URL changes", async () => {
    const app = mountApp("/ui/settings#token=abc123");
    await app.updateComplete;

    app.applySettings({
      ...app.settings,
      gatewayUrl: "wss://other-gateway.example/\u006fpen\u0063law",
      token: app.settings.token,
    });
    await app.updateComplete;

    expect(app.settings.gatewayUrl).toBe("wss://other-gateway.example/\u006fpen\u0063law");
    expect(app.settings.token).toBe("");
  });

  it("keeps a hash token pending until the gateway URL change is confirmed", async () => {
    const app = mountApp(
      "/ui/settings?gatewayUrl=wss://other-gateway.example/\u006fpen\u0063law#token=abc123",
    );
    await app.updateComplete;

    expect(app.settings.gatewayUrl).not.toBe("wss://other-gateway.example/\u006fpen\u0063law");
    expect(app.settings.token).toBe("");

    await confirmPendingGatewayChange(app);

    expectConfirmedGatewayChange(app);
  });

  it("keeps a query token pending until the gateway URL change is confirmed", async () => {
    const app = mountApp(
      "/ui/settings?gatewayUrl=wss://other-gateway.example/\u006fpen\u0063law&token=abc123",
    );
    await app.updateComplete;

    expect(app.settings.gatewayUrl).not.toBe("wss://other-gateway.example/\u006fpen\u0063law");
    expect(app.settings.token).toBe("");

    await confirmPendingGatewayChange(app);

    expectConfirmedGatewayChange(app);
  });

  it("restores the token after a same-tab refresh", async () => {
    const first = mountApp("/ui/overview#token=abc123");
    await first.updateComplete;
    first.remove();

    const refreshed = mountApp("/ui/chat");
    await refreshed.updateComplete;

    expect(refreshed.settings.token).toBe("abc123");
    expect(JSON.parse(localStorage.getItem("alisio.control.settings.v2") ?? "{}").token).toBe(
      undefined,
    );
  });
});
