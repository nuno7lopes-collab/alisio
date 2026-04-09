export type NoLegacyProviderAdapterPattern = {
  label: string;
  pattern: RegExp;
};

export type NoLegacyProviderAdapterEntry = {
  filePath: string;
  content: string;
};

export type NoLegacyProviderAdapterViolation = {
  filePath: string;
  label: string;
  line: number;
};

export const GUARDED_PROVIDER_ADAPTER_PATHS: string[];
export const BLOCKED_LEGACY_PROVIDER_ADAPTER_PATTERNS: NoLegacyProviderAdapterPattern[];

export function collectNoLegacyProviderAdapterViolationsFromEntries(
  entries: NoLegacyProviderAdapterEntry[],
  patterns?: NoLegacyProviderAdapterPattern[],
): NoLegacyProviderAdapterViolation[];

export function listTrackedGuardedProviderAdapterFiles(
  cwd?: string,
  guardedPaths?: string[],
): string[];

export function collectNoLegacyProviderAdapterViolations(
  filePaths: string[],
  readFile?: (filePath: string, encoding: string) => string,
): NoLegacyProviderAdapterViolation[];

export function main(): Promise<void>;
