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

function resolveRequestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) {
    return input;
  }
  if (typeof input === "string") {
    return new URL(input);
  }
  return new URL(input.url);
}

function parseJsonBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") {
    throw new Error("expected JSON string body");
  }
  return JSON.parse(body);
}

function createCanonicalCloudFetchMock() {
  const snapshots = new Map<string, Record<string, unknown>>();
  const backups: Array<Record<string, unknown>> = [];
  const scopeKey = (ownerUserId: string, profileId: string, workspaceScope: string) =>
    `${ownerUserId}::${profileId}::${workspaceScope}`;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveRequestUrl(input);
    const table = url.pathname.split("/").pop() ?? "";
    const method = (init?.method ?? "GET").toUpperCase();
    if (table === "alisio_memory_snapshots") {
      if (method === "GET") {
        const ownerUserId = url.searchParams.get("owner_user_id")?.replace(/^eq\./, "") ?? "";
        const profileId = url.searchParams.get("profile_id")?.replace(/^eq\./, "") ?? "";
        const workspaceScope = url.searchParams.get("workspace_scope")?.replace(/^eq\./, "") ?? "";
        const row = snapshots.get(scopeKey(ownerUserId, profileId, workspaceScope));
        return {
          ok: true,
          status: 200,
          json: async () => (row ? [row] : []),
        } satisfies Partial<Response>;
      }
      if (method === "POST") {
        const rows = Array.isArray(parseJsonBody(init?.body))
          ? (parseJsonBody(init?.body) as Array<Record<string, unknown>>)
          : [];
        for (const row of rows) {
          const ownerUserId = String(row.owner_user_id ?? "").trim();
          const profileId = String(row.profile_id ?? "").trim();
          const workspaceScope = String(row.workspace_scope ?? "").trim();
          snapshots.set(scopeKey(ownerUserId, profileId, workspaceScope), row);
        }
        const preferHeader =
          typeof init?.headers === "object" && init.headers
            ? String((init.headers as Record<string, unknown>).Prefer ?? "")
            : "";
        return {
          ok: true,
          status: 201,
          json: async () => (preferHeader.includes("return=representation") ? rows : []),
        } satisfies Partial<Response>;
      }
    }
    if (table === "alisio_memory_snapshot_backups" && method === "POST") {
      const rows = Array.isArray(parseJsonBody(init?.body))
        ? (parseJsonBody(init?.body) as Array<Record<string, unknown>>)
        : [];
      backups.push(...rows);
      return {
        ok: true,
        status: 201,
        json: async () => [],
      } satisfies Partial<Response>;
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ message: `unexpected ${method} ${url.pathname}` }),
    } satisfies Partial<Response>;
  });
  return { fetchMock, snapshots, backups };
}

describe("canonical memory store", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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
      expect(status.cloudSync).toBe("unavailable");

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

  it("round-trips human edits from canonical projections back into the structured store", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-canonical-memory-roundtrip-"));
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

      await upsertCanonicalMemoryStructuredEntities({
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
                markdownBody: "# Project Atlas\n\nCanonical store source entry.\n",
              },
            ],
          },
          {
            title: "Roadmap",
            aliases: ["Roadmap"],
            tags: ["planning"],
            projections: [
              {
                relativePath: "memory/roadmap.md",
                markdownBody: "# Roadmap\n\nPlanning note.\n",
              },
            ],
          },
        ],
      });

      await fs.writeFile(
        path.join(memoryDir, "project-atlas.md"),
        [
          "---",
          "alisio-memory: canonical-projection",
          "alisio-profile-id: local-nuno",
          "alisio-source-of-truth: canonical-store",
          "alisio-kind: initiative",
          "title: Atlas Program",
          "aliases:",
          "  - Atlas Prime",
          "tags:",
          "  - initiative",
          "---",
          "",
          "# Atlas Program",
          "",
          "Human-edited projection body.",
          "",
          "<!-- alisio-relations:start -->",
          "## Relations",
          "",
          "- depends-on: [[memory/roadmap]]",
          "<!-- alisio-relations:end -->",
          "",
        ].join("\n"),
        "utf8",
      );

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

      const graph = queryCanonicalMemoryGraph({
        status,
        query: "Atlas Program",
        direction: "both",
        relationLimit: 4,
      });

      expect(graph.matches).toHaveLength(1);
      expect(graph.matches[0]?.title).toBe("Atlas Program");
      expect(graph.matches[0]?.aliases).toContain("atlas prime");
      expect(graph.matches[0]?.tags).toEqual(["initiative"]);
      expect(graph.matches[0]?.relations).toEqual([
        expect.objectContaining({
          direction: "outgoing",
          relationType: "depends-on",
          relatedEntity: expect.objectContaining({
            title: "Roadmap",
            sourcePath: "memory/roadmap.md",
          }),
        }),
      ]);

      const projection = await fs.readFile(path.join(memoryDir, "project-atlas.md"), "utf8");
      expect(projection).toContain('title: "Atlas Program"');
      expect(projection).toContain("aliases:");
      expect(projection).toContain("Atlas Prime");
      expect(projection).toContain("alisio-kind: initiative");
      expect(projection).toContain("depends-on: [[memory/roadmap]]");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uploads canonical memory snapshots to the cloud backend for signed-in profiles", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-canonical-memory-cloud-"));
    const stateDir = path.join(root, "state");
    const workspaceDir = path.join(root, "workspace");
    const memoryDir = path.join(workspaceDir, "memory");
    const { fetchMock, snapshots, backups } = createCanonicalCloudFetchMock();

    try {
      await fs.mkdir(memoryDir, { recursive: true });
      await fs.mkdir(path.join(stateDir, "alisio"), { recursive: true });
      await fs.writeFile(
        path.join(stateDir, "alisio", "state.json"),
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                userId: "user-1",
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                backend: "supabase",
              },
              cloudSession: {
                backend: "supabase",
                state: "signed_in",
                userId: "user-1",
                email: "nuno@example.com",
                accessToken: "access-token-1",
                signedInAt: "2026-04-09T12:00:00.000Z",
              },
            },
            organization: { mode: "none" },
            authorizations: {},
            oauthCredentials: {},
            pendingAuthorizations: {},
          },
          null,
          2,
        ),
        "utf8",
      );
      await fs.writeFile(
        path.join(workspaceDir, "MEMORY.md"),
        "# Profile\n\nSee [[memory/roadmap]].\n",
      );
      await fs.writeFile(path.join(memoryDir, "roadmap.md"), "# Roadmap\n\nProject milestones.\n");
      vi.stubEnv("ALISIO_STATE_DIR", stateDir);
      vi.stubEnv("ALISIO_SUPABASE_URL", "https://example.supabase.co");
      vi.stubEnv("ALISIO_SUPABASE_ANON_KEY", "anon-key");
      vi.stubGlobal("fetch", fetchMock);

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

      expect(status.profileSource).toBe("cloud-user");
      expect(status.cloudSync).toBe("enabled");
      expect(snapshots.size).toBe(1);
      expect(backups).toHaveLength(1);
      const snapshot = [...snapshots.values()][0];
      expect(snapshot).toEqual(
        expect.objectContaining({
          owner_user_id: "user-1",
          profile_id: status.profileId,
          workspace_scope: expect.any(String),
        }),
      );
      const payload = snapshot.snapshot as {
        projections?: unknown[];
        entities?: unknown[];
        workspaceScope?: unknown;
      };
      expect(snapshot.workspace_scope).toBe(payload.workspaceScope);
      expect(payload.entities).toHaveLength(2);
      expect(payload.projections).toHaveLength(2);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("bootstraps a second device from the latest cloud snapshot and materializes local projections", async () => {
    const { fetchMock } = createCanonicalCloudFetchMock();
    const rootA = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-canonical-memory-device-a-"));
    const rootB = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-canonical-memory-device-b-"));

    const writeSignedInState = async (root: string, accessToken: string) => {
      const stateDir = path.join(root, "state");
      await fs.mkdir(path.join(stateDir, "alisio"), { recursive: true });
      await fs.writeFile(
        path.join(stateDir, "alisio", "state.json"),
        JSON.stringify(
          {
            version: 1,
            account: {
              profile: {
                userId: "user-1",
                username: "nuno",
                displayName: "Nuno Lopes",
                email: "nuno@example.com",
              },
              preferences: {
                language: "pt-PT",
                theme: "dark",
              },
              session: {
                state: "signed_in",
                profileCompleted: true,
                backend: "supabase",
              },
              cloudSession: {
                backend: "supabase",
                state: "signed_in",
                userId: "user-1",
                email: "nuno@example.com",
                accessToken,
                signedInAt: "2026-04-09T12:00:00.000Z",
              },
            },
            organization: { mode: "none" },
            authorizations: {},
            oauthCredentials: {},
            pendingAuthorizations: {},
          },
          null,
          2,
        ),
        "utf8",
      );
      return stateDir;
    };

    try {
      vi.stubEnv("ALISIO_SUPABASE_URL", "https://example.supabase.co");
      vi.stubEnv("ALISIO_SUPABASE_ANON_KEY", "anon-key");
      vi.stubGlobal("fetch", fetchMock);

      const stateDirA = await writeSignedInState(rootA, "access-token-a");
      const workspaceDirA = path.join(rootA, "workspace");
      const memoryDirA = path.join(workspaceDirA, "memory");
      await fs.mkdir(memoryDirA, { recursive: true });
      await fs.writeFile(
        path.join(workspaceDirA, "MEMORY.md"),
        "# Profile\n\nSee [[memory/travel-plan]].\n",
      );
      await fs.writeFile(
        path.join(memoryDirA, "travel-plan.md"),
        "# Travel Plan\n\nBring passports.\n",
      );

      vi.stubEnv("ALISIO_STATE_DIR", stateDirA);
      const deviceAStatus = await syncCanonicalMemoryStore({
        cfg: {
          agents: {
            defaults: {
              workspace: workspaceDirA,
            },
          },
        } as OpenClawConfig,
        agentId: "main",
        workspaceDir: workspaceDirA,
        backend: "builtin",
        env: process.env,
      });
      expect(deviceAStatus.cloudSync).toBe("enabled");

      const stateDirB = await writeSignedInState(rootB, "access-token-b");
      const workspaceDirB = path.join(rootB, "workspace");
      await fs.mkdir(workspaceDirB, { recursive: true });
      vi.stubEnv("ALISIO_STATE_DIR", stateDirB);

      const deviceBStatus = await syncCanonicalMemoryStore({
        cfg: {
          agents: {
            defaults: {
              workspace: workspaceDirB,
            },
          },
        } as OpenClawConfig,
        agentId: "main",
        workspaceDir: workspaceDirB,
        backend: "builtin",
        env: process.env,
      });

      expect(deviceBStatus.lastError).toBeUndefined();
      expect(deviceBStatus.cloudSync).toBe("enabled");
      expect(deviceBStatus.entities).toBe(2);
      expect(await fs.readFile(path.join(workspaceDirB, "MEMORY.md"), "utf8")).toContain(
        "[[memory/travel-plan]]",
      );
      expect(
        await fs.readFile(path.join(workspaceDirB, "memory", "travel-plan.md"), "utf8"),
      ).toContain("Bring passports.");
    } finally {
      await fs.rm(rootA, { recursive: true, force: true });
      await fs.rm(rootB, { recursive: true, force: true });
    }
  });
});
