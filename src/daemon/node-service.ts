import {
  NODE_SERVICE_KIND,
  NODE_SERVICE_MARKER,
  NODE_WINDOWS_TASK_SCRIPT_NAME,
  resolveNodeLaunchAgentLabel,
  resolveNodeSystemdServiceName,
  resolveNodeWindowsTaskName,
} from "./constants.js";
import type { GatewayService, GatewayServiceInstallArgs } from "./service.js";
import { resolveGatewayService } from "./service.js";

function withNodeServiceEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...env,
    ALISIO_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
    OPENCLAW_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
    ALISIO_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
    OPENCLAW_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
    ALISIO_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
    OPENCLAW_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
    ALISIO_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
    OPENCLAW_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
    ALISIO_LOG_PREFIX: "node",
    OPENCLAW_LOG_PREFIX: "node",
    ALISIO_SERVICE_MARKER: NODE_SERVICE_MARKER,
    OPENCLAW_SERVICE_MARKER: NODE_SERVICE_MARKER,
    ALISIO_SERVICE_KIND: NODE_SERVICE_KIND,
    OPENCLAW_SERVICE_KIND: NODE_SERVICE_KIND,
  };
}

function withNodeInstallEnv(args: GatewayServiceInstallArgs): GatewayServiceInstallArgs {
  return {
    ...args,
    env: withNodeServiceEnv(args.env),
    environment: {
      ...args.environment,
      ALISIO_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
      OPENCLAW_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(),
      ALISIO_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
      OPENCLAW_SYSTEMD_UNIT: resolveNodeSystemdServiceName(),
      ALISIO_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
      OPENCLAW_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(),
      ALISIO_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
      OPENCLAW_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
      ALISIO_LOG_PREFIX: "node",
      OPENCLAW_LOG_PREFIX: "node",
      ALISIO_SERVICE_MARKER: NODE_SERVICE_MARKER,
      OPENCLAW_SERVICE_MARKER: NODE_SERVICE_MARKER,
      ALISIO_SERVICE_KIND: NODE_SERVICE_KIND,
      OPENCLAW_SERVICE_KIND: NODE_SERVICE_KIND,
    },
  };
}

export function resolveNodeService(): GatewayService {
  const base = resolveGatewayService();
  return {
    ...base,
    stage: async (args) => {
      return base.stage(withNodeInstallEnv(args));
    },
    install: async (args) => {
      return base.install(withNodeInstallEnv(args));
    },
    uninstall: async (args) => {
      return base.uninstall({ ...args, env: withNodeServiceEnv(args.env) });
    },
    stop: async (args) => {
      return base.stop({ ...args, env: withNodeServiceEnv(args.env ?? {}) });
    },
    restart: async (args) => {
      return base.restart({ ...args, env: withNodeServiceEnv(args.env ?? {}) });
    },
    isLoaded: async (args) => {
      return base.isLoaded({ env: withNodeServiceEnv(args.env ?? {}) });
    },
    readCommand: (env) => base.readCommand(withNodeServiceEnv(env)),
    readRuntime: (env) => base.readRuntime(withNodeServiceEnv(env)),
  };
}
