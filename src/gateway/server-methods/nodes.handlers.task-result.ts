import { validateNodeTaskResultParams } from "../protocol/index.js";
import { createNodeResultHandler } from "./nodes.handlers.result-shared.js";

type NodeTaskResultParams = {
  taskId: string;
  nodeId: string;
  ok: boolean;
  payload?: unknown;
  payloadJSON?: string | null;
  error?: { code?: string; message?: string } | null;
};

export const handleNodeTaskResult = createNodeResultHandler<NodeTaskResultParams>({
  method: "node.task.result",
  validator: validateNodeTaskResultParams,
  resultKind: "task result",
  getId: (params) => params.taskId,
  handleResult: (context, params) =>
    context.nodeRegistry.handleTaskResult({
      taskId: params.taskId,
      nodeId: params.nodeId,
      ok: params.ok,
      payload: params.payload,
      payloadJSON: params.payloadJSON ?? null,
      error: params.error ?? null,
    }),
});
