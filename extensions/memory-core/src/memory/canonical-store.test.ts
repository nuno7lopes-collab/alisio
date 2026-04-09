import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "alisio/plugin-sdk/memory-core-host-engine-foundation";
import { requireNodeSqlite } from "alisio/plugin-sdk/memory-core-host-engine-storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  queryCanonicalMemoryGraph,
  syncCanonicalMemoryStore,
  upsertCanonicalMemoryStructuredEntities,
} from "./canonical-store.js";

describe("canonical memory store", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("stores explicit note relations and markdown projections for the active profile", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-canonical-memory-"));
    const stateDir = path.join(root, "state");
    const workspaceDir = path.join(root, "workspace");
    const memoryDir = path.join(workspaceDir, "memory");

    try {
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.mkdir(path.join(stateDir, "alisio"), { recursive: true });
      await fs.writeFile(
        path.join(stateDir, "alisio", "state.json"),
        JSON.stringify(
          {
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(
        path.join(workspaceDir, "MEMORY.md"),
        "# Profile Memory\n\nSee [[memory/2026-01-12]].\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(memoryDir, "2026-01-12.md"),
        "---\naliases:\n  - Atlas Daily\ntags:\n  - project\n---\n# Daily note\n\nAlpha.\n",
        "utf8",
      );
      vi.stubEnv("ALISIO_STATE_DIR", stateDir);

      const status = await syncCanonicalMemoryStore({
        cfg: {
          agents: {
            defaults: {
              workspace: workspaceDir,
            },
          },
        } as OpenClawConfig,
        agentId: "main",
        workspaceDir,
        backend: "builtin",
        env: process.env,
      });

      expect(status.state).toBe("ready");
      expect(status.syncMode).toBe("local-first");
      expect(status.profileId).toBe("local-nuno");
      expect(status.entities).toBe(2);
      expect(status.relations).toBe(1);
      expect(status.projections).toBe(2);
      expect(status.cloudSync).toBe("not_implemented");

      const { DatabaseSync } = requireNodeSqlite();
      const db = new DatabaseSync(status.path);
      try {
        const relation = db
          .prepare("SELECT relation_type, target_locator, to_entity_id FROM relations LIMIT 1")
          .get() as
          | {
              relation_type: string;
              target_locator: string | null;
              to_entity_id: string | null;
            }
          | undefined;
        const projectionPaths = db
          .prepare("SELECT relative_path FROM projections ORDER BY relative_path")
          .all() as Array<{ relative_path: string }>;
        const aliases = db
          .prepare("SELECT alias_key FROM entity_aliases ORDER BY alias_key")
          .all() as Array<{ alias_key: string }>;

        expect(relation?.relation_type).toBe("references");
        expect(relation?.to_entity_id).toBeTruthy();
        expect(relation?.target_locator).toBeNull();
        expect(aliases.map((entry) => entry.alias_key)).toContain("atlas daily");
        expect(aliases.map((entry) => entry.alias_key)).toContain("memory/2026-01-12");
        expect(projectionPaths.map((entry) => entry.relative_path)).toEqual([
          "MEMORY.md",
          "memory/2026-01-12.md",
        ]);
      } finally {
        db.close();
      }

      const graph = queryCanonicalMemoryGraph({
        status,
        query: "Atlas Daily",
        direction: "both",
        relationLimit: 4,
      });
      expect(graph.matches).toHaveLength(1);
      expect(graph.matches[0]?.sourcePath).toBe("memory/2026-01-12.md");
      expect(graph.matches[0]?.tags).toEqual(["project"]);
      expect(graph.matches[0]?.relations).toEqual([
        expect.objectContaining({
          direction: "incoming",
          relationType: "references",
          relatedEntity: expect.objectContaining({
            sourcePath: "MEMORY.md",
          }),
        }),
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("keeps structured-store entities authoritative while markdown sync imports projections around them", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-canonical-memory-structured-"));
    const stateDir = path.join(root, "state");
    const workspaceDir = path.join(root, "workspace");
    const memoryDir = path.join(workspaceDir, "memory");

    try {
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.mkdir(path.join(stateDir, "alisio"), { recursive: true });
      await fs.writeFile(
        path.join(stateDir, "alisio", "state.json"),
        JSON.stringify(
          {
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      vi.stubEnv("ALISIO_STATE_DIR", stateDir);

      const structuredStatus = await upsertCanonicalMemoryStructuredEntities({
        cfg: {
          agents: {
            defaults: {
              workspace: workspaceDir,
            },
          },
        } as OpenClawConfig,
        agentId: "main",
        workspaceDir,
        backend: "builtin",
        entities: [
          {
            title: "Project Atlas",
            aliases: ["Atlas"],
            tags: ["project"],
            projections: [
              {
                relativePath: "memory/project-atlas.md",
                markdownBody: "Project Atlas is the canonical structured memory entry.\n",
              },
            ],
          },
        ],
      });

      expect(structuredStatus.state).toBe("ready");
      expect(structuredStatus.syncMode).toBe("local-first");
      expect(structuredStatus.entities).toBe(1);
      expect(structuredStatus.projections).toBe(1);

      const structuredProjection = await fs.readFile(
        path.join(memoryDir, "project-atlas.md"),
        "utf8",
      );
      expect(structuredProjection).toContain("alisio-source-of-truth: canonical-store");
      expect(structuredProjection).toContain(
        "Project Atlas is the canonical structured memory entry.",
      );

      await fs.writeFile(
        path.join(workspaceDir, "MEMORY.md"),
        "# Team Memory\n\nSee [[memory/project-atlas]].\n",
        "utf8",
      );

      const importedStatus = await syncCanonicalMemoryStore({
        cfg: {
          agents: {
            defaults: {
              workspace: workspaceDir,
            },
          },
        } as OpenClawConfig,
        agentId: "main",
        workspaceDir,
        backend: "builtin",
        env: process.env,
      });

      expect(importedStatus.entities).toBe(2);
      expect(importedStatus.relations).toBe(1);
      expect(importedStatus.projections).toBe(2);
      expect(importedStatus.projectionSources).toEqual(["workspace-memory"]);

      const graph = queryCanonicalMemoryGraph({
        status: importedStatus,
        query: "Project Atlas",
        direction: "both",
        relationLimit: 4,
      });

      expect(graph.matches).toHaveLength(1);
      expect(graph.matches[0]?.sourcePath).toBe("memory/project-atlas.md");
      expect(graph.matches[0]?.relations).toEqual([
        expect.objectContaining({
          direction: "incoming",
          relationType: "references",
          relatedEntity: expect.objectContaining({
            sourcePath: "MEMORY.md",
          }),
        }),
      ]);

      const { DatabaseSync } = requireNodeSqlite();
      const db = new DatabaseSync(importedStatus.path);
      try {
        const origins = db
          .prepare(
            `SELECT origin, source_path
             FROM entities
             WHERE profile_id = ?
             ORDER BY source_path ASC`,
          )
          .all(importedStatus.profileId) as Array<{ origin: string; source_path: string }>;
        expect(origins).toEqual([
          { origin: "markdown-import", source_path: "MEMORY.md" },
          { origin: "structured-store", source_path: "memory/project-atlas.md" },
        ]);
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("lets the structured store take over a previously imported markdown path", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-canonical-memory-takeover-"));
    const stateDir = path.join(root, "state");
    const workspaceDir = path.join(root, "workspace");
    const memoryDir = path.join(workspaceDir, "memory");

    try {
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.mkdir(path.join(stateDir, "alisio"), { recursive: true });
      await fs.writeFile(
        path.join(stateDir, "alisio", "state.json"),
        JSON.stringify(
          {
            account: {
              profile: {
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
              },
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(
        path.join(workspaceDir, "MEMORY.md"),
        "# Team Memory\n\nSee [[memory/project-atlas]].\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(memoryDir, "project-atlas.md"),
        "# Project Atlas\n\nLegacy imported markdown entry.\n",
        "utf8",
      );
      vi.stubEnv("ALISIO_STATE_DIR", stateDir);

      const importedStatus = await syncCanonicalMemoryStore({
        cfg: {
          agents: {
            defaults: {
              workspace: workspaceDir,
            },
          },
        } as OpenClawConfig,
        agentId: "main",
        workspaceDir,
        backend: "builtin",
        env: process.env,
      });
      expect(importedStatus.entities).toBe(2);
      expect(importedStatus.relations).toBe(1);

      const structuredStatus = await upsertCanonicalMemoryStructuredEntities({
        cfg: {
          agents: {
            defaults: {
              workspace: workspaceDir,
            },
          },
        } as OpenClawConfig,
        agentId: "main",
        workspaceDir,
        backend: "builtin",
        env: process.env,
        entities: [
          {
            title: "Project Atlas",
            aliases: ["Atlas"],
            tags: ["project"],
            projections: [
              {
                relativePath: "memory/project-atlas.md",
                markdownBody: "Project Atlas is now owned by the canonical structured store.\n",
              },
            ],
          },
        ],
      });

      expect(structuredStatus.entities).toBe(2);
      expect(structuredStatus.relations).toBe(1);

      const structuredProjection = await fs.readFile(
        path.join(memoryDir, "project-atlas.md"),
        "utf8",
      );
      expect(structuredProjection).toContain("alisio-source-of-truth: canonical-store");

      await fs.writeFile(
        path.join(memoryDir, "project-atlas.md"),
        "# Project Atlas\n\nHuman rewrite without canonical frontmatter.\n",
        "utf8",
      );

      const resyncedStatus = await syncCanonicalMemoryStore({
        cfg: {
          agents: {
            defaults: {
              workspace: workspaceDir,
            },
          },
        } as OpenClawConfig,
        agentId: "main",
        workspaceDir,
        backend: "builtin",
        env: process.env,
      });

      expect(resyncedStatus.entities).toBe(2);
      expect(resyncedStatus.relations).toBe(1);
      expect(resyncedStatus.projections).toBe(2);

      const graph = queryCanonicalMemoryGraph({
        status: resyncedStatus,
        query: "Project Atlas",
        direction: "both",
        relationLimit: 4,
      });

      expect(graph.matches).toHaveLength(1);
      expect(graph.matches[0]?.sourcePath).toBe("memory/project-atlas.md");
      expect(graph.matches[0]?.relations).toEqual([
        expect.objectContaining({
          direction: "incoming",
          relationType: "references",
          relatedEntity: expect.objectContaining({
            sourcePath: "MEMORY.md",
          }),
        }),
      ]);

      const { DatabaseSync } = requireNodeSqlite();
      const db = new DatabaseSync(resyncedStatus.path);
      try {
        const origins = db
          .prepare(
            `SELECT origin, source_path
             FROM entities
             WHERE profile_id = ?
             ORDER BY source_path ASC`,
          )
          .all(resyncedStatus.profileId) as Array<{ origin: string; source_path: string }>;
        const relations = db
          .prepare(
            `SELECT relation_type, to_entity_id, target_locator
             FROM relations
             WHERE profile_id = ?
             ORDER BY relation_type ASC, target_locator ASC`,
          )
          .all(resyncedStatus.profileId) as Array<{
          relation_type: string;
          to_entity_id: string | null;
          target_locator: string | null;
        }>;
        expect(origins).toEqual([
          { origin: "markdown-import", source_path: "MEMORY.md" },
          { origin: "structured-store", source_path: "memory/project-atlas.md" },
        ]);
        expect(relations).toEqual([
          expect.objectContaining({
            relation_type: "references",
            to_entity_id: expect.any(String),
            target_locator: null,
          }),
        ]);
      } finally {
        db.close();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
