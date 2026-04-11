export {
  approveDevicePairing,
  clearDeviceBootstrapTokens,
  issueDeviceBootstrapToken,
  PAIRING_SETUP_BOOTSTRAP_PROFILE,
  listDevicePairing,
  revokeDeviceBootstrapToken,
  type DeviceBootstrapProfile,
} from "alisio/plugin-sdk/device-bootstrap";
export { definePluginEntry, type AlisioPluginApi } from "alisio/plugin-sdk/plugin-entry";
export {
  resolveGatewayBindUrl,
  resolveGatewayPort,
  resolveTailnetHostWithRunner,
} from "alisio/plugin-sdk/core";
export {
  resolvePreferredAlisioTmpDir,
  runPluginCommandWithTimeout,
} from "alisio/plugin-sdk/sandbox";
export { renderQrPngBase64 } from "./qr-image.js";
