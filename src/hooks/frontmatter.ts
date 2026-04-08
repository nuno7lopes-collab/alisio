import { parseFrontmatterBlock } from "../markdown/frontmatter.js";
import {
  applyAlisioManifestInstallCommonFields,
  getFrontmatterString,
  normalizeStringList,
  parseAlisioManifestInstallBase,
  parseFrontmatterBool,
  resolveAlisioManifestBlock,
  resolveAlisioManifestInstall,
  resolveAlisioManifestOs,
  resolveAlisioManifestRequires,
} from "../shared/frontmatter.js";
import type {
  OpenClawHookMetadata,
  HookEntry,
  HookInstallSpec,
  HookInvocationPolicy,
  ParsedHookFrontmatter,
} from "./types.js";

export function parseFrontmatter(content: string): ParsedHookFrontmatter {
  return parseFrontmatterBlock(content);
}

function parseInstallSpec(input: unknown): HookInstallSpec | undefined {
  const parsed = parseAlisioManifestInstallBase(input, ["bundled", "npm", "git"]);
  if (!parsed) {
    return undefined;
  }
  const { raw } = parsed;
  const spec = applyAlisioManifestInstallCommonFields<HookInstallSpec>(
    {
      kind: parsed.kind as HookInstallSpec["kind"],
    },
    parsed,
  );
  if (typeof raw.package === "string") {
    spec.package = raw.package;
  }
  if (typeof raw.repository === "string") {
    spec.repository = raw.repository;
  }

  return spec;
}

export function resolveOpenClawMetadata(
  frontmatter: ParsedHookFrontmatter,
): OpenClawHookMetadata | undefined {
  const metadataObj = resolveAlisioManifestBlock({ frontmatter });
  if (!metadataObj) {
    return undefined;
  }
  const requires = resolveAlisioManifestRequires(metadataObj);
  const install = resolveAlisioManifestInstall(metadataObj, parseInstallSpec);
  const osRaw = resolveAlisioManifestOs(metadataObj);
  const eventsRaw = normalizeStringList(metadataObj.events);
  return {
    always: typeof metadataObj.always === "boolean" ? metadataObj.always : undefined,
    emoji: typeof metadataObj.emoji === "string" ? metadataObj.emoji : undefined,
    homepage: typeof metadataObj.homepage === "string" ? metadataObj.homepage : undefined,
    hookKey: typeof metadataObj.hookKey === "string" ? metadataObj.hookKey : undefined,
    export: typeof metadataObj.export === "string" ? metadataObj.export : undefined,
    os: osRaw.length > 0 ? osRaw : undefined,
    events: eventsRaw.length > 0 ? eventsRaw : [],
    requires: requires,
    install: install.length > 0 ? install : undefined,
  };
}

export function resolveHookInvocationPolicy(
  frontmatter: ParsedHookFrontmatter,
): HookInvocationPolicy {
  return {
    enabled: parseFrontmatterBool(getFrontmatterString(frontmatter, "enabled"), true),
  };
}

export function resolveHookKey(hookName: string, entry?: HookEntry): string {
  return entry?.metadata?.hookKey ?? hookName;
}
