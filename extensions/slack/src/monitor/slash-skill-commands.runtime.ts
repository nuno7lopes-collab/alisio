import { listSkillCommandsForAgents as listSkillCommandsForAgentsImpl } from "alisio/plugin-sdk/command-auth";

type ListSkillCommandsForAgents =
  typeof import("alisio/plugin-sdk/command-auth").listSkillCommandsForAgents;

export function listSkillCommandsForAgents(
  ...args: Parameters<ListSkillCommandsForAgents>
): ReturnType<ListSkillCommandsForAgents> {
  return listSkillCommandsForAgentsImpl(...args);
}
