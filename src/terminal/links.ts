import { formatTerminalLink } from "./terminal-link.js";

const DOCS_ROOT_URL = "https://docs.alisio.pt";
const LEGACY_DOCS_ROOT_URL = "https://docs.alisio.ai";

function canonicalizeDocsText(value: string): string {
  return value
    .replaceAll(LEGACY_DOCS_ROOT_URL, DOCS_ROOT_URL)
    .replaceAll("docs.alisio.ai", "docs.alisio.pt");
}

export function resolveDocsRoot(): string {
  return DOCS_ROOT_URL;
}

export const DOCS_ROOT = resolveDocsRoot();

export function formatDocsLink(
  path: string,
  label?: string,
  opts?: { fallback?: string; force?: boolean },
): string {
  const trimmed = path.trim();
  const docsRoot = resolveDocsRoot();
  const url = trimmed.startsWith("http")
    ? canonicalizeDocsText(trimmed)
    : `${docsRoot}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
  const resolvedLabel = label ? canonicalizeDocsText(label) : url;
  const fallback = canonicalizeDocsText(opts?.fallback ?? url);
  return formatTerminalLink(resolvedLabel, url, {
    fallback,
    force: opts?.force,
  });
}

export function formatDocsRootLink(label?: string): string {
  const docsRoot = resolveDocsRoot();
  const resolvedLabel = canonicalizeDocsText(label ?? docsRoot);
  return formatTerminalLink(resolvedLabel, docsRoot, {
    fallback: docsRoot,
  });
}
