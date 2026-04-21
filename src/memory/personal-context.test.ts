import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureAgentWorkspace } from "../agents/workspace.js";
import type { AlisioConfig } from "../config/config.js";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import { readPersonalContextSummary } from "./personal-context.js";

function createCfg(workspaceDir: string): AlisioConfig {
  return {
    session: { mainKey: "main" },
    agents: {
      defaults: {
        workspace: workspaceDir,
      },
      list: [{ id: "main", default: true, name: "Nuno" }],
    },
  };
}

describe("readPersonalContextSummary", () => {
  it("describes bootstrap, identity, main memory, operational memory, and session policy", async () => {
    const workspaceRoot = await makeTempWorkspace("alisio-personal-context-");
    const workspaceDir = path.join(workspaceRoot, "accounts", "user-1");
    const cfg = createCfg(workspaceRoot);
    await fs.mkdir(workspaceDir, { recursive: true });
    await ensureAgentWorkspace({ dir: workspaceDir, ensureBootstrapFiles: true });
    await writeWorkspaceFile({
      dir: workspaceDir,
      name: "IDENTITY.md",
      content: "# IDENTITY.md\n\n- **Name:** Maré\n- **Emoji:** 🦞\n",
    });
    await writeWorkspaceFile({
      dir: workspaceDir,
      name: "MEMORY.md",
      content: "# Memory\n\n- Prefers concise replies.\n",
    });
    await fs.mkdir(path.join(workspaceDir, "memory", "backlog", "2026-04-20"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "memory", "physics.md"),
      "# Physics\n\nStudy notes.\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "2026-04-20.md"),
      "# Daily\n\nWhat happened today.\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "backlog", "2026-04-20", "loop.md"),
      "# Loop\n\nOpen item.\n",
      "utf8",
    );

    const summary = await readPersonalContextSummary({
      cfg,
      agentId: "main",
      workspaceDir,
      mainKey: "main",
      accountId: "user-1",
    });

    expect(summary).toMatchObject({
      version: 1,
      accountScope: {
        scopeRoot: "account",
        accountId: "user-1",
        source: "account_id",
        authenticated: true,
        authRequired: true,
        workspaceMode: "account_scoped",
        workspaceRoot: "accounts/user-1",
      },
      deviceBinding: {
        binding: "account_bound",
        runtime: "local",
        current: true,
        accountId: "user-1",
      },
      runtimeContract: {
        scopeRoot: "account",
        backendShared: ["account", "auth", "linked_devices", "session_index", "automations"],
        localRuntime: ["identity", "soul", "preferences", "memory", "native_runtime"],
      },
      bootstrap: {
        path: "BOOTSTRAP.md",
        state: "completed",
        availability: "setup_only",
      },
      identity: {
        path: "IDENTITY.md",
        availability: "all_sessions",
        resolved: {
          name: "Maré",
        },
      },
      soul: {
        path: "SOUL.md",
        availability: "all_sessions",
      },
      preferences: {
        path: "USER.md",
        availability: "all_sessions",
      },
      memory: {
        main: {
          path: "MEMORY.md",
          present: true,
          availability: "private_direct_sessions",
        },
        operational: {
          root: "memory",
          backlogRoot: "memory/backlog",
          availability: "retrieval_only",
          topicCount: 1,
          dailyCount: 1,
          backlogCount: 1,
        },
      },
      sessionPolicy: {
        main: {
          kind: "main",
          role: "default_personal_session",
          key: "agent:main:main",
          inherits: ["identity", "soul", "preferences", "main_memory"],
        },
        direct: {
          kind: "direct",
          role: "private_direct_session",
          inherits: ["identity", "soul", "preferences", "main_memory"],
        },
        group: {
          kind: "group",
          role: "shared_session",
          inherits: ["identity", "soul", "preferences"],
        },
      },
    });
  });
});
