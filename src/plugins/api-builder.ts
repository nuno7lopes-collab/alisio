import type { AlisioConfig } from "../config/config.js";
import type { PluginRuntime } from "./runtime/types.js";
import type { AlisioPluginApi, PluginLogger } from "./types.js";

export type BuildPluginApiParams = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  rootDir?: string;
  registrationMode: AlisioPluginApi["registrationMode"];
  config: AlisioConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;
  resolvePath: (input: string) => string;
  handlers?: Partial<
    Pick<
      AlisioPluginApi,
      | "registerTool"
      | "registerHook"
      | "registerHttpRoute"
      | "registerChannel"
      | "registerGatewayMethod"
      | "registerCli"
      | "registerService"
      | "registerCliBackend"
      | "registerProvider"
      | "registerSpeechProvider"
      | "registerMediaUnderstandingProvider"
      | "registerImageGenerationProvider"
      | "registerWebSearchProvider"
      | "registerInteractiveHandler"
      | "onConversationBindingResolved"
      | "registerCommand"
      | "registerContextEngine"
      | "registerMemoryPromptSection"
      | "registerMemoryFlushPlan"
      | "registerMemoryRuntime"
      | "registerMemoryEmbeddingProvider"
      | "on"
    >
  >;
};

const noopRegisterTool: AlisioPluginApi["registerTool"] = () => {};
const noopRegisterHook: AlisioPluginApi["registerHook"] = () => {};
const noopRegisterHttpRoute: AlisioPluginApi["registerHttpRoute"] = () => {};
const noopRegisterChannel: AlisioPluginApi["registerChannel"] = () => {};
const noopRegisterGatewayMethod: AlisioPluginApi["registerGatewayMethod"] = () => {};
const noopRegisterCli: AlisioPluginApi["registerCli"] = () => {};
const noopRegisterService: AlisioPluginApi["registerService"] = () => {};
const noopRegisterCliBackend: AlisioPluginApi["registerCliBackend"] = () => {};
const noopRegisterProvider: AlisioPluginApi["registerProvider"] = () => {};
const noopRegisterSpeechProvider: AlisioPluginApi["registerSpeechProvider"] = () => {};
const noopRegisterMediaUnderstandingProvider: AlisioPluginApi["registerMediaUnderstandingProvider"] =
  () => {};
const noopRegisterImageGenerationProvider: AlisioPluginApi["registerImageGenerationProvider"] =
  () => {};
const noopRegisterWebSearchProvider: AlisioPluginApi["registerWebSearchProvider"] = () => {};
const noopRegisterInteractiveHandler: AlisioPluginApi["registerInteractiveHandler"] = () => {};
const noopOnConversationBindingResolved: AlisioPluginApi["onConversationBindingResolved"] =
  () => {};
const noopRegisterCommand: AlisioPluginApi["registerCommand"] = () => {};
const noopRegisterContextEngine: AlisioPluginApi["registerContextEngine"] = () => {};
const noopRegisterMemoryPromptSection: AlisioPluginApi["registerMemoryPromptSection"] = () => {};
const noopRegisterMemoryFlushPlan: AlisioPluginApi["registerMemoryFlushPlan"] = () => {};
const noopRegisterMemoryRuntime: AlisioPluginApi["registerMemoryRuntime"] = () => {};
const noopRegisterMemoryEmbeddingProvider: AlisioPluginApi["registerMemoryEmbeddingProvider"] =
  () => {};
const noopOn: AlisioPluginApi["on"] = () => {};

export function buildPluginApi(params: BuildPluginApiParams): AlisioPluginApi {
  const handlers = params.handlers ?? {};
  return {
    id: params.id,
    name: params.name,
    version: params.version,
    description: params.description,
    source: params.source,
    rootDir: params.rootDir,
    registrationMode: params.registrationMode,
    config: params.config,
    pluginConfig: params.pluginConfig,
    runtime: params.runtime,
    logger: params.logger,
    registerTool: handlers.registerTool ?? noopRegisterTool,
    registerHook: handlers.registerHook ?? noopRegisterHook,
    registerHttpRoute: handlers.registerHttpRoute ?? noopRegisterHttpRoute,
    registerChannel: handlers.registerChannel ?? noopRegisterChannel,
    registerGatewayMethod: handlers.registerGatewayMethod ?? noopRegisterGatewayMethod,
    registerCli: handlers.registerCli ?? noopRegisterCli,
    registerService: handlers.registerService ?? noopRegisterService,
    registerCliBackend: handlers.registerCliBackend ?? noopRegisterCliBackend,
    registerProvider: handlers.registerProvider ?? noopRegisterProvider,
    registerSpeechProvider: handlers.registerSpeechProvider ?? noopRegisterSpeechProvider,
    registerMediaUnderstandingProvider:
      handlers.registerMediaUnderstandingProvider ?? noopRegisterMediaUnderstandingProvider,
    registerImageGenerationProvider:
      handlers.registerImageGenerationProvider ?? noopRegisterImageGenerationProvider,
    registerWebSearchProvider: handlers.registerWebSearchProvider ?? noopRegisterWebSearchProvider,
    registerInteractiveHandler:
      handlers.registerInteractiveHandler ?? noopRegisterInteractiveHandler,
    onConversationBindingResolved:
      handlers.onConversationBindingResolved ?? noopOnConversationBindingResolved,
    registerCommand: handlers.registerCommand ?? noopRegisterCommand,
    registerContextEngine: handlers.registerContextEngine ?? noopRegisterContextEngine,
    registerMemoryPromptSection:
      handlers.registerMemoryPromptSection ?? noopRegisterMemoryPromptSection,
    registerMemoryFlushPlan: handlers.registerMemoryFlushPlan ?? noopRegisterMemoryFlushPlan,
    registerMemoryRuntime: handlers.registerMemoryRuntime ?? noopRegisterMemoryRuntime,
    registerMemoryEmbeddingProvider:
      handlers.registerMemoryEmbeddingProvider ?? noopRegisterMemoryEmbeddingProvider,
    resolvePath: params.resolvePath,
    on: handlers.on ?? noopOn,
  };
}
