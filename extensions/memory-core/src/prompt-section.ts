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
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search first; then use memory_get with projectionId or pageId to read only the needed lines. Use memory_graph when the user is asking how memories or decisions relate. If low confidence after checking, say you checked.";
  } else if (hasMemorySearch) {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search and answer from the layered results. Use memory_graph for explicit memory relationships. If low confidence after checking, say you checked.";
  } else if (hasMemoryGet) {
    toolGuidance =
      "Before answering anything about prior work, decisions, dates, people, preferences, or todos that already point to a stable memory locator: run memory_get to pull only the needed lines. If low confidence after reading them, say you checked.";
  } else {
    toolGuidance =
      "When the user is asking how memories or decisions relate: run memory_graph to inspect the structured canonical memory graph. If low confidence after checking it, say you checked.";
  }

  const lines = ["## Memory Recall", toolGuidance];
  if (citationsMode === "off") {
    lines.push(
      "Citations are disabled: do not mention memory locators or line numbers in replies unless the user explicitly asks.",
    );
  } else {
    lines.push("Citations: include Source: <locator#line> when it helps verify memory snippets.");
  }
  lines.push("");
  return lines;
};
