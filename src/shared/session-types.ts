import type { PersonWorkspaceSummary } from "../config/types.person.js";
import type {
  PersonalContextAccessContract,
  PersonalContextAccountScope,
  PersonalContextAvailability,
  PersonalContextDeviceBinding,
  PersonalContextDirectReadContract,
  PersonalContextDocument,
  PersonalContextDocumentCounts,
  PersonalContextFileGroup,
  PersonalContextFileKind,
  PersonalContextFileSummary,
  PersonalContextIndexedReadContract,
  PersonalContextInheritance,
  PersonalContextSearchContract,
  PersonalContextSessionKind,
  PersonalContextSessionPolicy,
  PersonalContextSummary,
} from "../memory/personal-context.js";
import type { MemoryNoteRole } from "./memory-file-paths.js";

export type GatewayAgentIdentity = PersonalContextSummary["identity"]["resolved"];
export type GatewayPersonalContextAvailability = PersonalContextAvailability;
export type GatewayPersonalContextInheritance = PersonalContextInheritance;
export type GatewayPersonalContextSessionKind = PersonalContextSessionKind;
export type GatewayPersonalContextFileKind = PersonalContextFileKind;
export type GatewayPersonalContextFileGroup = PersonalContextFileGroup;
export type GatewayPersonalContextMemoryRole = MemoryNoteRole;
export type GatewayPersonalContextFileSummary = PersonalContextFileSummary;
export type GatewayPersonalContextSessionPolicy = PersonalContextSessionPolicy;
export type GatewayAccountScope = PersonalContextAccountScope;
export type GatewayRuntimeResidencyContract = PersonalContextSummary["runtimeContract"];
export type GatewayAccountDeviceBinding = PersonalContextDeviceBinding;
export type GatewayPersonalContextDocument = PersonalContextDocument;
export type GatewayPersonalContextDocumentCounts = PersonalContextDocumentCounts;
export type GatewayPersonalContextReadContract = PersonalContextDirectReadContract;
export type GatewayPersonalContextIndexedReadContract = PersonalContextIndexedReadContract;
export type GatewayPersonalContextSearchContract = PersonalContextSearchContract;
export type GatewayPersonalContextAccessContract = PersonalContextAccessContract;
export type GatewayPersonalContextSummary = PersonalContextSummary;

export type GatewayAgentModel = {
  primary?: string;
  fallbacks?: string[];
};

export type GatewayAgentRow = {
  id: string;
  name?: string;
  identity?: GatewayAgentIdentity;
  personalContext?: GatewayPersonalContextSummary;
  person?: PersonWorkspaceSummary;
  workspace?: string;
  model?: GatewayAgentModel;
};

export type SessionsListResultBase<TDefaults, TRow> = {
  ts: number;
  path: string;
  count: number;
  defaults: TDefaults;
  sessions: TRow[];
};

export type SessionsPatchResultBase<TEntry> = {
  ok: true;
  path: string;
  key: string;
  entry: TEntry;
};
