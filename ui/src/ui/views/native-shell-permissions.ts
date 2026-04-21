import { t } from "../../i18n/index.ts";
import type { NativeShellPermission } from "../types.ts";

export const NATIVE_SHELL_PERMISSION_ORDER = [
  "notifications",
  "appleScript",
  "accessibility",
  "screenRecording",
  "microphone",
  "speechRecognition",
  "camera",
  "location",
] as const satisfies readonly NativeShellPermission[];

export function nativeShellPermissionLabel(permission: NativeShellPermission) {
  switch (permission) {
    case "notifications":
      return t("alisio.settings.host.permissions.notifications");
    case "appleScript":
      return t("alisio.settings.host.permissions.appleScript");
    case "accessibility":
      return t("alisio.settings.host.permissions.accessibility");
    case "screenRecording":
      return t("alisio.settings.host.permissions.screenRecording");
    case "microphone":
      return t("alisio.settings.host.permissions.microphone");
    case "speechRecognition":
      return t("alisio.settings.host.permissions.speechRecognition");
    case "camera":
      return t("alisio.settings.host.permissions.camera");
    case "location":
      return t("alisio.settings.host.permissions.location");
  }
}

export function nativeShellPermissionDescription(permission: NativeShellPermission) {
  switch (permission) {
    case "notifications":
      return t("alisio.settings.host.permissionDescriptions.notifications");
    case "appleScript":
      return t("alisio.settings.host.permissionDescriptions.appleScript");
    case "accessibility":
      return t("alisio.settings.host.permissionDescriptions.accessibility");
    case "screenRecording":
      return t("alisio.settings.host.permissionDescriptions.screenRecording");
    case "microphone":
      return t("alisio.settings.host.permissionDescriptions.microphone");
    case "speechRecognition":
      return t("alisio.settings.host.permissionDescriptions.speechRecognition");
    case "camera":
      return t("alisio.settings.host.permissionDescriptions.camera");
    case "location":
      return t("alisio.settings.host.permissionDescriptions.location");
  }
}
