import { t } from "../../i18n/index.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ConfigSnapshot, SkillStatusEntry, SkillStatusReport } from "../types.ts";

export type SkillMarketplaceAction = "install" | "remove" | "execute";

export type SkillActionOutput = {
  title: string;
  text: string;
};

export type SkillConsentRequest = {
  skillKey: string;
  skillName: string;
  action: SkillMarketplaceAction;
  title: string;
  description: string;
  permissions?: SkillStatusEntry["permissions"];
  outputs?: SkillStatusEntry["outputs"];
};

export type SkillsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  configFormDirty?: boolean;
  skillsLoading: boolean;
  skillsReport: SkillStatusReport | null;
  skillsError: string | null;
  skillsBusyKey: string | null;
  skillEdits: Record<string, string>;
  skillMessages: SkillMessageMap;
  skillActionOutputs: Record<string, SkillActionOutput>;
  skillConsentRequest: SkillConsentRequest | null;
};

export type SkillMessage = {
  kind: "success" | "error";
  message: string;
};

export type SkillMessageMap = Record<string, SkillMessage>;

type LoadSkillsOptions = {
  clearMessages?: boolean;
};

function setSkillMessage(state: SkillsState, key: string, message?: SkillMessage) {
  if (!key.trim()) {
    return;
  }
  const next = { ...state.skillMessages };
  if (message) {
    next[key] = message;
  } else {
    delete next[key];
  }
  state.skillMessages = next;
}

function clearSkillEdit(state: SkillsState, key: string) {
  if (!Object.hasOwn(state.skillEdits, key)) {
    return;
  }
  const next = { ...state.skillEdits };
  delete next[key];
  state.skillEdits = next;
}

export function skillEnvEditKey(skillKey: string, envName: string) {
  return `${skillKey}::env::${envName}`;
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function findMarketplaceSkill(state: SkillsState, skillKey: string): SkillStatusEntry | null {
  const catalog = state.skillsReport?.marketplaceCatalog ?? [];
  return catalog.find((entry) => entry.skillKey === skillKey || entry.name === skillKey) ?? null;
}

export async function loadSkills(state: SkillsState, options?: LoadSkillsOptions) {
  if (options?.clearMessages && Object.keys(state.skillMessages).length > 0) {
    state.skillMessages = {};
  }
  if (!state.client || !state.connected) {
    return;
  }
  if (state.skillsLoading) {
    return;
  }
  state.skillsLoading = true;
  state.skillsError = null;
  try {
    const res = await state.client.request<SkillStatusReport | undefined>("skills.status", {});
    if (res) {
      state.skillsReport = res;
      if (
        state.skillConsentRequest &&
        !(res.marketplaceCatalog ?? []).some(
          (entry) => entry.skillKey === state.skillConsentRequest?.skillKey,
        )
      ) {
        state.skillConsentRequest = null;
      }
    }
  } catch (err) {
    state.skillsError = getErrorMessage(err);
  } finally {
    state.skillsLoading = false;
  }
}

export function updateSkillEdit(state: SkillsState, skillKey: string, value: string) {
  state.skillEdits = { ...state.skillEdits, [skillKey]: value };
  setSkillMessage(state, skillKey);
}

export function updateSkillEnvEdit(
  state: SkillsState,
  skillKey: string,
  envName: string,
  value: string,
) {
  state.skillEdits = {
    ...state.skillEdits,
    [skillEnvEditKey(skillKey, envName)]: value,
  };
  setSkillMessage(state, skillKey);
}

function resolveSkillSuccessMessage(
  state: SkillsState,
  skillKey: string,
  kind: "save" | "install" | "update",
): string {
  const skill = state.skillsReport?.skills.find((entry) => entry.skillKey === skillKey);
  if (!skill) {
    return t(
      kind === "install"
        ? "alisio.capabilities.messages.installed"
        : kind === "update"
          ? "alisio.capabilities.messages.updated"
          : "alisio.capabilities.messages.saved",
    );
  }
  if (skill.eligible) {
    return t(
      kind === "install"
        ? "alisio.capabilities.messages.installed"
        : kind === "update"
          ? "alisio.capabilities.messages.updated"
          : "alisio.capabilities.messages.saved",
    );
  }
  return t(
    kind === "install"
      ? "alisio.capabilities.messages.installedPartial"
      : kind === "update"
        ? "alisio.capabilities.messages.updatedPartial"
        : "alisio.capabilities.messages.savedPartial",
  );
}

async function fetchConfigSnapshot(state: SkillsState): Promise<ConfigSnapshot | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  return state.client.request<ConfigSnapshot>("config.get", {});
}

function readBundledSkillAllowList(snapshot: ConfigSnapshot): string[] {
  const skillsConfig = snapshot.config?.skills;
  if (!skillsConfig || typeof skillsConfig !== "object") {
    return [];
  }
  const allowBundled = (skillsConfig as { allowBundled?: unknown }).allowBundled;
  if (!Array.isArray(allowBundled)) {
    return [];
  }
  return allowBundled.filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
}

function buildConfigPatch(pathStr: string, value: unknown): Record<string, unknown> {
  const segments = pathStr
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  const root: Record<string, unknown> = {};
  let cursor: Record<string, unknown> = root;
  for (const [index, segment] of segments.entries()) {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      continue;
    }
    const next: Record<string, unknown> = {};
    cursor[segment] = next;
    cursor = next;
  }
  return root;
}

async function patchSkillConfig(
  state: SkillsState,
  skillKey: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  if (state.configFormDirty) {
    const message = t("alisio.capabilities.messages.configDraftDirty");
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
    return false;
  }
  const snapshot = await fetchConfigSnapshot(state);
  if (!snapshot?.hash) {
    const message = "Config hash missing; reload and retry.";
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
    return false;
  }
  await state.client.request("config.patch", {
    raw: JSON.stringify(patch),
    baseHash: snapshot.hash,
  });
  return true;
}

export async function updateSkillEnabled(state: SkillsState, skillKey: string, enabled: boolean) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsBusyKey = skillKey;
  state.skillsError = null;
  try {
    await state.client.request("skills.update", { skillKey, enabled });
    await loadSkills(state);
    setSkillMessage(state, skillKey, {
      kind: "success",
      message: enabled
        ? t("alisio.capabilities.messages.enabled")
        : t("alisio.capabilities.messages.disabled"),
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
  } finally {
    state.skillsBusyKey = null;
  }
}

export async function saveSkillApiKey(state: SkillsState, skillKey: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsBusyKey = skillKey;
  state.skillsError = null;
  try {
    const apiKey = state.skillEdits[skillKey] ?? "";
    await state.client.request("skills.update", { skillKey, apiKey });
    await loadSkills(state);
    clearSkillEdit(state, skillKey);
    setSkillMessage(state, skillKey, {
      kind: "success",
      message: resolveSkillSuccessMessage(state, skillKey, "save"),
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
  } finally {
    state.skillsBusyKey = null;
  }
}

export async function saveSkillEnv(state: SkillsState, skillKey: string, envName: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const editKey = skillEnvEditKey(skillKey, envName);
  state.skillsBusyKey = skillKey;
  state.skillsError = null;
  try {
    const value = state.skillEdits[editKey] ?? "";
    await state.client.request("skills.update", {
      skillKey,
      env: {
        [envName]: value,
      },
    });
    await loadSkills(state);
    clearSkillEdit(state, editKey);
    setSkillMessage(state, skillKey, {
      kind: "success",
      message: resolveSkillSuccessMessage(state, skillKey, "save"),
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
  } finally {
    state.skillsBusyKey = null;
  }
}

export async function enableSkillConfigPath(
  state: SkillsState,
  skillKey: string,
  configPath: string,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsBusyKey = skillKey;
  state.skillsError = null;
  try {
    const patched = await patchSkillConfig(state, skillKey, buildConfigPatch(configPath, true));
    if (!patched) {
      return;
    }
    await loadSkills(state);
    setSkillMessage(state, skillKey, {
      kind: "success",
      message: resolveSkillSuccessMessage(state, skillKey, "update"),
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
  } finally {
    state.skillsBusyKey = null;
  }
}

export async function allowBundledSkill(state: SkillsState, skillKey: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsBusyKey = skillKey;
  state.skillsError = null;
  try {
    if (state.configFormDirty) {
      const message = t("alisio.capabilities.messages.configDraftDirty");
      state.skillsError = message;
      setSkillMessage(state, skillKey, {
        kind: "error",
        message,
      });
      return;
    }
    const snapshot = await fetchConfigSnapshot(state);
    if (!snapshot?.hash) {
      const message = "Config hash missing; reload and retry.";
      state.skillsError = message;
      setSkillMessage(state, skillKey, {
        kind: "error",
        message,
      });
      return;
    }
    const currentAllowBundled = readBundledSkillAllowList(snapshot);
    const nextAllowBundled = Array.from(new Set([...currentAllowBundled, skillKey]));
    await state.client.request("config.patch", {
      raw: JSON.stringify({
        skills: {
          allowBundled: nextAllowBundled,
        },
      }),
      baseHash: snapshot.hash,
    });
    await loadSkills(state);
    setSkillMessage(state, skillKey, {
      kind: "success",
      message: resolveSkillSuccessMessage(state, skillKey, "update"),
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
  } finally {
    state.skillsBusyKey = null;
  }
}

export async function installSkill(
  state: SkillsState,
  skillKey: string,
  name: string,
  installId: string,
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsBusyKey = skillKey;
  state.skillsError = null;
  try {
    const result = await state.client.request<{ message?: string }>("skills.install", {
      name,
      installId,
      timeoutMs: 120000,
    });
    await loadSkills(state);
    const installerMessage = result?.message?.trim();
    const resolvedMessage = resolveSkillSuccessMessage(state, skillKey, "install");
    setSkillMessage(state, skillKey, {
      kind: "success",
      message:
        installerMessage && installerMessage !== "Installed"
          ? `${installerMessage}. ${resolvedMessage}`
          : resolvedMessage,
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillMessage(state, skillKey, {
      kind: "error",
      message,
    });
  } finally {
    state.skillsBusyKey = null;
  }
}

type MarketplaceActionResponse =
  | {
      status: "consent-required";
      action: SkillMarketplaceAction;
      skillName: string;
      request: {
        title: string;
        description: string;
        permissions?: SkillStatusEntry["permissions"];
        outputs?: SkillStatusEntry["outputs"];
      };
    }
  | {
      status: "denied";
      action: SkillMarketplaceAction;
      skillName: string;
      message: string;
    }
  | {
      status: "completed";
      action: "install" | "remove";
      skillName: string;
      message?: string;
    }
  | {
      status: "completed";
      action: "execute";
      skillName: string;
      message?: string;
      instructions?: string;
      mcp?: {
        serverName: string;
        toolCount: number;
        promptCount: number;
        resourceCount: number;
      };
    };

type MarketplaceCompletedActionResponse = Extract<
  MarketplaceActionResponse,
  { status: "completed" }
>;

function resolveMarketplaceMethod(action: SkillMarketplaceAction): string {
  return `skills.marketplace.${action}`;
}

function resolveMarketplaceSuccessMessage(
  action: SkillMarketplaceAction,
  result: MarketplaceCompletedActionResponse,
): string {
  if (result.message?.trim()) {
    return result.message.trim();
  }
  switch (action) {
    case "install":
      return "Installed.";
    case "remove":
      return "Removed.";
    case "execute":
    default:
      return "Loaded skill output.";
  }
}

function formatMarketplaceExecutionOutput(
  result: Extract<MarketplaceCompletedActionResponse, { action: "execute" }>,
): SkillActionOutput | null {
  if (typeof result.instructions === "string" && result.instructions.trim()) {
    return {
      title: result.mcp?.serverName ? `MCP: ${result.skillName}` : result.skillName,
      text: result.instructions,
    };
  }
  return null;
}

async function runMarketplaceAction(
  state: SkillsState,
  skill: SkillStatusEntry,
  action: SkillMarketplaceAction,
  consentDecision?: "allow-once" | "allow-always" | "deny",
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillsBusyKey = skill.skillKey;
  state.skillsError = null;
  try {
    const result = await state.client.request<MarketplaceActionResponse>(
      resolveMarketplaceMethod(action),
      {
        name: skill.name,
        ...(consentDecision ? { consentDecision } : {}),
      },
    );

    if (result.status === "consent-required") {
      state.skillConsentRequest = {
        skillKey: skill.skillKey,
        skillName: skill.name,
        action,
        title: result.request.title,
        description: result.request.description,
        permissions: result.request.permissions,
        outputs: result.request.outputs,
      };
      return;
    }

    state.skillConsentRequest = null;

    if (result.status === "denied") {
      setSkillMessage(state, skill.skillKey, {
        kind: "error",
        message: result.message,
      });
      return;
    }

    if (action === "execute") {
      const output = formatMarketplaceExecutionOutput(
        result as Extract<MarketplaceCompletedActionResponse, { action: "execute" }>,
      );
      if (output) {
        state.skillActionOutputs = {
          ...state.skillActionOutputs,
          [skill.skillKey]: output,
        };
      }
    }

    await loadSkills(state);
    setSkillMessage(state, skill.skillKey, {
      kind: "success",
      message: resolveMarketplaceSuccessMessage(action, result),
    });
  } catch (err) {
    const message = getErrorMessage(err);
    state.skillsError = message;
    setSkillMessage(state, skill.skillKey, {
      kind: "error",
      message,
    });
  } finally {
    state.skillsBusyKey = null;
  }
}

export async function executeMarketplaceSkillAction(state: SkillsState, skillKey: string) {
  const skill = findMarketplaceSkill(state, skillKey);
  if (!skill) {
    return;
  }
  await runMarketplaceAction(state, skill, "execute");
}

export async function installMarketplaceSkillAction(state: SkillsState, skillKey: string) {
  const skill = findMarketplaceSkill(state, skillKey);
  if (!skill) {
    return;
  }
  await runMarketplaceAction(state, skill, "install");
}

export async function removeMarketplaceSkillAction(state: SkillsState, skillKey: string) {
  const skill = findMarketplaceSkill(state, skillKey);
  if (!skill) {
    return;
  }
  await runMarketplaceAction(state, skill, "remove");
}

export async function resolveSkillConsentRequest(
  state: SkillsState,
  decision: "allow-once" | "allow-always" | "deny",
) {
  const request = state.skillConsentRequest;
  if (!request) {
    return;
  }
  const skill = findMarketplaceSkill(state, request.skillKey);
  if (!skill) {
    state.skillConsentRequest = null;
    return;
  }
  await runMarketplaceAction(state, skill, request.action, decision);
}

export function dismissSkillConsentRequest(state: SkillsState) {
  state.skillConsentRequest = null;
}
