export const PERSON_AGENT_SCOPES = ["personal_and_work"] as const;
export type PersonAgentScope = (typeof PERSON_AGENT_SCOPES)[number];

export const PERSON_AGENT_AUTONOMY_MODES = ["draft-first"] as const;
export type PersonAgentAutonomyMode = (typeof PERSON_AGENT_AUTONOMY_MODES)[number];

export const PERSON_AGENT_STARTER_PACKS = ["browser-first"] as const;
export type PersonAgentStarterPack = (typeof PERSON_AGENT_STARTER_PACKS)[number];

export const PERSON_MEMORY_SCOPES = [
  "profile_memory",
  "working_memory",
  "relationship_memory",
  "artifact_memory",
] as const;
export type PersonMemoryScope = (typeof PERSON_MEMORY_SCOPES)[number];

export const PERSON_TASK_INTENTS = [
  "triage",
  "research",
  "draft",
  "follow_up",
  "organize",
  "execute_browser",
] as const;
export type PersonTaskIntent = (typeof PERSON_TASK_INTENTS)[number];

export const PERSON_ARTIFACT_TYPES = [
  "draft_message",
  "meeting_brief",
  "follow_up_plan",
  "task_list",
  "decision_note",
] as const;
export type PersonArtifactType = (typeof PERSON_ARTIFACT_TYPES)[number];

export const PERSON_APPROVAL_ACTIONS = [
  "external_send",
  "external_write",
  "destructive_change",
  "third_party_share",
  "automation_mutation",
] as const;
export type PersonApprovalAction = (typeof PERSON_APPROVAL_ACTIONS)[number];

export const PERSON_CAPABILITY_SUBJECTS = [
  "browser",
  "files",
  "memory",
  "search",
  "sessions",
  "artifacts",
] as const;
export type PersonCapabilitySubject = (typeof PERSON_CAPABILITY_SUBJECTS)[number];

export const PERSON_CAPABILITY_ACCESS = ["read", "write", "execute"] as const;
export type PersonCapabilityAccess = (typeof PERSON_CAPABILITY_ACCESS)[number];

export type PersonAgentProfile = {
  name?: string;
  timezone?: string;
  tone?: string;
  writingPreferences?: string[];
  priorities?: string[];
  routines?: string[];
  frequentContacts?: string[];
  frequentContexts?: string[];
};

export type PersonArtifact = {
  type: PersonArtifactType;
  title: string;
  summary?: string;
  updatedAt?: number;
  status?: "draft" | "ready" | "archived";
};

export type ApprovalPolicyProfile = {
  id: "person-draft-first-v1";
  allowWithoutApproval: PersonTaskIntent[];
  requireApprovalFor: PersonApprovalAction[];
};

export type CapabilityLease = {
  capability: PersonCapabilitySubject;
  access: PersonCapabilityAccess;
  source: "starter_pack" | "delegated_specialist";
  scopedTo?: string;
  expiresAt?: number;
};

export type PersonConnectedAccountsSummary = {
  status: "ok" | "expiring" | "expired" | "missing" | "static";
  totalProfiles: number;
  providers: string[];
};

export type PersonWorkspaceStatus = "active" | "suggested";

export type PersonWorkspaceSummary = {
  status: PersonWorkspaceStatus;
  scope: PersonAgentScope;
  autonomyMode: PersonAgentAutonomyMode;
  starterPack: PersonAgentStarterPack;
  profile: PersonAgentProfile;
  specialists: string[];
  memoryScopes: PersonMemoryScope[];
  taskIntents: PersonTaskIntent[];
  artifactTypes: PersonArtifactType[];
  approvalPolicy: ApprovalPolicyProfile;
  capabilityLeases: CapabilityLease[];
  connectedAccounts: PersonConnectedAccountsSummary;
};

export type PersonAgentConfig = {
  enabled?: boolean;
  scope?: PersonAgentScope;
  autonomyMode?: PersonAgentAutonomyMode;
  starterPack?: PersonAgentStarterPack;
  profile?: PersonAgentProfile;
  specialists?: string[];
  memoryScopes?: PersonMemoryScope[];
};
