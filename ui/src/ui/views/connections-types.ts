import type { ComputersViewState } from "../controllers/computers.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "../controllers/exec-approvals.ts";
import type { AlisioSharingState } from "../types.ts";

type SharingResourcePolicyMap = NonNullable<
  NonNullable<AlisioSharingState["policy"]["resourcePolicies"]>
>;

export type NodesProps = {
  assistantName: string;
  assistantAgentId: string | null;
  computers: ComputersViewState;
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  configFormMode: "form" | "raw";
  execApprovalsLoading: boolean;
  execApprovalsSaving: boolean;
  execApprovalsDirty: boolean;
  execApprovalsSnapshot: ExecApprovalsSnapshot | null;
  execApprovalsForm: ExecApprovalsFile | null;
  execApprovalsSelectedAgent: string | null;
  execApprovalsTarget: "gateway" | "node";
  execApprovalsTargetNodeId: string | null;
  onRefresh: () => void;
  onNodePairingsRefresh: () => void;
  onDeviceApprove: (requestId: string) => void;
  onDeviceReject: (requestId: string) => void;
  onDeviceRemoveComputer: (label: string, deviceIds: readonly string[]) => void;
  onDeviceCleanupComputer: (label: string, staleDeviceIds: readonly string[]) => void;
  onSharingRequest?: (targetId: string, scopes?: readonly string[]) => void;
  onSharingApprove?: (requestId: string, scopes?: readonly string[]) => void;
  onSharingReject?: (requestId: string) => void;
  onSharingRevoke?: (grantId: string) => void;
  onSharingSetPolicy?: (allowExternalUse: boolean) => void;
  onSharingSetResourcePolicy?: (
    resource: keyof SharingResourcePolicyMap,
    mode: SharingResourcePolicyMap[keyof SharingResourcePolicyMap],
  ) => void;
  onRemoteComputerCommandChange?: (computerId: string, value: string) => void;
  onRemoteComputerCwdChange?: (computerId: string, value: string) => void;
  onRemoteComputerRun?: (computerId: string, nodeId: string) => void;
  onNodeApprove: (requestId: string) => void;
  onNodeReject: (requestId: string) => void;
  onDeviceRotate: (deviceId: string, role: string, scopes?: string[], label?: string) => void;
  onDeviceRevoke: (deviceId: string, role: string, label?: string) => void;
  onLoadConfig: () => void;
  onLoadExecApprovals: () => void;
  onBindDefault: (nodeId: string | null) => void;
  onBindAgent: (agentIndex: number, nodeId: string | null) => void;
  onSaveBindings: () => void;
  onExecApprovalsTargetChange: (kind: "gateway" | "node", nodeId: string | null) => void;
  onExecApprovalsSelectAgent: (agentId: string) => void;
  onExecApprovalsPatch: (path: Array<string | number>, value: unknown) => void;
  onExecApprovalsRemove: (path: Array<string | number>) => void;
  onSaveExecApprovals: () => void;
};
