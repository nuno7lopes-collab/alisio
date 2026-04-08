import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import {
  listChannelPluginCatalogEntries,
  type ChannelPluginCatalogEntry,
} from "../../channels/plugins/catalog.js";
import type { ChannelMeta, ChannelPlugin } from "../../channels/plugins/types.js";
import { isProductChatChannelId, listProductChatChannels } from "../../channels/product-surface.js";
import type { AlisioConfig } from "../../config/config.js";
import { applyPluginAutoEnable } from "../../config/plugin-auto-enable.js";
import { loadPluginManifestRegistry } from "../../plugins/manifest-registry.js";
import type { ChannelChoice } from "../onboard-types.js";

type ChannelCatalogEntry = {
  id: ChannelChoice;
  meta: ChannelMeta;
};

export type ResolvedChannelSetupEntries = {
  entries: ChannelCatalogEntry[];
  installedCatalogEntries: ChannelPluginCatalogEntry[];
  installableCatalogEntries: ChannelPluginCatalogEntry[];
  installedCatalogById: Map<ChannelChoice, ChannelPluginCatalogEntry>;
  installableCatalogById: Map<ChannelChoice, ChannelPluginCatalogEntry>;
};

function resolveWorkspaceDir(cfg: AlisioConfig, workspaceDir?: string): string | undefined {
  return workspaceDir ?? resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
}

export function listManifestInstalledChannelIds(params: {
  cfg: AlisioConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): Set<ChannelChoice> {
  const resolvedConfig = applyPluginAutoEnable({
    config: params.cfg,
    env: params.env ?? process.env,
  }).config;
  const workspaceDir = resolveWorkspaceDir(resolvedConfig, params.workspaceDir);
  return new Set(
    loadPluginManifestRegistry({
      config: resolvedConfig,
      workspaceDir,
      env: params.env ?? process.env,
    }).plugins.flatMap((plugin) => plugin.channels as ChannelChoice[]),
  );
}

export function isCatalogChannelInstalled(params: {
  cfg: AlisioConfig;
  entry: ChannelPluginCatalogEntry;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  return listManifestInstalledChannelIds(params).has(params.entry.id as ChannelChoice);
}

export function resolveChannelSetupEntries(params: {
  cfg: AlisioConfig;
  installedPlugins: ChannelPlugin[];
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
}): ResolvedChannelSetupEntries {
  const workspaceDir = resolveWorkspaceDir(params.cfg, params.workspaceDir);
  const manifestInstalledIds = listManifestInstalledChannelIds({
    cfg: params.cfg,
    workspaceDir,
    env: params.env,
  });
  const installedPlugins = params.installedPlugins.filter((plugin) =>
    isProductChatChannelId(plugin.id),
  );
  const installedPluginIds = new Set(installedPlugins.map((plugin) => plugin.id));
  const catalogEntries = listChannelPluginCatalogEntries({ workspaceDir }).filter((entry) =>
    isProductChatChannelId(entry.id),
  );
  const installedCatalogEntries = catalogEntries.filter(
    (entry) =>
      !installedPluginIds.has(entry.id) && manifestInstalledIds.has(entry.id as ChannelChoice),
  );
  const installableCatalogEntries = catalogEntries.filter(
    (entry) =>
      !installedPluginIds.has(entry.id) && !manifestInstalledIds.has(entry.id as ChannelChoice),
  );

  const metaById = new Map<string, ChannelMeta>();
  for (const meta of listProductChatChannels()) {
    metaById.set(meta.id, meta);
  }
  for (const plugin of installedPlugins) {
    metaById.set(plugin.id, plugin.meta);
  }
  for (const entry of installedCatalogEntries) {
    if (!metaById.has(entry.id)) {
      metaById.set(entry.id, entry.meta);
    }
  }
  for (const entry of installableCatalogEntries) {
    if (!metaById.has(entry.id)) {
      metaById.set(entry.id, entry.meta);
    }
  }

  return {
    entries: Array.from(metaById, ([id, meta]) => ({
      id: id as ChannelChoice,
      meta,
    })),
    installedCatalogEntries,
    installableCatalogEntries,
    installedCatalogById: new Map(
      installedCatalogEntries.map((entry) => [entry.id as ChannelChoice, entry]),
    ),
    installableCatalogById: new Map(
      installableCatalogEntries.map((entry) => [entry.id as ChannelChoice, entry]),
    ),
  };
}
