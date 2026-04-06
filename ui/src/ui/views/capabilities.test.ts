/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type {
  AlisioConnectorAuthorization,
  AlisioConnectorDefinition,
  ChannelsStatusSnapshot,
  SkillStatusEntry,
  SkillStatusReport,
} from "../types.ts";
import { renderCapabilities, type CapabilitiesProps } from "./capabilities.ts";

const dialogRestores: Array<() => void> = [];

function createSkill(overrides: Partial<SkillStatusEntry> = {}): SkillStatusEntry {
  return {
    name: "Repo Skill",
    description: "Skill description",
    source: "openclaw-managed",
    filePath: "/tmp/skill",
    baseDir: "/tmp",
    skillKey: "repo-skill",
    bundled: false,
    primaryEnv: "OPENAI_API_KEY",
    emoji: undefined,
    homepage: "https://example.com",
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    requirements: {
      bins: [],
      env: ["OPENAI_API_KEY"],
      config: [],
      os: [],
    },
    missing: {
      bins: [],
      env: [],
      config: [],
      os: [],
    },
    configChecks: [],
    install: [],
    ...overrides,
  };
}

function createProps(overrides: Partial<CapabilitiesProps> = {}): CapabilitiesProps {
  const report: SkillStatusReport = {
    workspaceDir: "/tmp/workspace",
    managedSkillsDir: "/tmp/skills",
    skills: [createSkill()],
  };

  return {
    connected: true,
    loading: false,
    report,
    error: null,
    filter: "",
    statusFilter: "all",
    edits: {},
    busyKey: null,
    messages: {},
    detailKey: null,
    channelsSnapshot: null as ChannelsStatusSnapshot | null,
    connectorCatalog: [] as AlisioConnectorDefinition[],
    connectorAuthorizations: [] as AlisioConnectorAuthorization[],
    onFilterChange: () => undefined,
    onStatusFilterChange: () => undefined,
    onRefresh: () => undefined,
    onToggle: () => undefined,
    onEdit: () => undefined,
    onSaveKey: () => undefined,
    onInstall: () => undefined,
    onDetailOpen: () => undefined,
    onDetailClose: () => undefined,
    onOpenChannels: () => undefined,
    onOpenAuthentications: () => undefined,
    ...overrides,
  };
}

describe("renderCapabilities", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (dialogRestores.length > 0) {
      dialogRestores.pop()?.();
    }
  });

  it("keeps save key disabled until the user edits the field", async () => {
    const container = document.createElement("div");
    installDialogMethod("showModal", function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });

    render(
      renderCapabilities(
        createProps({
          detailKey: "repo-skill",
        }),
      ),
      container,
    );
    await Promise.resolve();

    const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Save key"),
    );

    expect(saveButton?.disabled).toBe(true);
    expect(container.textContent).toContain("Leave this empty to keep the current key.");
  });

  it("enables save once a new key is present and hides raw source ids", async () => {
    const container = document.createElement("div");
    installDialogMethod("showModal", function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });

    render(
      renderCapabilities(
        createProps({
          detailKey: "repo-skill",
          edits: {
            "repo-skill": "sk-test",
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.includes("Save key"),
    );

    expect(saveButton?.disabled).toBe(false);
    expect(container.textContent).toContain("Managed by Alisio");
    expect(container.textContent).not.toContain("openclaw-managed");
  });

  it("renders loading skeletons before the skills report arrives", () => {
    const container = document.createElement("div");

    render(
      renderCapabilities(
        createProps({
          loading: true,
          report: null,
        }),
      ),
      container,
    );

    expect(container.querySelectorAll(".loading-state__stat-card")).toHaveLength(4);
    expect(container.querySelectorAll(".loading-state__list-item")).toHaveLength(3);
    expect(container.textContent).not.toContain("No capabilities matched your filters.");
  });
});

function installDialogMethod(
  name: "showModal" | "close",
  value: (this: HTMLDialogElement) => void,
) {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
  const original = Object.getOwnPropertyDescriptor(proto, name);
  Object.defineProperty(proto, name, {
    configurable: true,
    writable: true,
    value,
  });
  dialogRestores.push(() => {
    if (original) {
      Object.defineProperty(proto, name, original);
      return;
    }
    delete proto[name];
  });
}
