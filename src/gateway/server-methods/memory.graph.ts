import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type MemoryGraphParams,
  validateMemoryGraphParams,
} from "../protocol/index.js";
import type { RespondFn } from "./types.js";

export function validateMemoryGraphRequest(
  params: Record<string, unknown>,
  respond: RespondFn,
): params is MemoryGraphParams {
  const valid = validateMemoryGraphParams(params);
  if (valid) {
    return true;
  }
  respond(
    false,
    undefined,
    errorShape(
      ErrorCodes.INVALID_REQUEST,
      `invalid memory.graph params: ${formatValidationErrors(validateMemoryGraphParams.errors ?? [])}`,
    ),
  );
  return false;
}
