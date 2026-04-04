import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { titleForTab, type Tab } from "../navigation.js";

export class DashboardHeader extends LitElement {
  override createRenderRoot() {
    return this;
  }

  @property() tab: Tab = "chat";

  override render() {
    const label = titleForTab(this.tab);

    return html`
      <div class="dashboard-header">
        <div class="dashboard-header__title">${label}</div>
        <div class="dashboard-header__actions">
          <slot></slot>
        </div>
      </div>
    `;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("dashboard-header")) {
  customElements.define("dashboard-header", DashboardHeader);
}
