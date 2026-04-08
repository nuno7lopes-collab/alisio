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
    source: "\u006fpen\u0063law-managed",
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
      anyBins: [],
      env: ["OPENAI_API_KEY"],
      config: [],
      os: [],
    },
    missing: {
      bins: [],
      anyBins: [],
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
    actionOutputs: {},
    consentRequest: null,
    detailKey: null,
    channelsSnapshot: null as ChannelsStatusSnapshot | null,
    connectorCatalog: [] as AlisioConnectorDefinition[],
    connectorAuthorizations: [] as AlisioConnectorAuthorization[],
    onFilterChange: () => undefined,
    onStatusFilterChange: () => undefined,
    onRefresh: () => undefined,
    onToggle: () => undefined,
    onEdit: () => undefined,
    onEnvEdit: () => undefined,
    onSaveKey: () => undefined,
    onSaveEnv: () => undefined,
    onInstall: () => undefined,
    onMarketplaceInstall: () => undefined,
    onMarketplaceRemove: () => undefined,
    onMarketplaceExecute: () => undefined,
    onConsentResolve: () => undefined,
    onConsentDismiss: () => undefined,
    onEnableConfig: () => undefined,
    onAllowBundled: () => undefined,
    onDetailOpen: () => undefined,
    onDetailClose: () => undefined,
    onOpenChannels: () => undefined,
    onOpenAuthentications: () => undefined,
    onOpenSettings: () => undefined,
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
    expect(container.textContent).not.toContain("\u006fpen\u0063law-managed");
  });

  it("renders any-bin requirements and project skill sources in the detail dialog", async () => {
    const container = document.createElement("div");
    installDialogMethod("showModal", function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });

    render(
      renderCapabilities(
        createProps({
          detailKey: "repo-skill",
          report: {
            workspaceDir: "/tmp/workspace",
            managedSkillsDir: "/tmp/skills",
            skills: [
              createSkill({
                source: "agents-skills-project",
                eligible: false,
                install: [
                  {
                    id: "ffmpeg",
                    kind: "brew",
                    label: "Install ffmpeg",
                    bins: ["ffmpeg"],
                  },
                ],
                missing: {
                  bins: [],
                  anyBins: ["ffmpeg", "sox"],
                  env: [],
                  config: [],
                  os: [],
                },
              }),
            ],
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const text = container.textContent ?? "";
    expect(text).toContain("Any of these binaries: ffmpeg, sox");
    expect(text).toContain("From this project");
    expect(text).toContain("Install ffmpeg");
  });

  it("renders generic env editors and all install actions for env-driven setup", async () => {
    const container = document.createElement("div");
    installDialogMethod("showModal", function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });

    render(
      renderCapabilities(
        createProps({
          detailKey: "repo-skill",
          report: {
            workspaceDir: "/tmp/workspace",
            managedSkillsDir: "/tmp/skills",
            skills: [
              createSkill({
                primaryEnv: undefined,
                eligible: false,
                requirements: {
                  bins: [],
                  anyBins: [],
                  env: ["SHERPA_ONNX_RUNTIME_DIR", "SHERPA_ONNX_MODEL_DIR"],
                  config: [],
                  os: [],
                },
                missing: {
                  bins: [],
                  anyBins: [],
                  env: ["SHERPA_ONNX_RUNTIME_DIR", "SHERPA_ONNX_MODEL_DIR"],
                  config: [],
                  os: [],
                },
                install: [
                  {
                    id: "runtime",
                    kind: "download",
                    label: "Download runtime",
                    bins: [],
                  },
                  {
                    id: "model",
                    kind: "download",
                    label: "Download model",
                    bins: [],
                  },
                ],
              }),
            ],
          },
          edits: {
            "repo-skill::env::SHERPA_ONNX_RUNTIME_DIR": "/tmp/runtime",
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.some((button) => button.textContent?.includes("Download runtime"))).toBe(true);
    expect(buttons.some((button) => button.textContent?.includes("Download model"))).toBe(true);
    expect(buttons.some((button) => button.textContent?.includes("Save value"))).toBe(true);
    expect(container.textContent).toContain("SHERPA_ONNX_RUNTIME_DIR");
    expect(container.textContent).toContain("SHERPA_ONNX_MODEL_DIR");
  });

  it("renders allowlist and config enable actions when those are the real blockers", async () => {
    const container = document.createElement("div");
    installDialogMethod("showModal", function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });

    render(
      renderCapabilities(
        createProps({
          detailKey: "repo-skill",
          report: {
            workspaceDir: "/tmp/workspace",
            managedSkillsDir: "/tmp/skills",
            skills: [
              createSkill({
                bundled: true,
                blockedByAllowlist: true,
                eligible: false,
                requirements: {
                  bins: [],
                  anyBins: [],
                  env: [],
                  config: ["plugins.entries.voice-call.enabled"],
                  os: [],
                },
                missing: {
                  bins: [],
                  anyBins: [],
                  env: [],
                  config: ["plugins.entries.voice-call.enabled"],
                  os: [],
                },
              }),
            ],
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.some((button) => button.textContent?.includes("Allow built-in skill"))).toBe(
      true,
    );
    expect(buttons.some((button) => button.textContent?.includes("Enable in config"))).toBe(true);
  });

  it("renders secret-like env fields as password inputs", async () => {
    const container = document.createElement("div");
    installDialogMethod("showModal", function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });

    render(
      renderCapabilities(
        createProps({
          detailKey: "repo-skill",
          report: {
            workspaceDir: "/tmp/workspace",
            managedSkillsDir: "/tmp/skills",
            skills: [
              createSkill({
                primaryEnv: undefined,
                eligible: false,
                requirements: {
                  bins: [],
                  anyBins: [],
                  env: ["TRELLO_TOKEN"],
                  config: [],
                  os: [],
                },
                missing: {
                  bins: [],
                  anyBins: [],
                  env: ["TRELLO_TOKEN"],
                  config: [],
                  os: [],
                },
              }),
            ],
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const envInput = container.querySelector<HTMLInputElement>(
      'input[type="password"]:not(.skill-toggle)',
    );

    expect(envInput).not.toBeNull();
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

  it("renders marketplace catalog groups, consent CTA, and action output", async () => {
    const container = document.createElement("div");
    installDialogMethod("showModal", function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });

    render(
      renderCapabilities(
        createProps({
          detailKey: "mcp:toolbox",
          report: {
            workspaceDir: "/tmp/workspace",
            managedSkillsDir: "/tmp/skills",
            skills: [],
            marketplaceCatalog: [
              createSkill({
                skillKey: "repo-installed",
                name: "Installed Skill",
                installed: true,
                installable: false,
                removable: true,
                executable: true,
                eligible: true,
              }),
              createSkill({
                skillKey: "mcp:toolbox",
                name: "mcp:toolbox",
                description: "Toolbox MCP server",
                source: "alisio-mcp",
                filePath: "mcp:toolbox",
                baseDir: "",
                kind: "mcp-server",
                installed: true,
                installable: false,
                removable: false,
                executable: true,
                eligible: true,
                permissions: {
                  consent: "explicit",
                  sandbox: {
                    mode: "isolated",
                    filesystem: "read-only",
                    network: "off",
                  },
                  mcp: {
                    consume: true,
                  },
                },
                outputs: {
                  primary: "tool",
                  formats: ["application/json"],
                },
              }),
              createSkill({
                skillKey: "catalog-skill",
                name: "Catalog Skill",
                installed: false,
                installable: true,
                removable: false,
                executable: true,
                eligible: false,
              }),
            ],
          },
          consentRequest: {
            skillKey: "mcp:toolbox",
            skillName: "mcp:toolbox",
            action: "execute",
            title: "Inspect mcp:toolbox?",
            description: "Declared permissions: consume MCP.",
          },
          actionOutputs: {
            "mcp:toolbox": {
              title: "MCP: mcp:toolbox",
              text: "Tools (1)\nPrompts (1)\nResources (1)",
            },
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const text = container.textContent ?? "";
    expect(text).toContain("Installed");
    expect(text).toContain("Catalog");
    expect(text).toContain("Allow once");
    expect(text).toContain("Allow always");
    expect(text).toContain("Tools (1)");
    expect(text).toContain("MCP");
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
