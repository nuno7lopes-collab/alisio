import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AlisioConfig } from "alisio/plugin-sdk/memory-core-host-engine-foundation";
import { requireNodeSqlite } from "alisio/plugin-sdk/memory-core-host-engine-storage";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadConfig = vi.hoisted(() => vi.fn());
const getMemorySearchManager = vi.hoisted(() => vi.fn());

vi.mock("alisio/plugin-sdk/memory-core-host-runtime-core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("alisio/plugin-sdk/memory-core-host-runtime-core")>();
  return {
    ...actual,
    loadConfig,
  };
});

vi.mock("./memory/index.js", () => ({
  getMemorySearchManager,
}));

import {
  handleMemoryExportGatewayRequest,
  handleMemoryNotesGetGatewayRequest,
  handleMemoryNotesHistoryGatewayRequest,
  handleMemoryNotesListGatewayRequest,
  handleMemoryNotesUpdateGatewayRequest,
  handleMemoryTraceGetGatewayRequest,
  handleMemoryWikiGetGatewayRequest,
  handleMemoryWikiHistoryGatewayRequest,
  handleMemoryWikiListGatewayRequest,
  handleMemoryWikiUpdateGatewayRequest,
} from "./gateway.native.js";
import {
  handleMemoryFilesGetGatewayRequest,
  handleMemoryFilesListGatewayRequest,
} from "./gateway/files.js";
import { memoryWriteEvent, syncCanonicalMemoryStore } from "./memory/canonical-store.js";

type TestWorkspace = {
  root: string;
  stateDir: string;
  workspaceDir: string;
  cfg: AlisioConfig;
};

async function createTestWorkspace(prefix: string): Promise<TestWorkspace> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const stateDir = path.join(root, "state");
  const workspaceDir = path.join(root, "workspace");
  await fs.mkdir(path.join(stateDir, "alisio"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
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
    "# Memory\n\nSee [[memory/project-atlas]].\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(workspaceDir, "memory", "project-atlas.md"),
    [
      "---",
      "aliases:",
      "  - Atlas",
      "tags:",
      "  - pinned",
      "priority: high",
      "---",
      "# Project Atlas",
      "",
      "Launch blockers depend on [[memory/roadmap]].",
      "Attachment ref: product-brief.pdf",
      "",
    ].join("\n"),
    "utf8",
  );
  await fs.writeFile(
    path.join(workspaceDir, "memory", "roadmap.md"),
    "# Roadmap\n\nAtlas needs sign-off. See [[memory/project-atlas]].\n",
    "utf8",
  );
  return {
    root,
    stateDir,
    workspaceDir,
    cfg: {
      agents: {
        defaults: {
          workspace: workspaceDir,
        },
      },
    } as AlisioConfig,
  };
}

function openDb(dbPath: string) {
  const { DatabaseSync } = requireNodeSqlite();
  return new DatabaseSync(dbPath);
}

async function insertTraceEvent(params: {
  profileId: string;
  stateDir: string;
  traceId: string;
  trace: Record<string, unknown>;
}) {
  const { DatabaseSync } = requireNodeSqlite();
  const ledgerPath = path.join(
    params.stateDir,
    "state",
    params.profileId,
    "memory",
    "ledger.sqlite",
  );
  await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
  const db = new DatabaseSync(ledgerPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_events (
        event_id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        lamport INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        payload_plain BLOB NULL,
        payload_cipher BLOB NULL,
        nonce BLOB NULL,
        aad BLOB NULL,
        payload_hash TEXT NOT NULL,
        prev_event_hash TEXT NULL,
        event_hash TEXT NOT NULL
      );
    `);
    const payload = Buffer.from(JSON.stringify({ trace: params.trace }), "utf8");
    const digest = createHash("sha256").update(payload).digest("hex");
    db.prepare(
      `INSERT INTO memory_events (
         event_id,
         profile_id,
         device_id,
         lamport,
         event_type,
         schema_version,
         created_at_ms,
         payload_plain,
         payload_cipher,
         nonce,
         aad,
         payload_hash,
         prev_event_hash,
         event_hash
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      params.traceId,
      params.profileId,
      "device-main",
      1,
      "RETRIEVAL_TRACE_RECORDED",
      1,
      Date.now(),
      payload,
      null,
      null,
      null,
      digest,
      null,
      digest,
    );
  } finally {
    db.close();
  }
}

async function seedNativeMemory() {
  const test = await createTestWorkspace("alisio-memory-gateway-native-");
  vi.stubEnv("ALISIO_STATE_DIR", test.stateDir);

  let status = await syncCanonicalMemoryStore({
    cfg: test.cfg,
    agentId: "main",
    workspaceDir: test.workspaceDir,
    backend: "builtin",
    env: process.env,
  });

  const db = openDb(status.path);
  let atlasPageId = "";
  try {
    atlasPageId =
      (
        db.prepare(`SELECT page_id FROM pages WHERE title = ? LIMIT 1`).get("Project Atlas") as
          | { page_id?: string }
          | undefined
      )?.page_id ?? "";
  } finally {
    db.close();
  }

  const seeded = await memoryWriteEvent({
    cfg: test.cfg,
    agentId: "main",
    workspaceDir: test.workspaceDir,
    backend: "builtin",
    env: process.env,
    events: [
      {
        actorId: "atlas",
        type: "CLAIM_UPSERTED",
        pageId: atlasPageId,
        payload: {
          claimId: "claim-atlas",
          subject: "Project Atlas",
          predicate: "depends on",
          object: "roadmap sign-off",
        },
      },
      {
        actorId: "atlas",
        type: "EVIDENCE_ADDED",
        pageId: atlasPageId,
        payload: {
          evidenceId: "evidence-atlas",
          claimId: "claim-atlas",
          sourceLocator: "memory/project-atlas.md#L3",
          quote: "Launch blockers depend on roadmap sign-off.",
          hash: "hash-evidence-atlas",
        },
      },
      {
        actorId: "atlas",
        type: "ATTACHMENT_ADDED",
        pageId: atlasPageId,
        payload: {
          blobId: "product-brief.pdf",
          mime: "application/pdf",
          bytes: Buffer.from("brief-pdf"),
          sha256: "sha-product-brief",
        },
      },
    ],
  });
  status = seeded.status;

  const traceId = "trace-atlas";
  await insertTraceEvent({
    profileId: status.profileId,
    stateDir: test.stateDir,
    traceId,
    trace: {
      query: "atlas",
      hitCount: 1,
      topFactors: [{ factor: "exact_title", count: 1 }],
    },
  });

  let activeStatus = status;
  const manager = {
    status: () => ({
      backend: "builtin",
      dirty: false,
      workspaceDir: test.workspaceDir,
      custom: {
        canonicalStore: activeStatus,
      },
    }),
    close: vi.fn().mockResolvedValue(undefined),
  };

  loadConfig.mockReturnValue(test.cfg);
  getMemorySearchManager.mockResolvedValue({
    manager,
  });

  return {
    test,
    traceId,
    atlasPageId,
    get status() {
      return activeStatus;
    },
    set status(next) {
      activeStatus = next;
    },
  };
}

async function invoke(
  handler: (opts: {
    req: never;
    params: Record<string, unknown>;
    respond: (...args: unknown[]) => void;
    context: never;
    client: null;
    isWebchatConnect: () => false;
  }) => Promise<void>,
  params: Record<string, unknown>,
) {
  const respond = vi.fn();
  await handler({
    req: {} as never,
    params,
    respond: respond as never,
    context: {} as never,
    client: null,
    isWebchatConnect: () => false,
  });
  return respond;
}

afterEach(async () => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  loadConfig.mockReset();
  getMemorySearchManager.mockReset();
});

describe("native memory gateway handlers", () => {
  it("serves wiki list, detail, history, and ledger-backed updates", async () => {
    const seeded = await seedNativeMemory();

    const listRespond = await invoke(handleMemoryWikiListGatewayRequest, {
      agentId: "main",
      query: "atlas",
    });
    const listResult = listRespond.mock.calls[0]?.[1] as {
      pages: Array<{
        title: string;
        reasonTags?: Array<{ code: string }>;
        trace?: { query?: string; hitCount?: number };
      }>;
    };
    const atlasListPage = listResult.pages.find((page) => page.title === "Project Atlas");
    expect(atlasListPage).toBeDefined();
    expect(atlasListPage?.reasonTags?.map((tag) => tag.code)).toEqual(
      expect.arrayContaining(["alias_exact"]),
    );
    expect(atlasListPage?.trace).toEqual(expect.objectContaining({ query: "atlas", hitCount: 3 }));

    const getRespond = await invoke(handleMemoryWikiGetGatewayRequest, {
      agentId: "main",
      pageId: seeded.atlasPageId,
      query: "atlas",
    });
    const getResult = getRespond.mock.calls[0]?.[1] as {
      page: {
        claims: Array<{ claim: string }>;
        evidence: Array<{ source?: string }>;
        backlinks: Array<{ title: string }>;
        contextPreview?: { trace?: unknown };
        content: string;
      };
    };
    expect(getResult.page.claims[0]?.claim).toContain("roadmap sign-off");
    expect(getResult.page.evidence[0]?.source).toContain("project-atlas");
    expect(getResult.page.backlinks.map((entry) => entry.title)).toContain("Roadmap");
    expect(getResult.page.contextPreview?.trace).toBeDefined();
    expect(getResult.page.content).toContain("priority: high");

    const historyRespond = await invoke(handleMemoryWikiHistoryGatewayRequest, {
      agentId: "main",
      pageId: seeded.atlasPageId,
    });
    expect(historyRespond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        history: expect.arrayContaining([
          expect.objectContaining({
            eventId: expect.any(String),
            summary: expect.any(String),
          }),
        ]),
      }),
      undefined,
    );

    const updateRespond = await invoke(handleMemoryWikiUpdateGatewayRequest, {
      agentId: "main",
      pageId: seeded.atlasPageId,
      title: "Project Atlas",
      content: [
        "---",
        "aliases:",
        "  - Atlas",
        "tags:",
        "  - pinned",
        "priority: urgent",
        "---",
        "# Project Atlas",
        "",
        "Updated blocker review.",
        "Launch blockers depend on [[memory/roadmap]].",
        "",
      ].join("\n"),
    });
    const updateResult = updateRespond.mock.calls[0]?.[1] as {
      sync?: { lastSyncedLamport?: number };
      page?: { content: string; revision?: { eventId?: string } };
    };
    expect(updateResult.page?.content).toContain("priority: urgent");
    expect(updateResult.page?.content).toContain("Updated blocker review.");
    expect(updateResult.page?.revision?.eventId).toBeTruthy();
    expect(updateResult.sync?.lastSyncedLamport).toBeGreaterThan(0);

    const workspaceProjection = await fs.readFile(
      path.join(seeded.test.workspaceDir, "memory", "project-atlas.md"),
      "utf8",
    );
    expect(workspaceProjection).toContain("priority: urgent");
    expect(workspaceProjection).toContain("Updated blocker review.");

    const updatedDb = openDb(seeded.status.path);
    try {
      const aliasCount =
        (
          updatedDb
            .prepare(`SELECT COUNT(*) AS count FROM page_aliases WHERE page_id = ?`)
            .get(seeded.atlasPageId) as { count?: number } | undefined
        )?.count ?? 0;
      const tagCount =
        (
          updatedDb
            .prepare(`SELECT COUNT(*) AS count FROM page_tags WHERE page_id = ?`)
            .get(seeded.atlasPageId) as { count?: number } | undefined
        )?.count ?? 0;
      expect(aliasCount).toBeGreaterThan(0);
      expect(tagCount).toBeGreaterThan(0);
    } finally {
      updatedDb.close();
    }

    await fs.rm(seeded.test.root, { recursive: true, force: true });
  });

  it("serves note aliases over the canonical markdown pages", async () => {
    const seeded = await seedNativeMemory();

    const listRespond = await invoke(handleMemoryNotesListGatewayRequest, {
      agentId: "main",
      query: "atlas",
    });
    const listResult = listRespond.mock.calls[0]?.[1] as {
      notes: Array<{ title: string }>;
    };
    expect(listResult.notes.map((note) => note.title)).toContain("Project Atlas");

    const getRespond = await invoke(handleMemoryNotesGetGatewayRequest, {
      agentId: "main",
      noteId: seeded.atlasPageId,
      query: "atlas",
    });
    const getResult = getRespond.mock.calls[0]?.[1] as {
      note: {
        attachments?: Array<{ name: string }>;
        content: string;
      };
    };
    expect(getResult.note.attachments?.map((attachment) => attachment.name)).toContain(
      "product-brief.pdf",
    );
    expect(getResult.note.content).toContain("priority: high");

    const historyRespond = await invoke(handleMemoryNotesHistoryGatewayRequest, {
      agentId: "main",
      noteId: seeded.atlasPageId,
    });
    expect(historyRespond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        noteId: seeded.atlasPageId,
        history: expect.arrayContaining([expect.objectContaining({ eventId: expect.any(String) })]),
      }),
      undefined,
    );

    const updateRespond = await invoke(handleMemoryNotesUpdateGatewayRequest, {
      agentId: "main",
      noteId: seeded.atlasPageId,
      title: "Project Atlas",
      content: "# Project Atlas\n\nAtlas updated from notes API.\n",
    });
    const updateResult = updateRespond.mock.calls[0]?.[1] as {
      note?: { content: string };
    };
    expect(updateResult.note?.content).toContain("Atlas updated from notes API.");

    await fs.rm(seeded.test.root, { recursive: true, force: true });
  });

  it("serves files, related pages, and exports coherent snapshots", async () => {
    const seeded = await seedNativeMemory();

    const listRespond = await invoke(handleMemoryFilesListGatewayRequest, {
      agentId: "main",
      query: "pdf",
    });
    expect(listRespond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        files: [
          expect.objectContaining({
            id: "product-brief.pdf",
            mediaType: "application/pdf",
            previewKind: "pdf",
            sha256: "sha-product-brief",
            relatedPagesCount: 1,
            primaryPage: expect.objectContaining({
              pageId: seeded.atlasPageId,
              entityId: seeded.atlasPageId,
              title: "Project Atlas",
            }),
            origin: expect.objectContaining({
              actorId: "atlas",
              pageId: seeded.atlasPageId,
              entityId: seeded.atlasPageId,
            }),
            reasonTags: expect.arrayContaining([expect.objectContaining({ code: "title" })]),
            trace: expect.objectContaining({ query: "pdf" }),
          }),
        ],
      }),
      undefined,
    );

    const getRespond = await invoke(handleMemoryFilesGetGatewayRequest, {
      agentId: "main",
      fileId: "product-brief.pdf",
      query: "pdf",
    });
    const fileResult = getRespond.mock.calls[0]?.[1] as {
      file: {
        preview: { kind: string; bytesBase64?: string };
        download: { bytesBase64: string };
        relatedPages: Array<{ title: string; pageId: string; entityId: string }>;
      };
    };
    expect(fileResult.file.relatedPages[0]?.title).toBe("Project Atlas");
    expect(fileResult.file.relatedPages[0]?.pageId).toBe(seeded.atlasPageId);
    expect(fileResult.file.relatedPages[0]?.entityId).toBe(seeded.atlasPageId);
    expect(fileResult.file.preview.kind).toBe("pdf");
    expect(fileResult.file.preview.bytesBase64).toBe("YnJpZWYtcGRm");
    expect(fileResult.file.download.bytesBase64).toBe("YnJpZWYtcGRm");

    const filteredGetRespond = await invoke(handleMemoryFilesGetGatewayRequest, {
      agentId: "main",
      fileId: "product-brief.pdf",
      query: "roadmap",
    });
    expect(filteredGetRespond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        file: expect.objectContaining({
          id: "product-brief.pdf",
          name: "product-brief.pdf",
        }),
      }),
      undefined,
    );

    const jsonRespond = await invoke(handleMemoryExportGatewayRequest, {
      agentId: "main",
      format: "json",
    });
    const jsonResult = jsonRespond.mock.calls[0]?.[1] as { content: string };
    const parsed = JSON.parse(jsonResult.content) as {
      notes: Array<{ title: string }>;
      attachments: Array<{ name: string }>;
    };
    expect(parsed.notes.map((note) => note.title)).toContain("Project Atlas");
    expect(parsed.attachments.map((file) => file.name)).toContain("product-brief.pdf");

    const zipRespond = await invoke(handleMemoryExportGatewayRequest, {
      agentId: "main",
      format: "zip",
    });
    const zipResult = zipRespond.mock.calls[0]?.[1] as { bytesBase64: string };
    const zip = await JSZip.loadAsync(Buffer.from(zipResult.bytesBase64, "base64"));
    expect(await zip.file("memory/project-atlas.md")?.async("string")).toContain("Project Atlas");
    expect(zip.file("attachments/product-brief.pdf")).toBeTruthy();

    await fs.rm(seeded.test.root, { recursive: true, force: true });
  });

  it("loads stored retrieval traces by id", async () => {
    const seeded = await seedNativeMemory();

    const respond = await invoke(handleMemoryTraceGetGatewayRequest, {
      agentId: "main",
      traceId: seeded.traceId,
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        traceId: seeded.traceId,
        raw: expect.objectContaining({ query: "atlas" }),
        reasonTags: expect.arrayContaining([expect.objectContaining({ code: "exact_title" })]),
      }),
      undefined,
    );

    await fs.rm(seeded.test.root, { recursive: true, force: true });
  });

  it("removes aliases and tags when the edited markdown no longer defines them", async () => {
    const seeded = await seedNativeMemory();

    await invoke(handleMemoryWikiUpdateGatewayRequest, {
      agentId: "main",
      pageId: seeded.atlasPageId,
      title: "Project Atlas",
      content: "# Project Atlas\n\nClean body.\n",
    });

    const updatedDb = openDb(seeded.status.path);
    try {
      const explicitAliasCount =
        (
          updatedDb
            .prepare(
              `SELECT COUNT(*) AS count
               FROM page_aliases
               WHERE page_id = ? AND alias_key = ?`,
            )
            .get(seeded.atlasPageId, "atlas") as { count?: number } | undefined
        )?.count ?? 0;
      const tagCount =
        (
          updatedDb
            .prepare(`SELECT COUNT(*) AS count FROM page_tags WHERE page_id = ?`)
            .get(seeded.atlasPageId) as { count?: number } | undefined
        )?.count ?? 0;
      // Canonical aliases still include normalized title/path keys, but explicit frontmatter aliases
      // must disappear when the edited markdown removes them.
      expect(explicitAliasCount).toBe(0);
      expect(tagCount).toBe(0);
    } finally {
      updatedDb.close();
    }

    const workspaceProjection = await fs.readFile(
      path.join(seeded.test.workspaceDir, "memory", "project-atlas.md"),
      "utf8",
    );
    expect(workspaceProjection).not.toContain("\n  - Atlas\n");
    expect(workspaceProjection).not.toContain("tags:");

    await fs.rm(seeded.test.root, { recursive: true, force: true });
  });

  it("revives workspace pages on the next canonical sync after a tombstone", async () => {
    const seeded = await seedNativeMemory();

    const tombstoned = await memoryWriteEvent({
      cfg: seeded.test.cfg,
      agentId: "main",
      workspaceDir: seeded.test.workspaceDir,
      backend: "builtin",
      env: process.env,
      events: [
        {
          actorId: "atlas",
          pageId: seeded.atlasPageId,
          type: "PAGE_TOMBSTONED",
          payload: {
            pageId: seeded.atlasPageId,
            tombstoned: true,
            updatedAtMs: Date.now(),
          },
        },
      ],
    });
    seeded.status = tombstoned.status;

    seeded.status = await syncCanonicalMemoryStore({
      cfg: seeded.test.cfg,
      agentId: "main",
      workspaceDir: seeded.test.workspaceDir,
      backend: "builtin",
      env: process.env,
    });

    const db = openDb(seeded.status.path);
    try {
      const page =
        (
          db
            .prepare(
              `SELECT tombstoned
               FROM pages
               WHERE page_id = ?`,
            )
            .get(seeded.atlasPageId) as { tombstoned?: number } | undefined
        )?.tombstoned ?? 1;
      expect(page).toBe(0);
    } finally {
      db.close();
    }

    const listRespond = await invoke(handleMemoryWikiListGatewayRequest, {
      agentId: "main",
      query: "atlas",
    });
    const listResult = listRespond.mock.calls[0]?.[1] as {
      pages: Array<{ title: string }>;
    };
    expect(listResult.pages.map((page) => page.title)).toContain("Project Atlas");

    await fs.rm(seeded.test.root, { recursive: true, force: true });
  });
});
