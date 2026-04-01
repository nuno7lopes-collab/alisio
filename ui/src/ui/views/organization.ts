import { html } from "lit";
import type { ChannelsStatusSnapshot, PresenceEntry, SessionsListResult } from "../types.ts";

function connectedAccounts(snapshot: ChannelsStatusSnapshot | null) {
  if (!snapshot) {
    return [];
  }
  return snapshot.channelOrder.flatMap((channelId) =>
    (snapshot.channelAccounts[channelId] ?? [])
      .filter((account) => account.connected || account.running || account.configured)
      .map((account) => ({ channelId, account })),
  );
}

export function renderOrganization(props: {
  channelsSnapshot: ChannelsStatusSnapshot | null;
  presenceEntries: PresenceEntry[];
  sessionsResult: SessionsListResult | null;
}) {
  const accounts = connectedAccounts(props.channelsSnapshot);
  const activePresence = props.presenceEntries.length;
  const sessionsCount = props.sessionsResult?.count ?? props.sessionsResult?.sessions?.length ?? 0;

  return html`
    <section class="grid">
      <div class="card">
        <div class="card-title">Organization Surface</div>
        <div class="card-sub">
          Live workspace systems, delivery edges, and operational state from the gateway.
        </div>
        <div class="agents-overview-grid" style="margin-top: 16px;">
          <div class="agent-kv">
            <div class="label">Channels</div>
            <div>${props.channelsSnapshot?.channelOrder.length ?? 0}</div>
            <div class="agent-kv-sub">${accounts.length} configured delivery accounts</div>
          </div>
          <div class="agent-kv">
            <div class="label">Instances</div>
            <div>${activePresence}</div>
            <div class="agent-kv-sub">Clients and nodes visible in the current presence window</div>
          </div>
          <div class="agent-kv">
            <div class="label">Sessions</div>
            <div>${sessionsCount}</div>
            <div class="agent-kv-sub">Shared runtime context available to the workspace</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Delivery Accounts</div>
        <div class="card-sub">
          The organization layer now reads directly from the gateway snapshot.
        </div>
        ${accounts.length === 0
          ? html`<div class="empty-state" style="margin-top: 16px;">
              No delivery accounts connected yet.
            </div>`
          : html`
              <div style="display: grid; gap: 12px; margin-top: 16px;">
                ${accounts.slice(0, 12).map(
                  ({ channelId, account }) => html`
                    <div class="list-item">
                      <div class="list-title">${account.name ?? account.accountId}</div>
                      <div class="list-sub">
                        ${channelId} ·
                        ${account.connected
                          ? "connected"
                          : account.running
                            ? "running"
                            : "configured"}
                        ${account.lastError ? ` · ${account.lastError}` : ""}
                      </div>
                    </div>
                  `,
                )}
              </div>
            `}
      </div>

      <div class="card">
        <div class="card-title">Presence</div>
        <div class="card-sub">Instances currently reporting into the workspace.</div>
        ${props.presenceEntries.length === 0
          ? html`<div class="empty-state" style="margin-top: 16px;">
              No active instances reported.
            </div>`
          : html`
              <div style="display: grid; gap: 12px; margin-top: 16px;">
                ${props.presenceEntries.slice(0, 10).map(
                  (entry) => html`
                    <div class="list-item">
                      <div class="list-title">${entry.instanceId ?? entry.host ?? "instance"}</div>
                      <div class="list-sub">
                        ${entry.platform ?? "unknown platform"}
                        ${entry.host ? ` · ${entry.host}` : ""}
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
