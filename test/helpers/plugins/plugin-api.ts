import type { AlisioPluginApi } from "alisio/plugin-sdk/plugin-runtime";

type TestPluginApiInput = Omit<
  Partial<AlisioPluginApi>,
  "id" | "name" | "source" | "config" | "runtime"
> &
  Pick<AlisioPluginApi, "id" | "name" | "source" | "config" | "runtime">;

export function createTestPluginApi(api: TestPluginApiInput): AlisioPluginApi {
  return {
    registrationMode: "full",
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerTool() {},
    registerHook() {},
    registerHttpRoute() {},
    registerChannel() {},
    registerGatewayMethod() {},
    registerCli() {},
    registerService() {},
    registerCliBackend() {},
    registerProvider() {},
    registerSpeechProvider() {},
    registerMediaUnderstandingProvider() {},
    registerImageGenerationProvider() {},
    registerWebSearchProvider() {},
    registerInteractiveHandler() {},
    onConversationBindingResolved() {},
    registerCommand() {},
    registerContextEngine() {},
    registerMemoryPromptSection() {},
    registerMemoryFlushPlan() {},
    registerMemoryRuntime() {},
    registerMemoryEmbeddingProvider() {},
    resolvePath(input: string) {
      return input;
    },
    on() {},
    ...api,
  };
}
