type AgentCommandsModule = typeof import("../commands/agent.js");

let agentCommandsModulePromise: Promise<AgentCommandsModule> | undefined;

async function loadAgentCommandsModule(): Promise<AgentCommandsModule> {
  agentCommandsModulePromise ??= import("../commands/agent.js");
  return await agentCommandsModulePromise;
}

export async function getAgentCommandFromIngress() {
  const module = await loadAgentCommandsModule();
  return module.agentCommandFromIngress;
}

export async function getAgentCommand() {
  const module = await loadAgentCommandsModule();
  return module.agentCommand;
}
