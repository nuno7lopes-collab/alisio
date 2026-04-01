import { html } from "lit";
import type { AgentsListResult, ChannelsStatusSnapshot } from "../types.ts";

function defaultAgent(agentsList: AgentsListResult | null) {
  if (!agentsList) {
    return null;
  }
  return (
    agentsList.agents.find((entry) => entry.id === agentsList.defaultId) ??
    agentsList.agents[0] ??
    null
  );
}

export function renderAuthentications(props: {
  agentsList: AgentsListResult | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
}) {
  const person = defaultAgent(props.agentsList)?.person;
  const connectedAccountStatus = (() => {
    switch (person?.connectedAccounts.status) {
      case "ok":
        return "Healthy";
      case "expiring":
        return "Expiring";
      case "expired":
        return "Expired";
      case "static":
        return "Static";
      case "missing":
      default:
        return "Missing";
    }
  })();
  const channelRows =
    props.channelsSnapshot?.channelOrder
      .map((channelId) => ({
        channelId,
        accounts: props.channelsSnapshot?.channelAccounts[channelId] ?? [],
      }))
      .filter((entry) => entry.accounts.length > 0) ?? [];

  return html`
    <section class="grid">
      <div class="card">
        <div class="card-title">Person Accounts</div>
        <div class="card-sub">Real account health from the active person agent runtime.</div>
        ${person
          ? html`
              <div class="agents-overview-grid" style="margin-top: 16px;">
                <div class="agent-kv">
                  <div class="label">Profiles</div>
                  <div>${person.connectedAccounts.totalProfiles}</div>
                  <div class="agent-kv-sub">
                    ${person.connectedAccounts.providers.join(" · ") || "None"}
                  </div>
                </div>
                <div class="agent-kv">
                  <div class="label">Status</div>
                  <div>${connectedAccountStatus}</div>
                  <div class="agent-kv-sub">
                    Runtime auth health is derived from the live person-agent bindings.
                  </div>
                </div>
                <div class="agent-kv">
                  <div class="label">Fallback</div>
                  <div>${person.starterPack}</div>
                  <div class="agent-kv-sub">
                    Browser-first remains usable with zero OAuth bindings.
                  </div>
                </div>
              </div>
            `
          : html`
              <div class="empty-state" style="margin-top: 16px;">
                No active person agent bindings yet. The runtime still supports browser-first work
                without OAuth.
              </div>
            `}
      </div>

      <div class="card">
        <div class="card-title">Channel Accounts</div>
        <div class="card-sub">Execution accounts exposed by the live gateway snapshot.</div>
        ${channelRows.length === 0
          ? html`
              <div class="empty-state" style="margin-top: 16px;">
                No channel accounts configured on this gateway.
              </div>
            `
          : html`
              <div style="display: grid; gap: 12px; margin-top: 16px;">
                ${channelRows.map(
                  (row) => html`
                    <div class="list-item">
                      <div class="list-title">${row.channelId}</div>
                      <div class="list-sub">
                        ${row.accounts.length} account${row.accounts.length === 1 ? "" : "s"} ·
                        ${row.accounts
                          .map(
                            (account) =>
                              `${account.name ?? account.accountId} (${account.connected ? "connected" : account.running ? "running" : "configured"})`,
                          )
                          .join(" · ")}
                      </div>
                    </div>
                  `,
                )}
              </div>
            `}
      </div>
    </section>
  `;
}
