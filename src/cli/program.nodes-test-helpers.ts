export const GENERIC_NODE = {
  nodeId: "mac-node",
  displayName: "Mac Node",
  remoteIp: "192.168.0.88",
  connected: true,
} as const;

export function createNodeListResponse(ts: number = Date.now()) {
  return {
    ts,
    nodes: [GENERIC_NODE],
  };
}
