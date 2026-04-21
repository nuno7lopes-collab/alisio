import {
  ALISIO_APP_AUTH_REQUIRED_MESSAGE,
  loadAlisioGatewayAccountContext,
  type AlisioGatewayAccountContext,
} from "../alisio-account-context.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { RespondFn } from "./types.js";

export async function requireAuthenticatedAppAccount(
  respond: RespondFn,
): Promise<AlisioGatewayAccountContext | null> {
  try {
    const accountContext = await loadAlisioGatewayAccountContext();
    if (!accountContext.canonical.authenticated || !accountContext.canonical.accountId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, ALISIO_APP_AUTH_REQUIRED_MESSAGE),
      );
      return null;
    }
    return accountContext;
  } catch (err) {
    respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    return null;
  }
}
