import type { MemoryGraphEdge, MemoryGraphNode, MemoryGraphState } from "../types.ts";

export type MemoryGraphFilterState = {
  searchQuery: string;
  tags: string[];
  hoveredNodeId: string | null;
  selectedEdgeId: string | null;
};

export type MemoryGraphViewModel = {
  focusNode: MemoryGraphNode | null;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  selectedEdge: MemoryGraphEdge | null;
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
};

export function createMemoryGraphFilterState(): MemoryGraphFilterState {
  return {
    searchQuery: "",
    tags: [],
    hoveredNodeId: null,
    selectedEdgeId: null,
  };
}

function matchesSearchQuery(node: MemoryGraphNode, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const haystacks = [node.title, node.slug, node.sourcePath, ...node.aliases, ...node.tags];
  return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function buildMemoryGraphViewModel(
  graph: MemoryGraphState | null,
  filters: MemoryGraphFilterState,
): MemoryGraphViewModel {
  if (!graph) {
    return {
      focusNode: null,
      nodes: [],
      edges: [],
      selectedEdge: null,
      highlightedNodeIds: new Set<string>(),
      highlightedEdgeIds: new Set<string>(),
    };
  }

  const focusNodeId = graph.focus?.nodeId ?? null;
  const tagFilter = new Set(filters.tags);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const baseNodes = graph.nodes.filter((node) => {
    if (node.id === focusNodeId) {
      return true;
    }
    if (tagFilter.size > 0 && !node.tags.some((tag) => tagFilter.has(tag))) {
      return false;
    }
    return matchesSearchQuery(node, filters.searchQuery);
  });
  const baseNodeIds = new Set(baseNodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => baseNodeIds.has(edge.fromId) && baseNodeIds.has(edge.toId),
  );

  const visibleNodeIds = new Set(baseNodeIds);
  if (focusNodeId) {
    visibleNodeIds.add(focusNodeId);
  }

  const nodes = graph.nodes.filter((node) => visibleNodeIds.has(node.id));
  const selectedEdge = edges.find((edge) => edge.id === filters.selectedEdgeId) ?? null;
  const highlightSeed =
    filters.hoveredNodeId && nodeById.has(filters.hoveredNodeId)
      ? filters.hoveredNodeId
      : focusNodeId;
  return finalizeViewModel({
    graph,
    nodes,
    edges,
    focusNodeId,
    selectedEdge,
    highlightSeed,
  });
}

function finalizeViewModel(params: {
  graph: MemoryGraphState;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  focusNodeId: string | null;
  selectedEdge: MemoryGraphEdge | null;
  highlightSeed: string | null;
}): MemoryGraphViewModel {
  const highlightedNodeIds = new Set<string>();
  const highlightedEdgeIds = new Set<string>();
  if (params.highlightSeed) {
    highlightedNodeIds.add(params.highlightSeed);
    for (const edge of params.edges) {
      if (edge.fromId === params.highlightSeed || edge.toId === params.highlightSeed) {
        highlightedEdgeIds.add(edge.id);
        highlightedNodeIds.add(edge.fromId);
        highlightedNodeIds.add(edge.toId);
      }
    }
  }
  if (params.selectedEdge) {
    highlightedEdgeIds.add(params.selectedEdge.id);
    highlightedNodeIds.add(params.selectedEdge.fromId);
    highlightedNodeIds.add(params.selectedEdge.toId);
  }
  return {
    focusNode: params.focusNodeId
      ? (params.nodes.find((node) => node.id === params.focusNodeId) ?? null)
      : null,
    nodes: params.nodes,
    edges: params.edges,
    selectedEdge: params.selectedEdge,
    highlightedNodeIds,
    highlightedEdgeIds,
  };
}
