import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { createDesktopWorkerInstallation } from "./ai-accounts.js";
import {
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_PROVIDER,
  DESKTOP_WORKER_VERSION,
  OPENAI_CODEX_PROVIDER,
  type AiProfile,
  type MockSession,
  type PersistedConversation,
  type PersistedDesktopState,
  type RuntimeBinding,
  type WorkerAiCredential,
  type WorkerSettings,
} from "./types.js";

const MockSessionSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  sessionToken: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const WorkerSettingsSchema = z.object({
  provider: z.union([z.literal(DEFAULT_OPENAI_PROVIDER), z.literal(OPENAI_CODEX_PROVIDER)]),
  model: z.string().min(1),
  openAiApiKey: z.string().min(1).optional(),
});

const DesktopWorkerInstallationSchema = z.object({
  deviceId: z.string().uuid(),
  workerId: z.string().uuid(),
  createdAt: z.number().int().nonnegative(),
});

const AiProfileSchema: z.ZodType<AiProfile> = z.object({
  id: z.string().uuid(),
  scope: z.union([z.literal("personal"), z.literal("org_shared")]),
  ownerUserId: z.string().min(1).optional(),
  ownerOrgId: z.string().min(1).optional(),
  provider: z.literal(OPENAI_CODEX_PROVIDER),
  canonicalIdentity: z.string().min(1),
  label: z.string().min(1),
  healthStatus: z.union([
    z.literal("healthy"),
    z.literal("degraded"),
    z.literal("partially_available"),
    z.literal("unavailable"),
    z.literal("expired"),
  ]),
  attachmentState: z.union([z.literal("attached"), z.literal("detached")]),
  routingPolicy: z.object({
    mode: z.union([z.literal("auto"), z.literal("manual")]),
  }),
  grants: z.object({
    userIds: z.array(z.string().min(1)),
  }),
  aggregatedTelemetry: z.object({
    attachedCredentials: z.number().int().nonnegative(),
    usableCredentials: z.number().int().nonnegative(),
    lastUsedAt: z.number().int().nonnegative().optional(),
    lastError: z.string().min(1).optional(),
  }),
});

const WorkerAiCredentialSchema: z.ZodType<WorkerAiCredential> = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  workerId: z.string().uuid(),
  aiProfileId: z.string().uuid(),
  authProfileId: z.string().min(1),
  provider: z.literal(OPENAI_CODEX_PROVIDER),
  runtimeState: z.union([
    z.literal("authenticated"),
    z.literal("expired"),
    z.literal("cooldown"),
    z.literal("error"),
    z.literal("active"),
    z.literal("standby"),
  ]),
  lastAuthAt: z.number().int().nonnegative().optional(),
  expiresAt: z.number().int().nonnegative().optional(),
  lastUsedAt: z.number().int().nonnegative().optional(),
  localTelemetry: z.object({
    lastUsedAt: z.number().int().nonnegative().optional(),
  }),
  lastError: z.string().min(1).optional(),
  email: z.string().email().optional(),
  accountId: z.string().min(1).optional(),
});

const RuntimeBindingSchema: z.ZodType<RuntimeBinding> = z.object({
  workerId: z.string().uuid(),
  workerAiCredentialId: z.string().uuid(),
  boundAt: z.number().int().nonnegative(),
  reason: z.string().min(1),
});

const PersistedDesktopStateSchema = z.object({
  version: z.literal(DESKTOP_WORKER_VERSION),
  updatedAt: z.number().int().nonnegative(),
  installation: DesktopWorkerInstallationSchema,
  session: MockSessionSchema.nullable(),
  settings: WorkerSettingsSchema,
  conversation: z.object({
    messages: z.array(z.custom<PersistedConversation["messages"][number]>()),
  }),
  aiProfiles: z.array(AiProfileSchema),
  workerAiCredentials: z.array(WorkerAiCredentialSchema),
  runtimeBinding: RuntimeBindingSchema.nullable(),
});

const LegacyWorkerSettingsSchema = z.object({
  provider: z.union([z.literal(DEFAULT_OPENAI_PROVIDER), z.literal(OPENAI_CODEX_PROVIDER)]),
  model: z.string().min(1),
  openAiApiKey: z.string().min(1).optional(),
  openAiCodexProfileId: z.string().min(1).optional(),
  openAiCodexEmail: z.string().email().optional(),
});

const LegacyPersistedDesktopStateSchema = z.object({
  version: z.literal(1),
  updatedAt: z.number().int().nonnegative(),
  session: MockSessionSchema.nullable(),
  settings: LegacyWorkerSettingsSchema,
  conversation: z.object({
    messages: z.array(z.custom<PersistedConversation["messages"][number]>()),
  }),
});

export function resolveDesktopWorkerHome(explicitDir?: string): string {
  if (explicitDir?.trim()) {
    return path.resolve(explicitDir);
  }
  const envDir = process.env.LUME_DESKTOP_HOME?.trim();
  if (envDir) {
    return path.resolve(envDir);
  }
  return path.join(os.homedir(), ".lume-desktop");
}

export function createEmptyState(now: number = Date.now()): PersistedDesktopState {
  return {
    version: DESKTOP_WORKER_VERSION,
    updatedAt: now,
    installation: createDesktopWorkerInstallation(now),
    session: null,
    settings: {
      provider: DEFAULT_OPENAI_PROVIDER,
      model: DEFAULT_OPENAI_MODEL,
    },
    conversation: {
      messages: [],
    },
    aiProfiles: [],
    workerAiCredentials: [],
    runtimeBinding: null,
  };
}

function migrateLegacyState(raw: unknown): PersistedDesktopState | null {
  const parsed = LegacyPersistedDesktopStateSchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }
  return {
    version: DESKTOP_WORKER_VERSION,
    updatedAt: parsed.data.updatedAt,
    installation: createDesktopWorkerInstallation(parsed.data.updatedAt),
    session: parsed.data.session,
    settings: {
      provider: parsed.data.settings.provider,
      model: parsed.data.settings.model,
      openAiApiKey: parsed.data.settings.openAiApiKey,
    },
    conversation: parsed.data.conversation,
    aiProfiles: [],
    workerAiCredentials: [],
    runtimeBinding: null,
  };
}

export class DesktopWorkerStorage {
  readonly rootDir: string;
  readonly statePath: string;

  constructor(rootDir?: string) {
    this.rootDir = resolveDesktopWorkerHome(rootDir);
    this.statePath = path.join(this.rootDir, "state.json");
  }

  async ensureReady(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
  }

  async load(): Promise<PersistedDesktopState> {
    await this.ensureReady();
    try {
      const raw = await readFile(this.statePath, "utf8");
      const json = JSON.parse(raw) as unknown;
      const parsed = PersistedDesktopStateSchema.safeParse(json);
      if (parsed.success) {
        return parsed.data;
      }
      return migrateLegacyState(json) ?? createEmptyState();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return createEmptyState();
      }
      throw error;
    }
  }

  async save(state: PersistedDesktopState): Promise<void> {
    await this.ensureReady();
    const nextState = {
      ...state,
      updatedAt: Date.now(),
    };
    const tempPath = path.join(this.rootDir, `state.${randomUUID()}.tmp`);
    await writeFile(tempPath, `${JSON.stringify(nextState, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, this.statePath);
  }

  async update(
    updater: (
      current: PersistedDesktopState,
    ) => PersistedDesktopState | Promise<PersistedDesktopState>,
  ): Promise<PersistedDesktopState> {
    const current = await this.load();
    const next = await updater(current);
    await this.save(next);
    return next;
  }
}

export function createMockSession(params: {
  name: string;
  email: string;
  now?: number;
}): MockSession {
  const timestamp = params.now ?? Date.now();
  return {
    userId: randomUUID(),
    sessionToken: randomUUID(),
    name: params.name.trim(),
    email: params.email.trim().toLowerCase(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function mergeSettings(
  current: WorkerSettings,
  patch: Partial<WorkerSettings>,
): WorkerSettings {
  const openAiApiKey = patch.openAiApiKey?.trim();
  return {
    provider: patch.provider ?? current.provider ?? DEFAULT_OPENAI_PROVIDER,
    model: patch.model?.trim() || current.model || DEFAULT_OPENAI_MODEL,
    openAiApiKey: openAiApiKey ? openAiApiKey : current.openAiApiKey,
  };
}
