import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import { icons } from "../icons.ts";

function buildDeleteTitle(count: number): string {
  return count === 1
    ? t("sessionsView.deleteDialog.titleOne", { count: String(count) })
    : t("sessionsView.deleteDialog.titleMany", { count: String(count) });
}

function buildDeleteBody(count: number): string {
  return count === 1
    ? t("sessionsView.deleteDialog.bodyOne")
    : t("sessionsView.deleteDialog.bodyMany");
}

export function renderSessionDeleteConfirmation(state: AppViewState) {
  const keys = state.sessionDeleteConfirmKeys;
  if (!keys?.length) {
    return nothing;
  }

  const count = keys.length;
  const title = buildDeleteTitle(count);
  return html`
    <div
      class="exec-approval-overlay session-delete-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-delete-title"
      @click=${(event: Event) => {
        if (event.target === event.currentTarget) {
          state.handleSessionDeleteCancel?.();
        }
      }}
    >
      <div class="exec-approval-card session-delete-card">
        <div class="session-delete-card__header">
          <div class="session-delete-card__icon" aria-hidden="true">${icons.trash}</div>
          <div class="session-delete-card__copy">
            <div class="session-delete-card__eyebrow">${t("sessionsView.deleteDialog.eyebrow")}</div>
            <div id="session-delete-title" class="session-delete-card__title">${title}</div>
            <div class="session-delete-card__body">${buildDeleteBody(count)}</div>
          </div>
        </div>
        <div class="session-delete-card__meta">
          <span class="session-delete-card__count">${count}</span>
          <span class="session-delete-card__meta-text">${t("sessionsView.deleteDialog.meta")}</span>
        </div>
        <div class="session-delete-card__actions">
          <button
            class="btn"
            type="button"
            autofocus
            @click=${() => state.handleSessionDeleteCancel?.()}
          >
            ${t("cron.form.cancel")}
          </button>
          <button
            class="btn danger"
            type="button"
            @click=${() => state.handleSessionDeleteConfirm?.()}
          >
            ${t("alisio.memory.delete")}
          </button>
        </div>
      </div>
    </div>
  `;
}
