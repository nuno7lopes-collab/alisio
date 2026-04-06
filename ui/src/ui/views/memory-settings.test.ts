/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderMemorySettings } from "./memory-settings.ts";

describe("renderMemorySettings", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reads agent overrides from agents.list and patches them via the agent surface", () => {
    const container = document.createElement("div");
    const onPatch = vi.fn();

    render(
      renderMemorySettings({
        loading: false,
        saving: false,
        dirty: false,
        schema: {
          type: "object",
          properties: {
            agents: {
              type: "object",
              properties: {
                list: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      memorySearch: {
                        type: "object",
                        properties: {
                          provider: { type: "string" },
                        },
                        additionalProperties: false,
                      },
                    },
                    additionalProperties: false,
                  },
                },
              },
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
        uiHints: {},
        value: {
          agents: {
            list: [{ id: "main", memorySearch: { provider: "openai" } }],
          },
        },
        selectedAgentId: "main",
        selectedAgentLabel: "Main",
        onPatch,
        onSave: vi.fn(),
      }),
      container,
    );

    const input = container.querySelector<HTMLInputElement>("input.cfg-input");
    expect(input?.value).toBe("openai");

    input!.value = "gemini";
    input!.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onPatch).toHaveBeenCalledWith(["agent", "provider"], "gemini");
  });
});
