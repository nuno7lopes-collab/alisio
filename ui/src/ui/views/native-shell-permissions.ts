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
      return t("alisio.settings.mac.permissions.notifications");
    case "appleScript":
      return t("alisio.settings.mac.permissions.appleScript");
    case "accessibility":
      return t("alisio.settings.mac.permissions.accessibility");
    case "screenRecording":
      return t("alisio.settings.mac.permissions.screenRecording");
    case "microphone":
      return t("alisio.settings.mac.permissions.microphone");
    case "speechRecognition":
      return t("alisio.settings.mac.permissions.speechRecognition");
    case "camera":
      return t("alisio.settings.mac.permissions.camera");
    case "location":
      return t("alisio.settings.mac.permissions.location");
  }
}

export function nativeShellPermissionDescription(permission: NativeShellPermission) {
  switch (permission) {
    case "notifications":
      return t("alisio.settings.mac.permissionDescriptions.notifications");
    case "appleScript":
      return t("alisio.settings.mac.permissionDescriptions.appleScript");
    case "accessibility":
      return t("alisio.settings.mac.permissionDescriptions.accessibility");
    case "screenRecording":
      return t("alisio.settings.mac.permissionDescriptions.screenRecording");
    case "microphone":
      return t("alisio.settings.mac.permissionDescriptions.microphone");
    case "speechRecognition":
      return t("alisio.settings.mac.permissionDescriptions.speechRecognition");
    case "camera":
      return t("alisio.settings.mac.permissionDescriptions.camera");
    case "location":
      return t("alisio.settings.mac.permissionDescriptions.location");
  }
}
