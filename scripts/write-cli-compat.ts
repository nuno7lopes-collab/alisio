import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LEGACY_DAEMON_CLI_EXPORTS = [
  "addGatewayServiceCommands",
  "registerDaemonCli",
  "runDaemonInstall",
  "runDaemonRestart",
  "runDaemonStart",
  "runDaemonStatus",
  "runDaemonStop",
  "runDaemonUninstall",
] as const;

const SYNC_LEGACY_EXPORTS = new Set<string>(["addGatewayServiceCommands", "registerDaemonCli"]);

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist", "cli");

const missingExportError = (name: string) =>
  `Legacy daemon CLI export "${name}" is unavailable in this build. Please upgrade Alisio.`;

const buildExportLine = (name: (typeof LEGACY_DAEMON_CLI_EXPORTS)[number]) => {
  const message = JSON.stringify(missingExportError(name));
  if (SYNC_LEGACY_EXPORTS.has(name)) {
    return `export const ${name} = () => { throw new Error(${message}); };`;
  }
  return `export const ${name} = async () => { throw new Error(${message}); };`;
};

const contents =
  "// Legacy shim for removed daemon CLI imports.\n" +
  LEGACY_DAEMON_CLI_EXPORTS.map(buildExportLine).join("\n") +
  "\n";

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(path.join(distDir, "daemon-cli.js"), contents);
