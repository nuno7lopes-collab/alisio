import { html, nothing } from "lit";
import type {
  AgentsListResult,
  AttentionItem,
  ChannelsStatusSnapshot,
  CronJob,
  CronStatus,
  SessionsListResult,
} from "../types.ts";
import { countConnectedChannelAccounts } from "./channel-display.ts";

function findDefaultAgent(agentsList: AgentsListResult | null) {
  if (!agentsList) {
    return null;
  }
  return (
    agentsList.agents.find((entry) => entry.id === agentsList.defaultId) ??
    agentsList.agents[0] ??
    null
  );
}

function countConnectedChannels(snapshot: ChannelsStatusSnapshot | null): number {
  return countConnectedChannelAccounts(snapshot);
}

export function renderHome(props: {
  connected: boolean;
  agentsList: AgentsListResult | null;
  sessionsResult: SessionsListResult | null;
  cronStatus: CronStatus | null;
  cronJobs: CronJob[];
  channelsSnapshot: ChannelsStatusSnapshot | null;
  attentionItems: AttentionItem[];
  onNavigate: (tab: "chat" | "authentications" | "automations" | "agents" | "sessions") => void;
}) {
  const defaultAgent = findDefaultAgent(props.agentsList);
  const person = defaultAgent?.person;
  const priorities = person?.profile.priorities ?? [];
  const routines = person?.profile.routines ?? [];
  const sessionsCount = props.sessionsResult?.count ?? props.sessionsResult?.sessions?.length ?? 0;
  const connectedChannels = countConnectedChannels(props.channelsSnapshot);
  const nextAutomation = props.cronStatus?.nextWakeAtMs
    ? new Date(props.cronStatus.nextWakeAtMs).toLocaleString()
    : "No wake scheduled";

  return html`
    <section class="grid">
      <div class="card">
        <div class="card-title">Alisio Workspace</div>
        <div class="card-sub">
          ${props.connected
            ? "One surface for your person agent, sessions, authentications, and automations."
            : "Connect to the gateway to hydrate the person agent workspace."}
        </div>
        <div class="agents-overview-grid" style="margin-top: 16px;">
          <div class="agent-kv">
            <div class="label">Person Agent</div>
            <div>${person?.profile.name ?? defaultAgent?.name ?? "Not configured yet"}</div>
            <div class="agent-kv-sub">
              ${person
                ? `${person.autonomyMode} autonomy · ${person.starterPack} starter pack`
                : "Enable a person agent to turn this into your main operating layer."}
            </div>
          </div>
          <div class="agent-kv">
            <div class="label">Sessions</div>
            <div>${sessionsCount}</div>
            <div class="agent-kv-sub">${connectedChannels} connected channel accounts</div>
          </div>
          <div class="agent-kv">
            <div class="label">Automations</div>
            <div>${props.cronJobs.length}</div>
            <div class="agent-kv-sub">${nextAutomation}</div>
          </div>
          <div class="agent-kv">
            <div class="label">Connected Accounts</div>
            <div>${person?.connectedAccounts.totalProfiles ?? 0}</div>
            <div class="agent-kv-sub">
              ${person?.connectedAccounts.providers.length
                ? person.connectedAccounts.providers.join(" · ")
                : "Browser-first mode works without OAuth."}
            </div>
          </div>
        </div>
        <div class="row" style="margin-top: 18px; gap: 10px; flex-wrap: wrap;">
          <button class="btn" @click=${() => props.onNavigate("chat")}>Open Chat</button>
          <button class="btn" @click=${() => props.onNavigate("authentications")}>
            Review Apps
          </button>
          <button class="btn" @click=${() => props.onNavigate("automations")}>
            Open Automations
          </button>
          <button class="btn" @click=${() => props.onNavigate("agents")}>Inspect Agents</button>
        </div>
      </div>

      ${person
        ? html`
            <div class="card">
              <div class="card-title">Person Agent</div>
              <div class="card-sub">
                ${person.scope.replaceAll("_", " ")} scope with ${person.specialists.length}
                specialists.
              </div>
              <div class="agents-overview-grid" style="margin-top: 16px;">
                <div class="agent-kv">
                  <div class="label">Today</div>
                  <div>${priorities.join(" · ") || "No priorities yet"}</div>
                  <div class="agent-kv-sub">${routines.join(" · ") || "No routines yet"}</div>
                </div>
                <div class="agent-kv">
                  <div class="label">Memory</div>
                  <div>${person.memoryScopes.join(" · ")}</div>
                  <div class="agent-kv-sub">${person.profile.timezone}</div>
                </div>
                <div class="agent-kv">
                  <div class="label">Drafts</div>
                  <div>${person.artifactTypes.join(" · ")}</div>
                  <div class="agent-kv-sub">Everything stays draft-first until approved.</div>
                </div>
              </div>
            </div>
          `
        : nothing}

      <div class="card">
        <div class="card-title">Attention</div>
        <div class="card-sub">Current issues worth reviewing before delegation expands.</div>
        ${props.attentionItems.length === 0
          ? html`<div class="empty-state" style="margin-top: 16px;">
              No urgent items right now.
            </div>`
          : html`
              <div style="display: grid; gap: 12px; margin-top: 16px;">
                ${props.attentionItems.slice(0, 5).map(
                  (item) => html`
                    <div class="list-item">
                      <div class="list-title">${item.title}</div>
                      <div class="list-sub">${item.description}</div>
                    </div>
                  `,
                )}
              </div>
            `}
      </div>
    </section>
  `;
}
