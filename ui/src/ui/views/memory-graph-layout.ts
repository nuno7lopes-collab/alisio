import type { MemoryGraphEdge, MemoryGraphNode } from "../types.ts";

export type MemoryGraphPoint = {
  x: number;
  y: number;
};

export type MemoryGraphLayout = Record<string, MemoryGraphPoint>;

function seedFromId(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function buildMemoryGraphLayout(params: {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  focusNodeId?: string | null;
  previousLayout?: MemoryGraphLayout | null;
}): MemoryGraphLayout {
  if (params.nodes.length === 0) {
    return {};
  }

  const positions: MemoryGraphLayout = {};
  const velocity: Record<string, MemoryGraphPoint> = {};
  const previousLayout = params.previousLayout ?? {};
  const focusNodeId = params.focusNodeId ?? null;
  const ringRadius = 180 + params.nodes.length * 6;

  params.nodes.forEach((node, index) => {
    if (previousLayout[node.id]) {
      positions[node.id] = { ...previousLayout[node.id] };
      velocity[node.id] = { x: 0, y: 0 };
      return;
    }
    const seed = seedFromId(node.id);
    const angle = seed * Math.PI * 2 + index * 0.41;
    const radius = ringRadius * (0.45 + seed * 0.55);
    positions[node.id] = {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
    velocity[node.id] = { x: 0, y: 0 };
  });

  if (focusNodeId && positions[focusNodeId]) {
    positions[focusNodeId] = { x: 0, y: 0 };
  }

  const repulsionStrength = 38_000;
  const springLength = focusNodeId ? 150 : 190;
  const springStrength = 0.018;
  const gravityStrength = focusNodeId ? 0.001 : 0.003;

  for (let iteration = 0; iteration < 80; iteration += 1) {
    const forces: Record<string, MemoryGraphPoint> = {};
    params.nodes.forEach((node) => {
      forces[node.id] = { x: 0, y: 0 };
    });

    for (let leftIndex = 0; leftIndex < params.nodes.length; leftIndex += 1) {
      const leftNode = params.nodes[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < params.nodes.length; rightIndex += 1) {
        const rightNode = params.nodes[rightIndex]!;
        const dx = positions[rightNode.id].x - positions[leftNode.id].x;
        const dy = positions[rightNode.id].y - positions[leftNode.id].y;
        const distanceSquared = Math.max(dx * dx + dy * dy, 0.01);
        const distance = Math.sqrt(distanceSquared);
        const force = repulsionStrength / distanceSquared;
        const nx = dx / distance;
        const ny = dy / distance;
        forces[leftNode.id].x -= nx * force;
        forces[leftNode.id].y -= ny * force;
        forces[rightNode.id].x += nx * force;
        forces[rightNode.id].y += ny * force;
      }
    }

    for (const edge of params.edges) {
      const source = positions[edge.fromId];
      const target = positions[edge.toId];
      if (!source || !target) {
        continue;
      }
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const delta = distance - springLength;
      const force = delta * springStrength;
      const nx = dx / distance;
      const ny = dy / distance;
      forces[edge.fromId].x += nx * force;
      forces[edge.fromId].y += ny * force;
      forces[edge.toId].x -= nx * force;
      forces[edge.toId].y -= ny * force;
    }

    for (const node of params.nodes) {
      if (node.id === focusNodeId) {
        positions[node.id] = { x: 0, y: 0 };
        velocity[node.id] = { x: 0, y: 0 };
        continue;
      }
      const position = positions[node.id];
      const force = forces[node.id];
      force.x += -position.x * gravityStrength;
      force.y += -position.y * gravityStrength;
      const nextVelocity = velocity[node.id];
      nextVelocity.x = clamp((nextVelocity.x + force.x) * 0.84, -18, 18);
      nextVelocity.y = clamp((nextVelocity.y + force.y) * 0.84, -18, 18);
      position.x += nextVelocity.x;
      position.y += nextVelocity.y;
    }
  }

  if (!focusNodeId) {
    const centroid = params.nodes.reduce(
      (acc, node) => {
        acc.x += positions[node.id].x;
        acc.y += positions[node.id].y;
        return acc;
      },
      { x: 0, y: 0 },
    );
    centroid.x /= params.nodes.length;
    centroid.y /= params.nodes.length;
    params.nodes.forEach((node) => {
      positions[node.id].x -= centroid.x;
      positions[node.id].y -= centroid.y;
    });
  }

  return positions;
}
