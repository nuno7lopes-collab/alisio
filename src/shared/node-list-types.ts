export type NodeCapabilitySummary = {
  id: string;
  title?: string;
  description?: string;
  version?: number;
  risk?: "low" | "medium" | "high";
  streaming?: boolean;
  interactive?: boolean;
  supportsCancel?: boolean;
  supportsResume?: boolean;
  requiresCommands?: string[];
  tags?: string[];
};

export type NodeListNode = {
  nodeId: string;
  computerId?: string;
  computerLabel?: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  clientId?: string;
  clientMode?: string;
  remoteIp?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  pathEnv?: string;
  caps?: string[];
  capabilities?: NodeCapabilitySummary[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  paired?: boolean;
  connected?: boolean;
  connectedAtMs?: number;
  approvedAtMs?: number;
};

export type PendingRequest = {
  requestId: string;
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  caps?: string[];
  capabilities?: NodeCapabilitySummary[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  remoteIp?: string;
  isRepair?: boolean;
  ts: number;
};

export type PairedNode = {
  nodeId: string;
  token?: string;
  displayName?: string;
  platform?: string;
  version?: string;
  coreVersion?: string;
  uiVersion?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  caps?: string[];
  capabilities?: NodeCapabilitySummary[];
  commands?: string[];
  remoteIp?: string;
  permissions?: Record<string, boolean>;
  createdAtMs?: number;
  approvedAtMs?: number;
  lastConnectedAtMs?: number;
};

export type PairingList = {
  pending: PendingRequest[];
  paired: PairedNode[];
};
