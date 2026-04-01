import { html, nothing } from "lit";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ModelCatalogEntry,
} from "../types.ts";
import {
  buildModelOptions,
  normalizeModelValue,
  parseFallbackList,
  resolveAgentConfig,
  resolveModelFallbacks,
  resolveModelLabel,
  resolveModelPrimary,
} from "./agents-utils.ts";
import type { AgentsPanel } from "./agents.ts";

function prettifyKey(value: string): string {
  return value.replaceAll("_", " ");
}

function renderPersonWorkspace(agent: AgentsListResult["agents"][number]) {
  const person = agent.person;
  if (!person) {
    return nothing;
  }
  const priorities = person.profile.priorities ?? [];
  const routines = person.profile.routines ?? [];
  const statusLabel = person.status === "active" ? "Active" : "Suggested";
  const approvalSummary = person.approvalPolicy.requireApprovalFor.map(prettifyKey).join(", ");
  return html`
    <section class="card" style="margin-top: 16px;">
      <div
        style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;"
      >
        <div>
          <div class="card-title">Person Agent Workspace</div>
          <div class="card-sub">
            Personal + work operator with ${person.autonomyMode} autonomy and ${person.starterPack}
            starter pack.
          </div>
        </div>
        <span class="agent-pill ${person.status === "active" ? "" : "warn"}">${statusLabel}</span>
      </div>

      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Today</div>
          <div>${priorities.join(" · ") || "No priorities yet"}</div>
          <div class="agent-kv-sub">Routines: ${routines.join(" · ") || "No routines yet"}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Drafts</div>
          <div>${person.artifactTypes.map(prettifyKey).join(" · ")}</div>
          <div class="agent-kv-sub">Output stays draft-first until approved.</div>
        </div>
        <div class="agent-kv">
          <div class="label">Tasks</div>
          <div>${person.taskIntents.map(prettifyKey).join(" · ")}</div>
          <div class="agent-kv-sub">Scope: ${prettifyKey(person.scope)}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Memory</div>
          <div>${person.memoryScopes.map(prettifyKey).join(" · ")}</div>
          <div class="agent-kv-sub">Timezone: ${person.profile.timezone}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Approvals</div>
          <div>${approvalSummary}</div>
          <div class="agent-kv-sub">
            Free without approval:
            ${person.approvalPolicy.allowWithoutApproval.map(prettifyKey).join(" · ")}
          </div>
        </div>
        <div class="agent-kv">
          <div class="label">Automations</div>
          <div>${person.capabilityLeases.map((lease) => lease.capability).join(" · ")}</div>
          <div class="agent-kv-sub">Automation mutations stay gated in V1.</div>
        </div>
        <div class="agent-kv">
          <div class="label">Connected Accounts</div>
          <div>
            ${person.connectedAccounts.totalProfiles > 0
              ? `${person.connectedAccounts.totalProfiles} linked`
              : "No linked accounts"}
          </div>
          <div class="agent-kv-sub">
            ${person.connectedAccounts.providers.length > 0
              ? person.connectedAccounts.providers.join(" · ")
              : "Browser-first starter pack works without OAuth."}
          </div>
        </div>
      </div>

      <div style="margin-top: 16px;">
        <div class="label">Specialists</div>
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">
          ${person.specialists.map((specialist) => html`<span class="chip">${specialist}</span>`)}
        </div>
      </div>
    </section>
  `;
}

export function renderAgentOverview(params: {
  agent: AgentsListResult["agents"][number];
  basePath: string;
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  modelCatalog: ModelCatalogEntry[];
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onSelectPanel: (panel: AgentsPanel) => void;
}) {
  const {
    agent,
    configForm,
    agentFilesList,
    configLoading,
    configSaving,
    configDirty,
    onConfigReload,
    onConfigSave,
    onModelChange,
    onModelFallbacksChange,
    onSelectPanel,
  } = params;
  const config = resolveAgentConfig(configForm, agent.id);
  const agentModel = agent.model;
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles ||
    config.entry?.workspace ||
    config.defaults?.workspace ||
    agent.workspace ||
    "default";
  const model = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : config.defaults?.model
      ? resolveModelLabel(config.defaults?.model)
      : resolveModelLabel(agentModel);
  const defaultModel = resolveModelLabel(config.defaults?.model ?? agentModel);
  const entryPrimary = resolveModelPrimary(config.entry?.model);
  const defaultPrimary =
    resolveModelPrimary(config.defaults?.model) ||
    (defaultModel !== "-" ? normalizeModelValue(defaultModel) : null) ||
    (configForm ? null : resolveModelPrimary(agentModel));
  const effectivePrimary = entryPrimary ?? defaultPrimary ?? null;
  const modelFallbacks =
    resolveModelFallbacks(config.entry?.model) ??
    resolveModelFallbacks(config.defaults?.model) ??
    (configForm ? null : resolveModelFallbacks(agentModel));
  const fallbackChips = modelFallbacks ?? [];
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  const isDefault = Boolean(params.defaultId && agent.id === params.defaultId);
  const disabled = !configForm || configLoading || configSaving;

  const removeChip = (index: number) => {
    const next = fallbackChips.filter((_, i) => i !== index);
    onModelFallbacksChange(agent.id, next);
  };

  const handleChipKeydown = (e: KeyboardEvent) => {
    const input = e.target as HTMLInputElement;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const parsed = parseFallbackList(input.value);
      if (parsed.length > 0) {
        onModelFallbacksChange(agent.id, [...fallbackChips, ...parsed]);
        input.value = "";
      }
    }
  };

  return html`
    <section class="card">
      <div class="card-title">Overview</div>
      <div class="card-sub">Workspace paths and identity metadata.</div>

      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Workspace</div>
          <div>
            <button
              type="button"
              class="workspace-link mono"
              @click=${() => onSelectPanel("files")}
              title="Open Files tab"
            >
              ${workspace}
            </button>
          </div>
        </div>
        <div class="agent-kv">
          <div class="label">Primary Model</div>
          <div class="mono">${model}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Skills Filter</div>
          <div>${skillFilter ? `${skillCount} selected` : "all skills"}</div>
        </div>
      </div>

      ${configDirty
        ? html`
            <div class="callout warn" style="margin-top: 16px">
              You have unsaved config changes.
            </div>
          `
        : nothing}

      <div class="agent-model-select" style="margin-top: 20px;">
        <div class="label">Model Selection</div>
        <div class="agent-model-fields">
          <label class="field">
            <span>Primary model${isDefault ? " (default)" : ""}</span>
            <select
              .value=${isDefault ? (effectivePrimary ?? "") : (entryPrimary ?? "")}
              ?disabled=${disabled}
              @change=${(e: Event) =>
                onModelChange(agent.id, (e.target as HTMLSelectElement).value || null)}
            >
              ${isDefault
                ? html` <option value="">Not set</option> `
                : html`
                    <option value="">
                      ${defaultPrimary ? `Inherit default (${defaultPrimary})` : "Inherit default"}
                    </option>
                  `}
              ${buildModelOptions(configForm, effectivePrimary ?? undefined, params.modelCatalog)}
            </select>
          </label>
          <div class="field">
            <span>Fallbacks</span>
            <div
              class="agent-chip-input"
              @click=${(e: Event) => {
                const container = e.currentTarget as HTMLElement;
                const input = container.querySelector("input");
                if (input) {
                  input.focus();
                }
              }}
            >
              ${fallbackChips.map(
                (chip, i) => html`
                  <span class="chip">
                    ${chip}
                    <button
                      type="button"
                      class="chip-remove"
                      ?disabled=${disabled}
                      @click=${() => removeChip(i)}
                    >
                      &times;
                    </button>
                  </span>
                `,
              )}
              <input
                ?disabled=${disabled}
                placeholder=${fallbackChips.length === 0 ? "provider/model" : ""}
                @keydown=${handleChipKeydown}
                @blur=${(e: Event) => {
                  const input = e.target as HTMLInputElement;
                  const parsed = parseFallbackList(input.value);
                  if (parsed.length > 0) {
                    onModelFallbacksChange(agent.id, [...fallbackChips, ...parsed]);
                    input.value = "";
                  }
                }}
              />
            </div>
          </div>
        </div>
        <div class="agent-model-actions">
          <button
            type="button"
            class="btn btn--sm"
            ?disabled=${configLoading}
            @click=${onConfigReload}
          >
            Reload Config
          </button>
          <button
            type="button"
            class="btn btn--sm primary"
            ?disabled=${configSaving || !configDirty}
            @click=${onConfigSave}
          >
            ${configSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </section>
    ${renderPersonWorkspace(agent)}
  `;
}
