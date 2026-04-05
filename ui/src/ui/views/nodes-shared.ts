export type NodeTargetOption = {
  id: string;
  label: string;
};

export type ConfigAgentOption = {
  id: string;
  name?: string;
  isDefault: boolean;
  index: number;
  record: Record<string, unknown>;
};

export function isConnectedNode(node: Record<string, unknown>) {
  return Boolean(node.connected) || Boolean(node.online);
}

export function nodeSupportsRequiredCommands(
  node: Record<string, unknown>,
  requiredCommands: readonly string[],
) {
  const required = new Set(requiredCommands);
  const commands = Array.isArray(node.commands) ? node.commands : [];
  return commands.some((cmd) => required.has(String(cmd)));
}

export function nodeSupportsExec(node: Record<string, unknown>) {
  return nodeSupportsRequiredCommands(node, ["system.run"]);
}

export function countConnectedNodes(nodes: Array<Record<string, unknown>>) {
  return nodes.filter((node) => isConnectedNode(node)).length;
}

export function countReadyExecNodes(nodes: Array<Record<string, unknown>>) {
  return nodes.filter((node) => isConnectedNode(node) && nodeSupportsExec(node)).length;
}

export function resolveConfigAgents(config: Record<string, unknown> | null): ConfigAgentOption[] {
  const agentsNode = (config?.agents ?? {}) as Record<string, unknown>;
  const list = Array.isArray(agentsNode.list) ? agentsNode.list : [];
  const agents: ConfigAgentOption[] = [];

  list.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id) {
      return;
    }
    const name = typeof record.name === "string" ? record.name.trim() : undefined;
    const isDefault = record.default === true;
    agents.push({ id, name: name || undefined, isDefault, index, record });
  });

  return agents;
}

export function resolveNodeTargets(
  nodes: Array<Record<string, unknown>>,
  requiredCommands: string[],
  opts?: { requireConnected?: boolean },
): NodeTargetOption[] {
  const list: NodeTargetOption[] = [];

  for (const node of nodes) {
    if (!nodeSupportsRequiredCommands(node, requiredCommands)) {
      continue;
    }
    if (opts?.requireConnected && !isConnectedNode(node)) {
      continue;
    }

    const nodeId = typeof node.nodeId === "string" ? node.nodeId.trim() : "";
    if (!nodeId) {
      continue;
    }

    const displayName =
      typeof node.displayName === "string" && node.displayName.trim()
        ? node.displayName.trim()
        : nodeId;
    list.push({
      id: nodeId,
      label: displayName === nodeId ? nodeId : `${displayName} · ${nodeId}`,
    });
  }

  list.sort((a, b) => a.label.localeCompare(b.label));
  return list;
}
