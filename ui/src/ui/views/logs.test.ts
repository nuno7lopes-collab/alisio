/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderLogs, type LogsProps } from "./logs.ts";

function createProps(overrides: Partial<LogsProps> = {}): LogsProps {
  return {
    loading: false,
    error: null,
    file: null,
    entries: [],
    filterText: "",
    levelFilters: {
      trace: true,
      debug: true,
      info: true,
      warn: true,
      error: true,
      fatal: true,
    },
    autoFollow: false,
    truncated: false,
    onFilterTextChange: () => undefined,
    onLevelToggle: () => undefined,
    onToggleAutoFollow: () => undefined,
    onRefresh: () => undefined,
    onExport: () => undefined,
    onScroll: () => undefined,
    ...overrides,
  };
}

describe("renderLogs", () => {
  it("renders skeleton rows before the first log chunk arrives", () => {
    const container = document.createElement("div");

    render(
      renderLogs(
        createProps({
          loading: true,
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".loading-state__table-row").length).toBeGreaterThan(1);
    expect(container.textContent).not.toContain("No log entries.");
  });
});
