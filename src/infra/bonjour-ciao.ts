import { formatBonjourError } from "./bonjour-errors.js";

const CIAO_CANCELLATION_MESSAGE_RE = /^CIAO (?:ANNOUNCEMENT|PROBING) CANCELLED\b/u;
const CIAO_INTERFACE_ASSERTION_MESSAGE_RE =
  /REACHED ILLEGAL STATE!?\s+IPV4 ADDRESS CHANGE FROM DEFINED TO UNDEFINED!?/u;
const CIAO_SELF_PROBE_RACE_MESSAGE_RE = /CAN'T PROBE FOR A SERVICE WHICH IS ANNOUNCED ALREADY\b/u;

export type CiaoUnhandledRejectionClassification =
  | { kind: "cancellation"; formatted: string }
  | { kind: "self-probe-race"; formatted: string }
  | { kind: "interface-assertion"; formatted: string };

export function classifyCiaoUnhandledRejection(
  reason: unknown,
): CiaoUnhandledRejectionClassification | null {
  const formatted = formatBonjourError(reason);
  const message = formatted.toUpperCase();
  if (CIAO_CANCELLATION_MESSAGE_RE.test(message)) {
    return { kind: "cancellation", formatted };
  }
  if (CIAO_SELF_PROBE_RACE_MESSAGE_RE.test(message)) {
    return { kind: "self-probe-race", formatted };
  }
  if (CIAO_INTERFACE_ASSERTION_MESSAGE_RE.test(message)) {
    return { kind: "interface-assertion", formatted };
  }
  return null;
}

export function ignoreCiaoUnhandledRejection(reason: unknown): boolean {
  return classifyCiaoUnhandledRejection(reason) !== null;
}
