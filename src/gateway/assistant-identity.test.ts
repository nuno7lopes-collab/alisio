import { describe, expect, it } from "vitest";
import type { AlisioConfig } from "../config/config.js";
import { DEFAULT_ASSISTANT_IDENTITY, resolveAssistantIdentity } from "./assistant-identity.js";

describe("resolveAssistantIdentity avatar normalization", () => {
  it("drops sentence-like avatar placeholders", () => {
    const cfg: AlisioConfig = {
      ui: {
        assistant: {
          avatar: "workspace-relative path, http(s) URL, or data URI",
        },
      },
    };

    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).avatar).toBe(
      DEFAULT_ASSISTANT_IDENTITY.avatar,
    );
  });

  it("keeps short text avatars", () => {
    const cfg: AlisioConfig = {
      ui: {
        assistant: {
          avatar: "PS",
        },
      },
    };

    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).avatar).toBe("PS");
  });

  it("keeps path avatars", () => {
    const cfg: AlisioConfig = {
      ui: {
        assistant: {
          avatar: "avatars/alisio.png",
        },
      },
    };

    expect(resolveAssistantIdentity({ cfg, workspaceDir: "" }).avatar).toBe("avatars/alisio.png");
  });

  it("falls back to the Alisio account agent name when no configured identity exists", () => {
    const cfg: AlisioConfig = {};

    expect(
      resolveAssistantIdentity({
        cfg,
        workspaceDir: "",
        accountProfile: {
          agentName: "Muse",
        },
      }),
    ).toMatchObject({
      name: "Muse",
      avatar: "M",
    });
  });
});
