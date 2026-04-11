import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  ALISIO_LOCAL_MODEL_BACKEND,
  findAlisioLocalModelCatalogEntry,
} from "../shared/alisio-local-models.js";
import type {
  AlisioInstalledLocalModel,
  AlisioLocalModelRuntimeInspection,
} from "./alisio-local-model-runtime.js";
import type { ChatHistoryItem, Llama, LlamaModel } from "./llama-cpp.runtime.js";
import { buildRuntimeCapabilities } from "./local-model-runtime-contracts.js";
import { inspectLocalModelHardwareProfile } from "./model-hardware.js";

type InstalledLocalModelRecord = {
  modelId: string;
  modelPath: string;
  sourceUri: string;
  installedAt: string;
};

type InstalledLocalModelsManifest = {
  version: 1;
  installed: InstalledLocalModelRecord[];
};

type LocalChatMessage = {
  role: "system" | "user" | "assistant";
  text: string;
};

const MANIFEST_VERSION = 1;
let runtimeModulePromise: Promise<typeof import("./llama-cpp.runtime.js")> | null = null;
let llamaPromise: Promise<Llama> | null = null;
const loadedModelPromises = new Map<string, Promise<LlamaModel>>();

function resolveLocalModelsRoot(env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveStateDir(env), "models", "llama.cpp");
}

function resolveLocalModelsManifestPath(env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveLocalModelsRoot(env), "installed.json");
}

async function ensureLocalModelsRoot(env: NodeJS.ProcessEnv = process.env) {
  await fs.mkdir(resolveLocalModelsRoot(env), { recursive: true });
}

async function readInstalledManifest(
  env: NodeJS.ProcessEnv = process.env,
): Promise<InstalledLocalModelsManifest> {
  const manifestPath = resolveLocalModelsManifestPath(env);
  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<InstalledLocalModelsManifest>;
    if (!parsed || parsed.version !== MANIFEST_VERSION || !Array.isArray(parsed.installed)) {
      return { version: MANIFEST_VERSION, installed: [] };
    }
    return {
      version: MANIFEST_VERSION,
      installed: parsed.installed.filter((entry): entry is InstalledLocalModelRecord =>
        Boolean(
          entry &&
          typeof entry.modelId === "string" &&
          entry.modelId.trim() &&
          typeof entry.modelPath === "string" &&
          entry.modelPath.trim() &&
          typeof entry.sourceUri === "string" &&
          entry.sourceUri.trim() &&
          typeof entry.installedAt === "string" &&
          entry.installedAt.trim(),
        ),
      ),
    };
  } catch {
    return { version: MANIFEST_VERSION, installed: [] };
  }
}

async function writeInstalledManifest(
  manifest: InstalledLocalModelsManifest,
  env: NodeJS.ProcessEnv = process.env,
) {
  await ensureLocalModelsRoot(env);
  await fs.writeFile(
    resolveLocalModelsManifestPath(env),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
}

function toInstalledModel(record: InstalledLocalModelRecord): AlisioInstalledLocalModel {
  const catalogEntry = findAlisioLocalModelCatalogEntry(record.modelId);
  return {
    id: record.modelId,
    name: catalogEntry?.name ?? record.modelId,
    ownedBy: ALISIO_LOCAL_MODEL_BACKEND,
  };
}

async function hasUsableInstalledModelFile(record: InstalledLocalModelRecord) {
  try {
    const stats = await fs.stat(record.modelPath);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

export async function listInstalledAlisioLocalModels(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AlisioInstalledLocalModel[]> {
  const manifest = await readInstalledManifest(env);
  const installed: AlisioInstalledLocalModel[] = [];
  const retained: InstalledLocalModelRecord[] = [];

  for (const record of manifest.installed) {
    if (await hasUsableInstalledModelFile(record)) {
      retained.push(record);
      installed.push(toInstalledModel(record));
    }
    // Drop manifest entries whose local file vanished or is unusable.
  }

  if (retained.length !== manifest.installed.length) {
    await writeInstalledManifest({ version: MANIFEST_VERSION, installed: retained }, env);
  }

  return installed.toSorted((left, right) => left.name.localeCompare(right.name));
}

export async function inspectManagedLocalModelRuntime(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AlisioLocalModelRuntimeInspection> {
  const models = await listInstalledAlisioLocalModels(env);
  const hardware = inspectLocalModelHardwareProfile();
  if (models.length === 0) {
    return {
      backend: ALISIO_LOCAL_MODEL_BACKEND,
      runtimeKind: ALISIO_LOCAL_MODEL_BACKEND,
      runtimeLabel: "Local GGUF",
      status: "not_configured",
      message: "No local llama.cpp models are installed on this computer yet.",
      models: [],
      availableModels: [],
      hardware,
      capabilities: buildRuntimeCapabilities({
        install: true,
        update: true,
        uninstall: true,
        consentRequired: true,
      }),
      supportsInstall: true,
      supportsUpdate: true,
      supportsUninstall: true,
      consentRequired: true,
    };
  }
  return {
    backend: ALISIO_LOCAL_MODEL_BACKEND,
    runtimeKind: ALISIO_LOCAL_MODEL_BACKEND,
    runtimeLabel: "Local GGUF",
    status: "ready",
    models,
    availableModels: [],
    hardware,
    capabilities: buildRuntimeCapabilities({
      install: true,
      update: true,
      uninstall: true,
      consentRequired: true,
    }),
    supportsInstall: true,
    supportsUpdate: true,
    supportsUninstall: true,
    consentRequired: true,
  };
}

async function getLlamaRuntimeModule() {
  if (!runtimeModulePromise) {
    runtimeModulePromise = import("./llama-cpp.runtime.js");
  }
  return await runtimeModulePromise;
}

async function getLlamaInstance() {
  if (!llamaPromise) {
    llamaPromise = getLlamaRuntimeModule()
      .then((runtime) => runtime.getLlama({ logLevel: runtime.LlamaLogLevel.error }))
      .catch((error) => {
        llamaPromise = null;
        throw error;
      });
  }
  return await llamaPromise;
}

async function loadInstalledModel(record: InstalledLocalModelRecord) {
  let loadPromise = loadedModelPromises.get(record.modelPath);
  if (!loadPromise) {
    loadPromise = getLlamaInstance()
      .then((llama) =>
        llama.loadModel({
          modelPath: record.modelPath,
          gpuLayers: "auto",
          defaultContextFlashAttention: true,
        }),
      )
      .catch((error) => {
        loadedModelPromises.delete(record.modelPath);
        throw error;
      });
    loadedModelPromises.set(record.modelPath, loadPromise);
  }
  return await loadPromise;
}

async function resolveChatWrapperForLocalModel(modelId: string) {
  const catalogEntry = findAlisioLocalModelCatalogEntry(modelId);
  if (catalogEntry?.family !== "Qwen") {
    return undefined;
  }
  const runtime = await getLlamaRuntimeModule();
  // Qwen3 local GGUFs tend to spend the whole budget inside <think> unless we
  // discourage thought segments for interactive chat responses.
  return new runtime.QwenChatWrapper({ thoughts: "discourage" });
}

export async function installAlisioLocalModel(params: {
  modelId: string;
  env?: NodeJS.ProcessEnv;
  onProgress?: (status: { totalSize: number; downloadedSize: number }) => void;
}): Promise<AlisioInstalledLocalModel> {
  const env = params.env ?? process.env;
  const catalogEntry = findAlisioLocalModelCatalogEntry(params.modelId);
  if (!catalogEntry) {
    throw new Error(`unknown local model: ${params.modelId}`);
  }

  await ensureLocalModelsRoot(env);
  const runtime = await getLlamaRuntimeModule();
  const modelPath = await runtime.resolveModelFile(catalogEntry.sourceUri, {
    directory: resolveLocalModelsRoot(env),
    cli: false,
    onProgress: params.onProgress,
  });

  const manifest = await readInstalledManifest(env);
  const nextRecord: InstalledLocalModelRecord = {
    modelId: catalogEntry.id,
    modelPath,
    sourceUri: catalogEntry.sourceUri,
    installedAt: new Date().toISOString(),
  };
  const installed = manifest.installed.filter((record) => record.modelId !== catalogEntry.id);
  installed.push(nextRecord);
  await writeInstalledManifest({ version: MANIFEST_VERSION, installed }, env);
  return toInstalledModel(nextRecord);
}

export async function uninstallAlisioLocalModel(params: {
  modelId: string;
  env?: NodeJS.ProcessEnv;
}): Promise<AlisioInstalledLocalModel> {
  const env = params.env ?? process.env;
  const manifest = await readInstalledManifest(env);
  const record = manifest.installed.find((entry) => entry.modelId === params.modelId);
  if (!record) {
    throw new Error(`local model is not installed on this computer: ${params.modelId}`);
  }

  const remaining = manifest.installed.filter((entry) => entry.modelId !== params.modelId);
  await writeInstalledManifest({ version: MANIFEST_VERSION, installed: remaining }, env);

  const stillReferenced = remaining.some((entry) => entry.modelPath === record.modelPath);
  if (!stillReferenced) {
    loadedModelPromises.delete(record.modelPath);
    await fs.rm(record.modelPath, { force: true }).catch(() => undefined);
  }

  return toInstalledModel(record);
}

function coerceMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part.trim();
        }
        if (!part || typeof part !== "object") {
          return "";
        }
        const text =
          typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : typeof (part as { content?: unknown }).content === "string"
              ? (part as { content: string }).content
              : "";
        return text.trim();
      })
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  if (content && typeof content === "object") {
    const text =
      typeof (content as { text?: unknown }).text === "string"
        ? (content as { text: string }).text
        : typeof (content as { content?: unknown }).content === "string"
          ? (content as { content: string }).content
          : "";
    return text.trim();
  }
  return "";
}

function normalizeChatMessages(messages: unknown[]): LocalChatMessage[] {
  return messages.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }
    const role =
      typeof (entry as { role?: unknown }).role === "string"
        ? (entry as { role: string }).role.trim().toLowerCase()
        : "";
    if (role !== "system" && role !== "user" && role !== "assistant") {
      return [];
    }
    const text = coerceMessageText((entry as { content?: unknown }).content);
    if (!text) {
      return [];
    }
    return [{ role, text }];
  });
}

function buildChatRequest(messages: unknown[]) {
  const normalized = normalizeChatMessages(messages);
  const lastUserIndex = normalized.findLastIndex((message) => message.role === "user");
  if (lastUserIndex < 0) {
    throw new Error("a final user message is required");
  }

  const systemPrompt =
    normalized
      .filter((message, index) => message.role === "system" && index <= lastUserIndex)
      .map((message) => message.text)
      .join("\n\n")
      .trim() || undefined;

  const history: ChatHistoryItem[] = [];
  for (const message of normalized.slice(0, lastUserIndex)) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      history.push({ type: "user", text: message.text });
      continue;
    }
    history.push({
      type: "model",
      response: [message.text],
    });
  }

  return {
    systemPrompt,
    history,
    prompt: normalized[lastUserIndex]?.text ?? "",
  };
}

export async function chatWithInstalledAlisioLocalModel(params: {
  modelId: string;
  messages: unknown[];
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  onTextChunk?: (text: string) => void | Promise<void>;
}): Promise<{ modelId: string; text: string }> {
  const manifest = await readInstalledManifest();
  const record = manifest.installed.find((entry) => entry.modelId === params.modelId);
  if (!record) {
    throw new Error(`local model is not installed on this computer: ${params.modelId}`);
  }

  const runtime = await getLlamaRuntimeModule();
  const { systemPrompt, history, prompt } = buildChatRequest(params.messages);
  const model = await loadInstalledModel(record);
  const context = await model.createContext();
  try {
    const chatWrapper = await resolveChatWrapperForLocalModel(params.modelId);
    const session = new runtime.LlamaChatSession({
      contextSequence: context.getSequence(),
      ...(chatWrapper ? { chatWrapper } : {}),
      systemPrompt,
      autoDisposeSequence: true,
    });
    if (history.length > 0) {
      session.setChatHistory(history);
    }
    let text = "";
    const response = await session.prompt(prompt, {
      signal: params.signal,
      stopOnAbortSignal: true,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
      onTextChunk: (chunk) => {
        text += chunk;
        void params.onTextChunk?.(chunk);
      },
    });
    return {
      modelId: params.modelId,
      text: text || response,
    };
  } finally {
    await context.dispose();
  }
}
