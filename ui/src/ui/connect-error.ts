import { ConnectErrorDetailCodes } from "../../../src/gateway/protocol/connect-error-details.js";
import { resolveGatewayErrorDetailCode } from "./gateway.ts";

type ErrorWithMessageAndDetails = {
  message?: unknown;
  details?: unknown;
};

function normalizeErrorMessage(message: unknown): string {
  if (typeof message === "string") {
    return message;
  }
  if (message instanceof Error && typeof message.message === "string") {
    return message.message;
  }
  return "unknown error";
}

function formatErrorFromMessageAndDetails(error: ErrorWithMessageAndDetails): string {
  const message = normalizeErrorMessage(error.message);
  const detailCode = resolveGatewayErrorDetailCode(error);

  switch (detailCode) {
    case ConnectErrorDetailCodes.AUTH_TOKEN_MISMATCH:
      return "connection token mismatch";
    case ConnectErrorDetailCodes.AUTH_UNAUTHORIZED:
      return "connection auth failed";
    case ConnectErrorDetailCodes.AUTH_RATE_LIMITED:
      return "too many failed authentication attempts";
    case ConnectErrorDetailCodes.PAIRING_REQUIRED:
      return "connection pairing required";
    case ConnectErrorDetailCodes.CONTROL_UI_DEVICE_IDENTITY_REQUIRED:
      return "device identity required for a secure local session (use localhost/HTTPS and retry)";
    case ConnectErrorDetailCodes.CONTROL_UI_ORIGIN_NOT_ALLOWED:
      return "origin not allowed for this workspace";
    case ConnectErrorDetailCodes.AUTH_TOKEN_MISSING:
      return "connection token missing";
    case ConnectErrorDetailCodes.AUTH_DEVICE_TOKEN_MISMATCH:
    case ConnectErrorDetailCodes.DEVICE_AUTH_INVALID:
    case ConnectErrorDetailCodes.DEVICE_AUTH_DEVICE_ID_MISMATCH:
    case ConnectErrorDetailCodes.DEVICE_AUTH_SIGNATURE_EXPIRED:
    case ConnectErrorDetailCodes.DEVICE_AUTH_NONCE_REQUIRED:
    case ConnectErrorDetailCodes.DEVICE_AUTH_NONCE_MISMATCH:
    case ConnectErrorDetailCodes.DEVICE_AUTH_SIGNATURE_INVALID:
    case ConnectErrorDetailCodes.DEVICE_AUTH_PUBLIC_KEY_INVALID:
      return "secure device session expired";
    default:
      break;
  }

  const normalized = message.trim().toLowerCase();
  if (
    normalized === "fetch failed" ||
    normalized === "failed to fetch" ||
    normalized === "connect failed" ||
    normalized.includes("device signature invalid") ||
    normalized.includes("device auth invalid") ||
    normalized.includes("bootstrap token invalid")
  ) {
    return "secure device session expired";
  }
  return message;
}

export function formatConnectError(error: unknown): string {
  if (error && typeof error === "object") {
    return formatErrorFromMessageAndDetails(error as ErrorWithMessageAndDetails);
  }
  return normalizeErrorMessage(error);
}
