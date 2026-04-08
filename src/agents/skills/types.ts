import type { Skill } from "@mariozechner/pi-coding-agent";

export type SkillInstallSpec = {
  id?: string;
  kind: "apt" | "brew" | "node" | "go" | "uv" | "download";
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: string;
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
};

export type LegacySkillMetadata = {
  always?: boolean;
  skillKey?: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  os?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  install?: SkillInstallSpec[];
};

export type SkillManifestIssue = {
  level: "error" | "warn";
  path?: string;
  message: string;
};

export type SkillSandboxMode = "isolated" | "inherit";

export type SkillSandboxFilesystemMode = "read-only" | "workspace-write";

export type SkillSandboxNetworkMode = "off" | "inherit";

export type SkillPermissionSpec = {
  consent: "implicit" | "explicit";
  sandbox: {
    mode: SkillSandboxMode;
    filesystem: SkillSandboxFilesystemMode;
    network: SkillSandboxNetworkMode;
  };
  exec?: {
    bins?: string[];
  };
  env?: {
    read?: string[];
  };
  files?: {
    read?: string[];
    write?: string[];
  };
  network?: {
    outbound?: boolean;
    hosts?: string[];
  };
  mcp?: {
    consume?: boolean;
    exposeTools?: boolean;
    exposePrompts?: boolean;
    exposeResources?: boolean;
  };
};

export type SkillOutputsSpec = {
  primary: "instructions" | "tool" | "prompt" | "resource";
  formats: string[];
};

export type SkillCompatibilitySpec = {
  os?: string[];
  runtimes?: string[];
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  mcp?: {
    transports?: string[];
    capabilities?: Array<"tools" | "prompts" | "resources">;
  };
};

export type SkillSubscriptionSpec = {
  required: boolean;
  plan?: string;
  featureFlag?: string;
};

export type SkillManifest = {
  schemaVersion: 1;
  name: string;
  version: string;
  description?: string;
  always?: boolean;
  skillKey?: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  install?: SkillInstallSpec[];
  permissions: SkillPermissionSpec;
  outputs: SkillOutputsSpec;
  compat: SkillCompatibilitySpec;
  subscription?: SkillSubscriptionSpec;
};

export type SkillManifestValidation = {
  valid: boolean;
  explicit: boolean;
  source: "manifest" | "legacy-metadata" | "inferred";
  issues: SkillManifestIssue[];
};

export type SkillInvocationPolicy = {
  userInvocable: boolean;
  disableModelInvocation: boolean;
};

export type SkillCommandDispatchSpec = {
  kind: "tool";
  /** Name of the tool to invoke (AnyAgentTool.name). */
  toolName: string;
  /**
   * How to forward user-provided args to the tool.
   * - raw: forward the raw args string (no core parsing).
   */
  argMode?: "raw";
};

export type SkillCommandSpec = {
  name: string;
  skillName: string;
  description: string;
  /** Optional deterministic dispatch behavior for this command. */
  dispatch?: SkillCommandDispatchSpec;
  /** Native prompt template used by Claude-bundle command markdown files. */
  promptTemplate?: string;
  /** Source markdown path for bundle-backed commands. */
  sourceFilePath?: string;
};

export type SkillsInstallPreferences = {
  preferBrew: boolean;
  nodeManager: "npm" | "pnpm" | "yarn" | "bun";
};

export type ParsedSkillFrontmatter = Record<string, string>;

export type SkillEntry = {
  skill: Skill;
  frontmatter: ParsedSkillFrontmatter;
  metadata?: LegacySkillMetadata;
  manifest?: SkillManifest;
  manifestValidation?: SkillManifestValidation;
  invocation?: SkillInvocationPolicy;
};

export type SkillEligibilityContext = {
  remote?: {
    platforms: string[];
    hasBin: (bin: string) => boolean;
    hasAnyBin: (bins: string[]) => boolean;
    note?: string;
  };
};

export type SkillSnapshot = {
  prompt: string;
  skills: Array<{ name: string; primaryEnv?: string; requiredEnv?: string[] }>;
  /** Normalized agent-level filter used to build this snapshot; undefined means unrestricted. */
  skillFilter?: string[];
  resolvedSkills?: Skill[];
  version?: number;
};
