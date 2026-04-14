import type {
  MemoryGraphBranch,
  MemoryGraphEdge,
  MemoryGraphNode,
  MemoryGraphState,
} from "../types.ts";

export type MemoryGraphFilterState = {
  searchQuery: string;
  relationTypes: string[];
  tags: string[];
  neighbourhoodOnly: boolean;
  showOrphans: boolean;
  hoveredNodeId: string | null;
  selectedEdgeId: string | null;
};

export type MemoryGraphViewModel = {
  focusNode: MemoryGraphNode | null;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  branches: MemoryGraphBranch[];
  selectedEdge: MemoryGraphEdge | null;
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
};

export function createMemoryGraphFilterState(): MemoryGraphFilterState {
  return {
    searchQuery: "",
    relationTypes: [],
    tags: [],
    neighbourhoodOnly: false,
    showOrphans: true,
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

function groupBranches(
  graph: MemoryGraphState,
  focusNodeId: string | null,
  edges: MemoryGraphEdge[],
): MemoryGraphBranch[] {
  if (!focusNodeId) {
    return [];
  }
  const branchMap = new Map<string, MemoryGraphBranch>();
  for (const edge of edges) {
    if (edge.fromId === focusNodeId) {
      const id = `outgoing:${edge.relationType}`;
      const branch = branchMap.get(id) ?? {
        id,
        direction: "outgoing",
        relationType: edge.relationType,
        nodeIds: [],
      };
      if (!branch.nodeIds.includes(edge.toId)) {
        branch.nodeIds.push(edge.toId);
      }
      branchMap.set(id, branch);
    }
    if (edge.toId === focusNodeId) {
      const id = `incoming:${edge.relationType}`;
      const branch = branchMap.get(id) ?? {
        id,
        direction: "incoming",
        relationType: edge.relationType,
        nodeIds: [],
      };
      if (!branch.nodeIds.includes(edge.fromId)) {
        branch.nodeIds.push(edge.fromId);
      }
      branchMap.set(id, branch);
    }
  }
  return Array.from(branchMap.values())
    .map((branch) => ({
      ...branch,
      nodeIds: [...branch.nodeIds].toSorted((left, right) => {
        const leftTitle = graph.nodes.find((node) => node.id === left)?.title ?? left;
        const rightTitle = graph.nodes.find((node) => node.id === right)?.title ?? right;
        return leftTitle.localeCompare(rightTitle);
      }),
    }))
    .toSorted((left, right) => {
      if (left.direction !== right.direction) {
        return left.direction.localeCompare(right.direction);
      }
      return left.relationType.localeCompare(right.relationType);
    });
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
      branches: [],
      selectedEdge: null,
      highlightedNodeIds: new Set<string>(),
      highlightedEdgeIds: new Set<string>(),
    };
  }

  const focusNodeId = graph.focus?.nodeId ?? null;
  const relationFilter = new Set(filters.relationTypes);
  const tagFilter = new Set(filters.tags);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const baseEdges = graph.edges.filter(
    (edge) => relationFilter.size === 0 || relationFilter.has(edge.relationType),
  );
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
  const edges = baseEdges.filter(
    (edge) => baseNodeIds.has(edge.fromId) && baseNodeIds.has(edge.toId),
  );

  const visibleNodeIds = filters.showOrphans ? new Set(baseNodeIds) : new Set<string>();
  if (!filters.showOrphans) {
    for (const edge of edges) {
      visibleNodeIds.add(edge.fromId);
      visibleNodeIds.add(edge.toId);
    }
  }
  if (focusNodeId) {
    visibleNodeIds.add(focusNodeId);
  }

  if (filters.neighbourhoodOnly && focusNodeId) {
    const neighborhoodNodeIds = new Set<string>([focusNodeId]);
    const neighborhoodEdgeIds = new Set<string>();
    for (const edge of edges) {
      if (edge.fromId === focusNodeId || edge.toId === focusNodeId) {
        neighborhoodNodeIds.add(edge.fromId);
        neighborhoodNodeIds.add(edge.toId);
        neighborhoodEdgeIds.add(edge.id);
      }
    }
    const nodes = graph.nodes.filter((node) => neighborhoodNodeIds.has(node.id));
    const visibleEdges = edges.filter((edge) => neighborhoodEdgeIds.has(edge.id));
    const selectedEdge = visibleEdges.find((edge) => edge.id === filters.selectedEdgeId) ?? null;
    const highlightSeed =
      filters.hoveredNodeId && neighborhoodNodeIds.has(filters.hoveredNodeId)
        ? filters.hoveredNodeId
        : focusNodeId;
    return finalizeViewModel({
      graph,
      nodes,
      edges: visibleEdges,
      focusNodeId,
      selectedEdge,
      highlightSeed,
    });
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
    branches: groupBranches(params.graph, params.focusNodeId, params.edges),
    selectedEdge: params.selectedEdge,
    highlightedNodeIds,
    highlightedEdgeIds,
  };
}
