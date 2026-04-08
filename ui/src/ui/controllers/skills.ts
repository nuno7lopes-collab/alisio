import { t } from "../../i18n/index.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { ConfigSnapshot, SkillStatusReport } from "../types.ts";

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
