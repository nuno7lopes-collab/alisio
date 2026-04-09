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
  direction?: "incoming" | "outgoing" | "both";
  matchLimit?: number;
  relationLimit?: number;
};
