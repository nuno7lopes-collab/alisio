import { t } from "../../i18n/index.ts";
import type { NativeShellState } from "../types.ts";
import {
  nativeShellPermissionLabel,
  NATIVE_SHELL_PERMISSION_ORDER,
} from "./native-shell-permissions.ts";

export type NativeShellAccessSummary = {
  total: number;
  granted: number;
  missingLabels: string[];
};

export function summarizeNativeShellAccess(
  state: NativeShellState | null | undefined,
): NativeShellAccessSummary | null {
  if (!state) {
    return null;
  }
  const missing = NATIVE_SHELL_PERMISSION_ORDER.filter(
    (permission) => !state.permissions[permission],
  );
  return {
    total: NATIVE_SHELL_PERMISSION_ORDER.length,
    granted: NATIVE_SHELL_PERMISSION_ORDER.length - missing.length,
    missingLabels: missing.map((permission) => nativeShellPermissionLabel(permission)),
  };
}

export function formatMissingPermissions(labels: string[]) {
  const visible = labels.slice(0, 2);
  if (labels.length <= 2) {
    return visible.join(", ");
  }
  return `${visible.join(", ")} +${labels.length - visible.length}`;
}

export function buildNativeShellAccessTitle(summary: NativeShellAccessSummary) {
  const readiness = t("alisio.chat.access.computerGranted", {
    granted: String(summary.granted),
    total: String(summary.total),
  });
  const followup =
    summary.missingLabels.length > 0
      ? t("alisio.chat.access.computerNeedsReview", {
          value: formatMissingPermissions(summary.missingLabels),
        })
      : t("alisio.chat.access.computerAllGranted");
  return `${readiness}. ${followup}`;
}
