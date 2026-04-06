import { ConnectErrorDetailCodes } from "./protocol/connect-error-details.js";

const TERMINAL_AUTH_DETAIL_CODES = new Set<string>([
  ConnectErrorDetailCodes.AUTH_TOKEN_MISSING,
  ConnectErrorDetailCodes.AUTH_BOOTSTRAP_TOKEN_INVALID,
  ConnectErrorDetailCodes.AUTH_PASSWORD_MISSING,
  ConnectErrorDetailCodes.AUTH_PASSWORD_MISMATCH,
  ConnectErrorDetailCodes.AUTH_RATE_LIMITED,
  ConnectErrorDetailCodes.PAIRING_REQUIRED,
  ConnectErrorDetailCodes.CONTROL_UI_DEVICE_IDENTITY_REQUIRED,
  ConnectErrorDetailCodes.DEVICE_IDENTITY_REQUIRED,
]);

export function isTerminalGatewayAuthDetailCode(detailCode: string | null | undefined): boolean {
  return Boolean(detailCode && TERMINAL_AUTH_DETAIL_CODES.has(detailCode));
}
