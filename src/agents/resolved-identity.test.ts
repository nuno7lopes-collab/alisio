import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AlisioConfig } from "../config/config.js";
import { resolveCanonicalAgentIdentitySnapshot } from "./identity-canonical.js";
import { resolveResolvedAgentIdentity } from "./resolved-identity.js";

const tempRoots: string[] = [];

async function createWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-resolved-identity-"));
  tempRoots.push(root);
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace, { recursive: true });
  return workspace;
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0, tempRoots.length)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe("resolveCanonicalAgentIdentitySnapshot", () => {
  it("prefers workspace identity over config identity", async () => {
    const workspace = await createWorkspace();
    await fs.writeFile(
      path.join(workspace, "IDENTITY.md"),
      ["- Name: Atlas", "- Emoji: 🧠", "- Theme: ocean"].join("\n"),
      "utf8",
    );
    const cfg: AlisioConfig = {
      agents: {
        list: [
          {
            id: "main",
            workspace,
            name: "Configured name",
            identity: { name: "Config Bot", emoji: "🤖", theme: "ember" },
          },
        ],
      },
    };

    const identity = resolveCanonicalAgentIdentitySnapshot({ cfg, agentId: "main" });

    expect(identity).toMatchObject({
      name: "Atlas",
      emoji: "🧠",
      theme: "ocean",
      sources: {
        name: "identity-file",
        emoji: "identity-file",
        theme: "identity-file",
      },
    });
  });

  it("uses the account name only as a last fallback", () => {
    const cfg: AlisioConfig = {};

    const identity = resolveCanonicalAgentIdentitySnapshot({
      cfg,
      agentId: "main",
      includeAccountIdentity: true,
      accountProfile: { agentName: "Muse" },
    });

    expect(identity).toMatchObject({
      name: "Muse",
      sources: {
        name: "account-profile",
      },
    });
  });
});

describe("resolveResolvedAgentIdentity", () => {
  it("does not let ui.assistant override canonical identity", async () => {
    const workspace = await createWorkspace();
    await fs.writeFile(path.join(workspace, "IDENTITY.md"), "- Name: Atlas\n", "utf8");
    const cfg: AlisioConfig = {
      ui: {
        assistant: {
          name: "UI Shell",
          avatar: "PS",
        },
      },
      agents: {
        list: [{ id: "main", workspace }],
      },
    };

    const identity = resolveResolvedAgentIdentity({
      cfg,
      agentId: "main",
      workspaceDir: workspace,
      includeAccountIdentity: true,
      accountProfile: { agentName: "Muse" },
    });

    expect(identity.name).toBe("Atlas");
    expect(identity.avatar).toBe("A");
  });
});
