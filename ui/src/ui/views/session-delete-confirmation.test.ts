/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { AppViewState } from "../app-view-state.ts";
import { renderSessionDeleteConfirmation } from "./session-delete-confirmation.ts";

function createState(keys: string[] | null) {
  return {
    sessionDeleteConfirmKeys: keys,
    handleSessionDeleteConfirm: vi.fn(),
    handleSessionDeleteCancel: vi.fn(),
  } as unknown as AppViewState;
}

describe("renderSessionDeleteConfirmation", () => {
  it("renders nothing when there is no pending delete", () => {
    const container = document.createElement("div");

    render(renderSessionDeleteConfirmation(createState(null)), container);

    expect(container.textContent?.trim()).toBe("");
  });

  it("renders the delete dialog and wires both actions", () => {
    const state = createState(["agent:main:chat-1", "agent:main:chat-2"]);
    const container = document.createElement("div");

    render(renderSessionDeleteConfirmation(state), container);

    expect(container.textContent).toContain("Delete 2 sessions");
    expect(container.textContent).toContain("Transcript archive");
    container.querySelector<HTMLButtonElement>(".btn")?.click();
    container.querySelector<HTMLButtonElement>(".btn.danger")?.click();

    expect(state.handleSessionDeleteCancel).toHaveBeenCalledTimes(1);
    expect(state.handleSessionDeleteConfirm).toHaveBeenCalledTimes(1);
  });
});
