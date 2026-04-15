import { t } from "../../i18n/index.ts";
import {
  isChannelBusyKey,
  isLegacyWhatsAppInlineLinkStep,
  makeChannelBusyKey,
  normalizeChannelAccountId,
  readRunningChannelWizard,
} from "../channels-shared.ts";
import type {
  WizardNextResult,
  WizardStartResult,
  WizardStatusResult,
  WizardStep,
} from "../types.ts";
import { ChannelsStatusSnapshot } from "../types.ts";
import type { ChannelsState } from "./channels.types.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

export type { ChannelsState };

type WebLoginStartResult = {
  qrDataUrl?: string | null;
  message?: string | null;
  connected?: boolean | null;
  accountId?: string | null;
};

type WebLoginWaitResult = {
  connected?: boolean | null;
  message?: string | null;
  accountId?: string | null;
};

type ChannelLogoutResult = {
  cleared?: boolean | null;
  envToken?: boolean | null;
};

type ChannelPairingResult = {
  channel?: string | null;
  accountId?: string | null;
  requestId?: string | null;
};

const CHANNELS_CACHE_TTL_MS = 30_000;
const CHANNEL_SETUP_REQUEST_TIMEOUT_MS = 8_000;

function isWizardTerminalStatus(status: string | null | undefined) {
  return status === "done" || status === "cancelled" || status === "error";
}

function valuesEqual(left: unknown, right: unknown) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return left === right;
  }
}

export async function loadChannels(
  state: ChannelsState,
  probe: boolean,
  opts?: { resumeWizard?: boolean },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.channelsLoading) {
    return;
  }
  if (
    !probe &&
    state.channelsSnapshot &&
    typeof state.channelsLastSuccess === "number" &&
    Date.now() - state.channelsLastSuccess < CHANNELS_CACHE_TTL_MS
  ) {
    return;
  }
  state.channelsLoading = true;
  state.channelsError = null;
  try {
    const res = await state.client.request<ChannelsStatusSnapshot | null>("channels.status", {
      probe,
      timeoutMs: 8000,
    });
    state.channelsSnapshot = res;
    state.channelsLastSuccess = Date.now();
    reconcileWhatsAppLoginState(state, res);
    const runningWizard = readRunningChannelWizard(res);
    if (
      !runningWizard &&
      !state.channelsSetupLoading &&
      !state.channelsSetupSubmitting &&
      (state.channelsSetupSessionId !== null ||
        state.channelsSetupStep !== null ||
        Boolean(state.channelsSetupError))
    ) {
      clearChannelSetupState(state);
    }
    if (
      opts?.resumeWizard !== false &&
      runningWizard &&
      !state.channelsSetupLoading &&
      !state.channelsSetupSubmitting &&
      !state.channelsSetupSessionId &&
      !state.channelsSetupStep
    ) {
      await resumeChannelSetup(state, runningWizard);
    }
  } catch (err) {
    if (isMissingOperatorReadScopeError(err)) {
      state.channelsSnapshot = null;
      state.channelsError = formatMissingOperatorReadScopeMessage("channel status");
    } else {
      state.channelsError = String(err);
    }
  } finally {
    state.channelsLoading = false;
  }
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
    void promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isRequestTimeoutError(err: unknown) {
  return getErrorMessage(err) === t("alisio.channels.setupTimeout");
}

function isWizardAlreadyRunningError(err: unknown) {
  return getErrorMessage(err).includes("wizard already running");
}

function isExpectedGatewayRestartMessage(message: string | null | undefined) {
  return typeof message === "string" && /gateway closed \(1012\): service restart/i.test(message);
}

function setBusyKey(state: ChannelsState, value: string | null) {
  if ("channelsBusyKey" in state) {
    state.channelsBusyKey = value;
  }
}

function hasBusyChannelAction(
  state: ChannelsState,
  params: {
    channelId: string;
    accountId?: string | null;
    actions: Array<"login-start" | "login-wait" | "logout" | "pairing-approve" | "pairing-reject">;
  },
) {
  return params.actions.some((action) =>
    isChannelBusyKey(state.channelsBusyKey, {
      channelId: params.channelId,
      action,
      accountId: params.accountId,
    }),
  );
}

function setActionMessage(state: ChannelsState, value: string | null) {
  if ("channelsActionMessage" in state) {
    state.channelsActionMessage = value;
  }
}

function setLoginQrDataUrl(state: ChannelsState, value: string | null) {
  if ("channelsLoginQrDataUrl" in state) {
    state.channelsLoginQrDataUrl = value;
  }
}

function setLoginAccountId(state: ChannelsState, value: string | null) {
  if ("channelsLoginAccountId" in state) {
    state.channelsLoginAccountId = value;
  }
}

function setSetupLoading(state: ChannelsState, value: boolean) {
  if ("channelsSetupLoading" in state) {
    state.channelsSetupLoading = value;
  }
}

function setSetupSubmitting(state: ChannelsState, value: boolean) {
  if ("channelsSetupSubmitting" in state) {
    state.channelsSetupSubmitting = value;
  }
}

function setSetupSessionId(state: ChannelsState, value: string | null) {
  if ("channelsSetupSessionId" in state) {
    state.channelsSetupSessionId = value;
  }
}

function setSetupStep(state: ChannelsState, value: WizardStep | null) {
  if ("channelsSetupStep" in state) {
    state.channelsSetupStep = value;
  }
}

function setSetupStatus(state: ChannelsState, value: string | null) {
  if ("channelsSetupStatus" in state) {
    state.channelsSetupStatus = value;
  }
}

function setSetupError(state: ChannelsState, value: string | null) {
  if ("channelsSetupError" in state) {
    state.channelsSetupError = value;
  }
}

function setSetupDraftText(state: ChannelsState, value: string) {
  if ("channelsSetupDraftText" in state) {
    state.channelsSetupDraftText = value;
  }
}

function setSetupDraftConfirm(state: ChannelsState, value: boolean) {
  if ("channelsSetupDraftConfirm" in state) {
    state.channelsSetupDraftConfirm = value;
  }
}

function setSetupDraftSelectIndex(state: ChannelsState, value: number) {
  if ("channelsSetupDraftSelectIndex" in state) {
    state.channelsSetupDraftSelectIndex = value;
  }
}

function setSetupDraftMultiIndexes(state: ChannelsState, value: number[]) {
  if ("channelsSetupDraftMultiIndexes" in state) {
    state.channelsSetupDraftMultiIndexes = value;
  }
}

function setSetupChannelId(state: ChannelsState, value: string | null) {
  if ("channelsSetupChannelId" in state) {
    state.channelsSetupChannelId = value;
  }
}

function findWhatsAppSnapshotAccount(
  state: ChannelsState,
  snapshot: ChannelsStatusSnapshot | null,
) {
  const accountId = state.channelsLoginAccountId;
  if (!snapshot || !accountId?.trim()) {
    return null;
  }
  const accounts = snapshot.channelAccounts?.whatsapp;
  if (!Array.isArray(accounts)) {
    return null;
  }
  const normalizedAccountId = normalizeChannelAccountId(accountId);
  return (
    accounts.find(
      (account) => normalizeChannelAccountId(account.accountId) === normalizedAccountId,
    ) ?? null
  );
}

function clearWhatsAppLoginState(state: ChannelsState) {
  setLoginQrDataUrl(state, null);
  setLoginAccountId(state, null);
}

function reconcileWhatsAppLoginState(
  state: ChannelsState,
  snapshot: ChannelsStatusSnapshot | null,
) {
  if (!state.channelsLoginQrDataUrl && !state.channelsLoginAccountId) {
    return;
  }
  const activeAccount = findWhatsAppSnapshotAccount(state, snapshot);
  if (!activeAccount) {
    if (!snapshot?.channelAccounts?.whatsapp) {
      return;
    }
    clearWhatsAppLoginState(state);
    return;
  }
  if (activeAccount.linked === true || activeAccount.connected === true) {
    clearWhatsAppLoginState(state);
  }
}

function clearOnboardingWizardState(state: ChannelsState) {
  if ("setupWizardSessionId" in state) {
    state.setupWizardSessionId = null;
  }
  if ("setupWizardStep" in state) {
    state.setupWizardStep = null;
  }
  if ("setupWizardStatus" in state) {
    state.setupWizardStatus = null;
  }
  if ("setupWizardError" in state) {
    state.setupWizardError = null;
  }
}

function clearChannelSetupState(state: ChannelsState) {
  setSetupSessionId(state, null);
  setSetupStep(state, null);
  setSetupStatus(state, null);
  setSetupError(state, null);
  setSetupChannelId(state, null);
  syncSetupDraftState(state, null);
}

function findChannelDefaultAccount(
  snapshot: ChannelsStatusSnapshot | null,
  channelId: string | null,
) {
  if (!snapshot || !channelId?.trim()) {
    return null;
  }
  const accounts = snapshot.channelAccounts?.[channelId];
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return null;
  }
  const defaultAccountId = snapshot.channelDefaultAccountId?.[channelId];
  return accounts.find((account) => account.accountId === defaultAccountId) ?? accounts[0] ?? null;
}

function syncSetupDraftState(state: ChannelsState, step: WizardStep | null) {
  if (!step) {
    setSetupDraftText(state, "");
    setSetupDraftConfirm(state, false);
    setSetupDraftSelectIndex(state, 0);
    setSetupDraftMultiIndexes(state, []);
    return;
  }
  setSetupDraftText(
    state,
    step.type === "text" && typeof step.initialValue === "string" ? step.initialValue : "",
  );
  setSetupDraftConfirm(
    state,
    step.type === "confirm" && !isLegacyWhatsAppInlineLinkStep(state.channelsSetupChannelId, step)
      ? Boolean(step.initialValue)
      : false,
  );
  if (Array.isArray(step.options) && step.options.length > 0) {
    const selectIndex = step.options.findIndex((option) =>
      valuesEqual(option.value, step.initialValue),
    );
    setSetupDraftSelectIndex(state, selectIndex >= 0 ? selectIndex : 0);
    const initialValues = Array.isArray(step.initialValue) ? step.initialValue : [];
    setSetupDraftMultiIndexes(
      state,
      step.options.reduce<number[]>((selected, option, index) => {
        if (initialValues.some((entry) => valuesEqual(entry, option.value))) {
          selected.push(index);
        }
        return selected;
      }, []),
    );
    return;
  }
  setSetupDraftSelectIndex(state, 0);
  setSetupDraftMultiIndexes(state, []);
}

function applySetupResult(
  state: ChannelsState,
  result: WizardStartResult | WizardNextResult | WizardStatusResult,
  sessionId?: string | null,
) {
  if ("sessionId" in result) {
    setSetupSessionId(state, result.sessionId);
  } else if (typeof sessionId === "string" || sessionId === null) {
    setSetupSessionId(state, sessionId);
  }
  const nextStatus = result.status ?? ("done" in result && result.done ? "done" : null);
  setSetupStatus(state, nextStatus);
  setSetupError(state, result.error ?? null);
  if ("step" in result) {
    setSetupStep(state, result.step ?? null);
  }
  syncSetupDraftState(state, state.channelsSetupStep ?? null);
  const terminal = ("done" in result && result.done) || isWizardTerminalStatus(nextStatus);
  const channelId = terminal ? (state.channelsSetupChannelId ?? null) : null;
  const status = nextStatus;
  if (terminal) {
    setSetupSessionId(state, null);
    setSetupStep(state, null);
    syncSetupDraftState(state, null);
  }
  return {
    terminal,
    channelId,
    status,
  };
}

async function advanceChannelSetupPastPassiveSteps(
  state: ChannelsState,
  result: WizardStartResult | WizardNextResult,
): Promise<WizardStartResult | WizardNextResult> {
  if (!state.client || !state.connected) {
    return result;
  }
  let current = result;
  let sessionId =
    "sessionId" in current ? current.sessionId : (state.channelsSetupSessionId ?? null);
  while (!("done" in current && current.done) && current.status === "running") {
    const step = current.step ?? null;
    const shouldAutoAdvanceNote = step?.type === "note";
    const shouldAutoSkipLegacyWhatsAppLink = isLegacyWhatsAppInlineLinkStep(
      state.channelsSetupChannelId,
      step,
    );
    if (
      !step ||
      (!shouldAutoAdvanceNote && !shouldAutoSkipLegacyWhatsAppLink) ||
      typeof sessionId !== "string" ||
      !step.id.trim()
    ) {
      break;
    }
    current = await withTimeout(
      state.client.request<WizardNextResult>("wizard.next", {
        sessionId,
        answer: {
          stepId: step.id,
          ...(shouldAutoSkipLegacyWhatsAppLink ? { value: false } : {}),
        },
      }),
      CHANNEL_SETUP_REQUEST_TIMEOUT_MS,
      t("alisio.channels.setupTimeout"),
    );
    sessionId = state.channelsSetupSessionId ?? sessionId;
  }
  return current;
}

async function cancelCompetingOnboardingWizard(state: ChannelsState) {
  if (!state.client || !state.connected) {
    return false;
  }
  const onboardingSessionId = state.setupWizardSessionId?.trim();
  if (!onboardingSessionId) {
    return false;
  }
  try {
    await state.client.request<WizardStatusResult>("wizard.cancel", {
      sessionId: onboardingSessionId,
    });
    clearOnboardingWizardState(state);
    return true;
  } catch {
    return false;
  }
}

async function resumeChannelSetup(
  state: ChannelsState,
  wizard: { sessionId: string; channelId: string | null },
) {
  if (!state.client || !state.connected) {
    return false;
  }
  setSetupLoading(state, true);
  setSetupError(state, null);
  setSetupSessionId(state, wizard.sessionId);
  if (wizard.channelId) {
    setSetupChannelId(state, wizard.channelId);
  }
  try {
    const nextResult = await withTimeout(
      state.client.request<WizardNextResult>("wizard.next", {
        sessionId: wizard.sessionId,
      }),
      CHANNEL_SETUP_REQUEST_TIMEOUT_MS,
      t("alisio.channels.setupTimeout"),
    );
    const result = await advanceChannelSetupPastPassiveSteps(state, nextResult);
    const terminal = applySetupResult(state, result, wizard.sessionId);
    if (terminal.terminal) {
      await finalizeChannelSetup(state, terminal);
    }
    return true;
  } catch (err) {
    setSetupError(state, getErrorMessage(err));
    return false;
  } finally {
    setSetupLoading(state, false);
  }
}

async function recoverRunningChannelSetup(state: ChannelsState) {
  await loadChannels(state, true, { resumeWizard: false });
  const runningWizard = readRunningChannelWizard(state.channelsSnapshot);
  if (!runningWizard) {
    return false;
  }
  return await resumeChannelSetup(state, runningWizard);
}

async function finalizeChannelSetup(
  state: ChannelsState,
  info: { channelId: string | null; status: string | null },
) {
  await loadChannels(state, true);
  if (info.status === "done") {
    const restartingGateway = isExpectedGatewayRestartMessage(state.channelsError);
    if (restartingGateway) {
      state.channelsError = null;
    }
    const defaultAccount = findChannelDefaultAccount(state.channelsSnapshot, info.channelId);
    setActionMessage(
      state,
      restartingGateway
        ? t("alisio.channels.setupRestarting")
        : info.channelId === "whatsapp"
          ? t("alisio.channels.setupSavedQr")
          : info.channelId === "telegram" && defaultAccount?.dmOnboardingState
            ? t("alisio.channels.setupSavedTelegram")
            : t("alisio.channels.setupSaved"),
    );
    if (info.channelId === "whatsapp") {
      clearWhatsAppLoginState(state);
    }
  }
  if (info.status !== "running") {
    setSetupChannelId(state, null);
  }
}

export async function startChannelSetup(state: ChannelsState, channelId: string) {
  if (
    !state.client ||
    !state.connected ||
    state.channelsSetupLoading ||
    state.channelsSetupSubmitting
  ) {
    return;
  }
  setSetupLoading(state, true);
  setSetupChannelId(state, channelId);
  setSetupError(state, null);
  try {
    await cancelCompetingOnboardingWizard(state);
    const startResult = await withTimeout(
      state.client.request<WizardStartResult>("wizard.start", {
        surface: "channel",
        channel: channelId,
      }),
      CHANNEL_SETUP_REQUEST_TIMEOUT_MS,
      t("alisio.channels.setupTimeout"),
    );
    const result = await advanceChannelSetupPastPassiveSteps(state, startResult);
    const terminal = applySetupResult(state, result);
    if (terminal.terminal) {
      await finalizeChannelSetup(state, terminal);
    }
  } catch (err) {
    if (isRequestTimeoutError(err) || isWizardAlreadyRunningError(err)) {
      const cancelledOnboarding = await cancelCompetingOnboardingWizard(state);
      if (cancelledOnboarding) {
        try {
          const retriedStart = await withTimeout(
            state.client.request<WizardStartResult>("wizard.start", {
              surface: "channel",
              channel: channelId,
            }),
            CHANNEL_SETUP_REQUEST_TIMEOUT_MS,
            t("alisio.channels.setupTimeout"),
          );
          const advanced = await advanceChannelSetupPastPassiveSteps(state, retriedStart);
          const terminal = applySetupResult(state, advanced);
          if (terminal.terminal) {
            await finalizeChannelSetup(state, terminal);
          }
          return;
        } catch {
          // Fall through to wizard recovery below.
        }
      }
      const recovered = await recoverRunningChannelSetup(state);
      if (recovered) {
        return;
      }
    }
    setSetupError(state, getErrorMessage(err));
  } finally {
    setSetupLoading(state, false);
  }
}

export async function continueChannelSetup(
  state: ChannelsState,
  answer?: { stepId: string; value?: unknown },
) {
  if (!state.client || !state.connected || state.channelsSetupSubmitting) {
    return;
  }
  const sessionId = state.channelsSetupSessionId ?? null;
  if (!sessionId) {
    const channelId = state.channelsSetupChannelId?.trim();
    if (channelId) {
      await startChannelSetup(state, channelId);
    }
    return;
  }
  setSetupSubmitting(state, true);
  setSetupError(state, null);
  try {
    const nextResult = await withTimeout(
      state.client.request<WizardNextResult>("wizard.next", {
        sessionId,
        ...(answer ? { answer } : {}),
      }),
      CHANNEL_SETUP_REQUEST_TIMEOUT_MS,
      t("alisio.channels.setupTimeout"),
    );
    const shouldAdvancePassiveSteps =
      !state.channelsSetupStep ||
      state.channelsSetupStep.type === "note" ||
      state.channelsSetupStep.type === "action";
    const result = shouldAdvancePassiveSteps
      ? await advanceChannelSetupPastPassiveSteps(state, nextResult)
      : nextResult;
    const terminal = applySetupResult(state, result, sessionId);
    if (terminal.terminal) {
      await finalizeChannelSetup(state, terminal);
    }
  } catch (err) {
    setSetupError(state, getErrorMessage(err));
  } finally {
    setSetupSubmitting(state, false);
  }
}

export async function cancelChannelSetup(state: ChannelsState) {
  if (!state.client || !state.connected || !state.channelsSetupSessionId) {
    return;
  }
  setSetupSubmitting(state, true);
  setSetupError(state, null);
  try {
    const sessionId = state.channelsSetupSessionId;
    const result = await state.client.request<WizardStatusResult>("wizard.cancel", { sessionId });
    const terminal = applySetupResult(state, result, null);
    if (terminal.terminal) {
      await finalizeChannelSetup(state, terminal);
    }
  } catch (err) {
    setSetupError(state, getErrorMessage(err));
  } finally {
    setSetupSubmitting(state, false);
  }
}

export async function startWebChannelLogin(
  state: ChannelsState,
  opts?: { force?: boolean; accountId?: string; autoWait?: boolean },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const accountId = normalizeChannelAccountId(opts?.accountId ?? state.channelsLoginAccountId);
  if (
    hasBusyChannelAction(state, {
      channelId: "whatsapp",
      accountId,
      actions: ["login-start", "login-wait"],
    })
  ) {
    return;
  }
  const busyKey = makeChannelBusyKey({
    channelId: "whatsapp",
    action: "login-start",
    accountId,
  });
  setBusyKey(state, busyKey);
  setLoginAccountId(state, accountId);
  state.channelsError = null;
  try {
    const result = await state.client.request<WebLoginStartResult>("web.login.start", {
      force: Boolean(opts?.force),
      timeoutMs: 30_000,
      ...(opts?.accountId?.trim() ? { accountId: opts.accountId.trim() } : {}),
    });
    const resolvedAccountId = result.accountId?.trim() || accountId;
    setActionMessage(state, result.message?.trim() || null);
    setLoginQrDataUrl(state, result.qrDataUrl?.trim() || null);
    setLoginAccountId(state, result.qrDataUrl?.trim() ? resolvedAccountId : null);
    await loadChannels(state, true);
    if ((opts?.autoWait ?? true) && result.qrDataUrl) {
      if (state.channelsBusyKey === busyKey) {
        setBusyKey(state, null);
      }
      void waitWebChannelLogin(state, { accountId: resolvedAccountId });
    }
  } catch (err) {
    clearWhatsAppLoginState(state);
    state.channelsError = getErrorMessage(err);
  } finally {
    if (state.channelsBusyKey === busyKey) {
      setBusyKey(state, null);
    }
  }
}

export async function waitWebChannelLogin(
  state: ChannelsState,
  opts?: { accountId?: string; timeoutMs?: number },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const accountId = normalizeChannelAccountId(opts?.accountId ?? state.channelsLoginAccountId);
  if (
    hasBusyChannelAction(state, {
      channelId: "whatsapp",
      accountId,
      actions: ["login-start", "login-wait"],
    })
  ) {
    return;
  }
  const busyKey = makeChannelBusyKey({
    channelId: "whatsapp",
    action: "login-wait",
    accountId,
  });
  setBusyKey(state, busyKey);
  setLoginAccountId(state, accountId);
  state.channelsError = null;
  try {
    const result = await state.client.request<WebLoginWaitResult>("web.login.wait", {
      timeoutMs: opts?.timeoutMs ?? 120_000,
      ...(opts?.accountId?.trim() || state.channelsLoginAccountId?.trim()
        ? { accountId: opts?.accountId?.trim() || state.channelsLoginAccountId?.trim() }
        : {}),
    });
    setActionMessage(state, result.message?.trim() || null);
    const connected = typeof result.connected === "boolean" ? result.connected : false;
    if (connected) {
      clearWhatsAppLoginState(state);
    } else if (!state.channelsLoginAccountId && result.accountId?.trim()) {
      setLoginAccountId(state, result.accountId.trim());
    }
    await loadChannels(state, true);
  } catch (err) {
    clearWhatsAppLoginState(state);
    state.channelsError = getErrorMessage(err);
  } finally {
    if (state.channelsBusyKey === busyKey) {
      setBusyKey(state, null);
    }
  }
}

function formatLogoutMessage(_channelId: string, result: ChannelLogoutResult) {
  if (result.envToken) {
    return t("alisio.channels.logoutMessages.envToken");
  }
  if (result.cleared) {
    return t("alisio.channels.logoutMessages.cleared");
  }
  return t("alisio.channels.logoutMessages.missing");
}

export async function logoutChannelAccount(
  state: ChannelsState,
  params: { channelId: string; accountId?: string | null },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (
    hasBusyChannelAction(state, {
      channelId: params.channelId,
      accountId: params.accountId,
      actions: ["logout"],
    })
  ) {
    return;
  }
  const busyKey = makeChannelBusyKey({
    channelId: params.channelId,
    action: "logout",
    accountId: params.accountId,
  });
  setBusyKey(state, busyKey);
  state.channelsError = null;
  try {
    const result = await state.client.request<ChannelLogoutResult>("channels.logout", {
      channel: params.channelId,
      ...(params.accountId?.trim() ? { accountId: params.accountId.trim() } : {}),
    });
    setActionMessage(state, formatLogoutMessage(params.channelId, result));
    if (params.channelId === "whatsapp") {
      clearWhatsAppLoginState(state);
    }
    await loadChannels(state, true);
  } catch (err) {
    state.channelsError = getErrorMessage(err);
  } finally {
    if (state.channelsBusyKey === busyKey) {
      setBusyKey(state, null);
    }
  }
}

export async function approveChannelPairingRequest(
  state: ChannelsState,
  params: { channelId: string; accountId?: string | null; requestId: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (
    hasBusyChannelAction(state, {
      channelId: params.channelId,
      accountId: params.accountId,
      actions: ["pairing-approve"],
    })
  ) {
    return;
  }
  const busyKey = makeChannelBusyKey({
    channelId: params.channelId,
    action: "pairing-approve",
    accountId: params.accountId,
  });
  setBusyKey(state, busyKey);
  state.channelsError = null;
  try {
    await state.client.request<ChannelPairingResult>("channels.pairing.approve", {
      channel: params.channelId,
      requestId: params.requestId,
      ...(params.accountId?.trim() ? { accountId: params.accountId.trim() } : {}),
    });
    setActionMessage(
      state,
      params.channelId === "telegram"
        ? t("alisio.channels.pairing.approvedTelegram")
        : t("alisio.channels.pairing.approved"),
    );
    await loadChannels(state, true);
  } catch (err) {
    state.channelsError = getErrorMessage(err);
  } finally {
    if (state.channelsBusyKey === busyKey) {
      setBusyKey(state, null);
    }
  }
}

export async function rejectChannelPairingRequest(
  state: ChannelsState,
  params: { channelId: string; accountId?: string | null; requestId: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (
    hasBusyChannelAction(state, {
      channelId: params.channelId,
      accountId: params.accountId,
      actions: ["pairing-reject"],
    })
  ) {
    return;
  }
  const confirmed = window.confirm(t("alisio.channels.pairing.rejectConfirm"));
  if (!confirmed) {
    return;
  }
  const busyKey = makeChannelBusyKey({
    channelId: params.channelId,
    action: "pairing-reject",
    accountId: params.accountId,
  });
  setBusyKey(state, busyKey);
  state.channelsError = null;
  try {
    await state.client.request<ChannelPairingResult>("channels.pairing.reject", {
      channel: params.channelId,
      requestId: params.requestId,
      ...(params.accountId?.trim() ? { accountId: params.accountId.trim() } : {}),
    });
    setActionMessage(state, t("alisio.channels.pairing.rejected"));
    await loadChannels(state, true);
  } catch (err) {
    state.channelsError = getErrorMessage(err);
  } finally {
    if (state.channelsBusyKey === busyKey) {
      setBusyKey(state, null);
    }
  }
}
