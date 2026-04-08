import { t } from "../i18n/index.ts";
import type { AlisioBootstrapStep } from "./types.ts";

export function alisioSetupStepLabel(step: AlisioBootstrapStep | null | undefined) {
  switch (step) {
    case "gateway":
      return t("alisio.setup.steps.gateway");
    case "account":
      return t("alisio.setup.steps.account");
    case "runtime":
      return t("alisio.setup.steps.runtime");
    case "organization":
      return t("alisio.setup.steps.organization");
    case "connectors":
      return t("alisio.setup.steps.connectors");
    case "permissions":
      return t("alisio.setup.steps.permissions");
    case "ready":
      return t("alisio.setup.steps.ready");
    default:
      return t("alisio.setup.steps.setup");
  }
}
