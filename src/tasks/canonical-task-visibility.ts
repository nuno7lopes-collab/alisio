import type { Task, TaskEvent, TaskExecution } from "./task-service.types.js";

type CanonicalTaskVisibilityBundle = {
  task: Task;
  executions: TaskExecution[];
  events: TaskEvent[];
};

const LEGACY_GATEWAY_AGENT_ACTOR = "gateway.agent";

function isLegacyGatewayAgentTask(bundle: CanonicalTaskVisibilityBundle): boolean {
  const { task, executions, events } = bundle;
  if (task.proposalId || task.requesterSessionKey || task.orchestratorSessionKey || task.ownerAgentId) {
    return false;
  }
  if (task.parentTaskId) {
    return false;
  }
  const createdEvent = events.find((event) => event.kind === "created");
  if (createdEvent?.actor !== LEGACY_GATEWAY_AGENT_ACTOR) {
    return false;
  }
  return executions.length > 0 && executions.every((execution) => execution.kind === "cli");
}

export function isVisibleCanonicalTaskBundle(bundle: CanonicalTaskVisibilityBundle): boolean {
  return !isLegacyGatewayAgentTask(bundle);
}

export function filterVisibleCanonicalTaskBundles<T extends CanonicalTaskVisibilityBundle>(
  bundles: T[],
): T[] {
  return bundles.filter((bundle) => isVisibleCanonicalTaskBundle(bundle));
}
