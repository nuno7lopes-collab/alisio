import type { MemoryPromptSectionBuilder } from "alisio/plugin-sdk/memory-core-host-runtime-core";

export const buildPromptSection: MemoryPromptSectionBuilder = ({
  availableTools,
  citationsMode,
}) => {
  const hasMemorySearch = availableTools.has("memory_search");
  const hasMemoryGet = availableTools.has("memory_get");
  const hasMemoryGraph = availableTools.has("memory_graph");

  if (!hasMemorySearch && !hasMemoryGet && !hasMemoryGraph) {
    return [];
  }

  let toolGuidance: string;
  if (hasMemorySearch && hasMemoryGet) {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search on the configured memory roots (legacy files, any configured Obsidian memory directory, and optional session transcripts); then use memory_get to pull only the needed lines. Use memory_graph when the user is asking how notes or memories relate, because it reads the structured canonical store under the Markdown vault projection. If low confidence after search, say you checked.";
  } else if (hasMemorySearch) {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search on the configured memory roots and answer from the matching results. Use memory_graph for explicit note-to-note relationships. If low confidence after search, say you checked.";
  } else if (hasMemoryGet) {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos that already point to a specific memory file or note: run memory_get to pull only the needed lines. If low confidence after reading them, say you checked.";
  } else {
    toolGuidance =
      "When the user is asking how memories, notes, or decisions relate: run memory_graph to inspect the structured canonical memory graph under the Markdown vault projection. If low confidence after checking it, say you checked.";
  }

  const lines = ["## Memory Recall", toolGuidance];
  if (citationsMode === "off") {
    lines.push(
      "Citations are disabled: do not mention file paths or line numbers in replies unless the user explicitly asks.",
    );
  } else {
    lines.push(
      "Citations: include Source: <path#line> when it helps the user verify memory snippets.",
    );
  }
  lines.push("");
  return lines;
};
