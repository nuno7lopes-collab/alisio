import {
  createBrowserPluginService,
  createBrowserTool,
  definePluginEntry,
  handleBrowserGatewayRequest,
  registerBrowserCli,
  type AlisioPluginToolContext,
  type AlisioPluginToolFactory,
} from "./runtime-api.js";

export default definePluginEntry({
  id: "browser",
  name: "Browser",
  description: "Default browser tool plugin",
  register(api) {
    api.registerTool(((ctx: AlisioPluginToolContext) =>
      createBrowserTool({
        sandboxBridgeUrl: ctx.browser?.sandboxBridgeUrl,
        resolveSandboxBridgeUrl: ctx.browser?.resolveSandboxBridgeUrl,
        allowHostControl: ctx.browser?.allowHostControl,
        preferSandbox: ctx.browser?.preferSandbox,
        agentSessionKey: ctx.sessionKey,
      })) as AlisioPluginToolFactory);
    api.registerCli(({ program }) => registerBrowserCli(program), { commands: ["browser"] });
    api.registerGatewayMethod("browser.request", handleBrowserGatewayRequest, {
      scope: "operator.write",
    });
    api.registerService(createBrowserPluginService());
  },
});
