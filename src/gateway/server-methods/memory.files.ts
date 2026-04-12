import {
  ErrorCodes,
  errorShape,
  type MemoryFilesGetParams,
  type MemoryFilesListParams,
} from "../protocol/index.js";
import type { RespondFn } from "./types.js";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateMemoryFilesBaseRequest(
  params: Record<string, unknown>,
  respond: RespondFn,
): boolean {
  if (!isNonEmptyString(params.agentId)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "invalid memory.files.list params: agentId"),
    );
    return false;
  }
  if (params.query != null && typeof params.query !== "string") {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "invalid memory.files.list params: query"),
    );
    return false;
  }
  return true;
}

export function validateMemoryFilesListRequest(
  params: Record<string, unknown>,
  respond: RespondFn,
): params is MemoryFilesListParams {
  return validateMemoryFilesBaseRequest(params, respond);
}

export function validateMemoryFilesGetRequest(
  params: Record<string, unknown>,
  respond: RespondFn,
): params is MemoryFilesGetParams {
  if (!validateMemoryFilesBaseRequest(params, respond)) {
    return false;
  }
  if (!isNonEmptyString(params.fileId)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "invalid memory.files.get params: fileId"),
    );
    return false;
  }
  return true;
}
