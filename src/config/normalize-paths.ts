import path from "node:path";
import { isPlainObject, resolveUserPath } from "../utils.js";
import { resolveLegacyStateDirs, resolveNewStateDir } from "./paths.js";
import type { AlisioConfig } from "./types.js";

const PATH_VALUE_RE = /^~(?=$|[\\/])/;

const PATH_KEY_RE = /(dir|path|paths|file|root|workspace)$/i;
const PATH_LIST_KEYS = new Set(["paths", "pathPrepend"]);

function isPathWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function rewriteLegacyStateDirPrefix(value: string): string {
  if (!path.isAbsolute(value)) {
    return value;
  }
  const resolvedValue = path.resolve(value);
  const targetDir = path.resolve(resolveNewStateDir());
  for (const legacyDir of resolveLegacyStateDirs().map((entry) => path.resolve(entry))) {
    if (legacyDir === targetDir || !isPathWithinRoot(resolvedValue, legacyDir)) {
      continue;
    }
    const suffix = path.relative(legacyDir, resolvedValue);
    return suffix ? path.join(targetDir, suffix) : targetDir;
  }
  return resolvedValue;
}

function normalizeStringValue(key: string | undefined, value: string): string {
  if (!key || (!PATH_KEY_RE.test(key) && !PATH_LIST_KEYS.has(key))) {
    return value;
  }
  const normalized = PATH_VALUE_RE.test(value.trim()) ? resolveUserPath(value) : value;
  return rewriteLegacyStateDirPrefix(normalized);
}

function normalizeAny(key: string | undefined, value: unknown): unknown {
  if (typeof value === "string") {
    return normalizeStringValue(key, value);
  }

  if (Array.isArray(value)) {
    const normalizeChildren = Boolean(key && PATH_LIST_KEYS.has(key));
    return value.map((entry) => {
      if (typeof entry === "string") {
        return normalizeChildren ? normalizeStringValue(key, entry) : entry;
      }
      if (Array.isArray(entry)) {
        return normalizeAny(undefined, entry);
      }
      if (isPlainObject(entry)) {
        return normalizeAny(undefined, entry);
      }
      return entry;
    });
  }

  if (!isPlainObject(value)) {
    return value;
  }

  for (const [childKey, childValue] of Object.entries(value)) {
    const next = normalizeAny(childKey, childValue);
    if (next !== childValue) {
      value[childKey] = next;
    }
  }

  return value;
}

/**
 * Normalize "~" paths in path-ish config fields.
 *
 * Goal: accept `~/...` consistently across config file + env overrides, while
 * keeping the surface area small and predictable.
 */
export function normalizeConfigPaths(cfg: AlisioConfig): AlisioConfig {
  if (!cfg || typeof cfg !== "object") {
    return cfg;
  }
  normalizeAny(undefined, cfg);
  return cfg;
}
