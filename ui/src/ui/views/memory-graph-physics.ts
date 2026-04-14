import type { MemoryGraphEdge, MemoryGraphNode } from "../types.ts";
import type { MemoryGraphLayout, MemoryGraphPoint } from "./memory-graph-layout.ts";

export type MemoryGraphSimulationState = {
  positions: MemoryGraphLayout;
  velocities: Record<string, MemoryGraphPoint>;
  restPositions: MemoryGraphLayout;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function seedFromId(id: string) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function buildGroupAnchors(groupIds: string[], focusNodeId: string | null) {
  const anchors: Record<string, MemoryGraphPoint> = {};
  if (groupIds.length === 0) {
    return anchors;
  }
  const baseRadius = focusNodeId ? 238 : 292;
  const step = (Math.PI * 2) / groupIds.length;
  groupIds.forEach((groupId, index) => {
    const seed = seedFromId(groupId);
    const angle = -Math.PI / 2 + index * step + (seed - 0.5) * 0.24;
    const radius = baseRadius * (0.84 + seed * 0.18);
    anchors[groupId] = {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
  return anchors;
}

export function createMemoryGraphSimulation(params: {
  layout: MemoryGraphLayout;
  previousState?: MemoryGraphSimulationState | null;
  nodes: MemoryGraphNode[];
}) {
  const positions: MemoryGraphLayout = {};
  const restPositions: MemoryGraphLayout = {};
  const velocities: Record<string, MemoryGraphPoint> = {};
  const previousState = params.previousState ?? null;
  for (const node of params.nodes) {
    const seededPosition = params.layout[node.id] ?? { x: 0, y: 0 };
    positions[node.id] = {
      x: seededPosition.x,
      y: seededPosition.y,
    };
    restPositions[node.id] = {
      x: seededPosition.x,
      y: seededPosition.y,
    };
    velocities[node.id] = previousState?.velocities[node.id]
      ? { ...previousState.velocities[node.id] }
      : { x: 0, y: 0 };
  }
  return {
    positions,
    velocities,
    restPositions,
  } satisfies MemoryGraphSimulationState;
}

export function stepMemoryGraphSimulation(params: {
  state: MemoryGraphSimulationState;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  focusNodeId: string | null;
  nodeGroups: Record<string, string | null | undefined>;
  draggedNodeId?: string | null;
  dtMs: number;
  localScope: boolean;
}) {
  const dt = clamp(params.dtMs / 16.6667, 0.65, 1.2);
  if (params.nodes.length === 0) {
    return { settled: true };
  }

  const groupIds = Array.from(
    new Set(
      params.nodes
        .map((node) => params.nodeGroups[node.id] ?? null)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    ),
  ).toSorted((left, right) => left.localeCompare(right));
  const groupAnchors = buildGroupAnchors(groupIds, params.focusNodeId);

  const repulsionStrength = params.localScope ? 26_000 : 32_000;
  const springLength = params.localScope ? 148 : 182;
  const springStrength = params.localScope ? 0.038 : 0.028;
  const gravityStrength = params.localScope ? 0.0026 : 0.0018;
  const groupStrength = params.localScope ? 0.0095 : 0.0065;
  const restStrength = params.localScope ? 0.02 : 0.012;
  const focusStrength = params.localScope ? 0.032 : 0.016;
  const damping = params.localScope ? 0.84 : 0.87;
  const maxVelocity = params.localScope ? 34 : 30;

  const forces: Record<string, MemoryGraphPoint> = {};
  for (const node of params.nodes) {
    forces[node.id] = { x: 0, y: 0 };
    if (!params.state.positions[node.id]) {
      params.state.positions[node.id] = { x: 0, y: 0 };
    }
    if (!params.state.velocities[node.id]) {
      params.state.velocities[node.id] = { x: 0, y: 0 };
    }
  }

  for (let leftIndex = 0; leftIndex < params.nodes.length; leftIndex += 1) {
    const leftNode = params.nodes[leftIndex];
    const leftPosition = params.state.positions[leftNode.id];
    for (let rightIndex = leftIndex + 1; rightIndex < params.nodes.length; rightIndex += 1) {
      const rightNode = params.nodes[rightIndex];
      const rightPosition = params.state.positions[rightNode.id];
      const dx = rightPosition.x - leftPosition.x;
      const dy = rightPosition.y - leftPosition.y;
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
    const source = params.state.positions[edge.fromId];
    const target = params.state.positions[edge.toId];
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

  let maxSpeed = 0;
  for (const node of params.nodes) {
    const position = params.state.positions[node.id];
    const velocity = params.state.velocities[node.id];
    if (!position || !velocity) {
      continue;
    }
    if (node.id === params.draggedNodeId) {
      velocity.x *= 0.92;
      velocity.y *= 0.92;
      maxSpeed = Math.max(maxSpeed, Math.abs(velocity.x), Math.abs(velocity.y));
      continue;
    }

    const groupId = params.nodeGroups[node.id] ?? null;
    const anchor = groupId ? (groupAnchors[groupId] ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
    const restPosition = params.state.restPositions[node.id] ?? anchor;
    const force = forces[node.id];
    force.x += (anchor.x - position.x) * groupStrength;
    force.y += (anchor.y - position.y) * groupStrength;
    force.x += (restPosition.x - position.x) * restStrength;
    force.y += (restPosition.y - position.y) * restStrength;
    force.x += -position.x * gravityStrength;
    force.y += -position.y * gravityStrength;
    if (node.id === params.focusNodeId) {
      force.x += -position.x * focusStrength;
      force.y += -position.y * focusStrength;
    }

    velocity.x = clamp((velocity.x + force.x * dt) * damping, -maxVelocity, maxVelocity);
    velocity.y = clamp((velocity.y + force.y * dt) * damping, -maxVelocity, maxVelocity);
    position.x += velocity.x * dt;
    position.y += velocity.y * dt;
    maxSpeed = Math.max(maxSpeed, Math.abs(velocity.x), Math.abs(velocity.y));
  }

  return {
    settled: maxSpeed < 0.08 && !params.draggedNodeId,
  };
}
