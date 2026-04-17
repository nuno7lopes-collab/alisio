export type InstallRecordBase = {
  source: "npm" | "archive" | "path" | "marketplace";
  spec?: string;
  sourcePath?: string;
  installPath?: string;
  version?: string;
  resolvedName?: string;
  resolvedVersion?: string;
  resolvedSpec?: string;
  integrity?: string;
  shasum?: string;
  resolvedAt?: string;
  installedAt?: string;
  marketplaceRegistryUrl?: string;
  marketplacePackage?: string;
  marketplaceFamily?: "code-plugin" | "bundle-plugin";
  marketplaceChannel?: "official" | "community" | "private";
};
