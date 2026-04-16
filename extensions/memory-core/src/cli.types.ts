export type MemoryCommandOptions = {
  agent?: string;
  json?: boolean;
  deep?: boolean;
  index?: boolean;
  force?: boolean;
  verbose?: boolean;
};

export type MemorySearchCommandOptions = MemoryCommandOptions & {
  query?: string;
  maxResults?: number;
  minScore?: number;
};

export type MemoryGraphCommandOptions = MemoryCommandOptions & {
  query?: string;
  pageId?: string;
  entityId?: string;
  scope?: "overview" | "focus" | "global" | "local";
  direction?: "incoming" | "outgoing" | "both";
  depth?: number;
  matchLimit?: number;
  relationLimit?: number;
  nodeLimit?: number;
  edgeLimit?: number;
  includeAttachments?: boolean;
};
