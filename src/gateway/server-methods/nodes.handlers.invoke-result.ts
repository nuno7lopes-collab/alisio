import { validateNodeInvokeResultParams } from "../protocol/index.js";
import { createNodeResultHandler } from "./nodes.handlers.result-shared.js";

type NodeInvokeResultParams = {
  id: string;
  nodeId: string;
  ok: boolean;
  payload?: unknown;
  payloadJSON?: string | null;
  error?: { code?: string; message?: string } | null;
};

export const handleNodeInvokeResult = createNodeResultHandler<NodeInvokeResultParams>({
  method: "node.invoke.result",
  validator: validateNodeInvokeResultParams,
  resultKind: "invoke result",
  getId: (params) => params.id,
  handleResult: (context, params) =>
    context.nodeRegistry.handleInvokeResult({
      id: params.id,
      nodeId: params.nodeId,
      ok: params.ok,
      payload: params.payload,
      payloadJSON: params.payloadJSON ?? null,
      error: params.error ?? null,
    }),
});
