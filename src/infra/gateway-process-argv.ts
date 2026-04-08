function normalizeProcArg(arg: string): string {
  return arg.replaceAll("\\", "/").toLowerCase();
}

const LEGACY_RUNTIME_NAMESPACE = ["open", "claw"].join("");
const CURRENT_CLI_NAME = "alisio";
const CURRENT_GATEWAY_BINARY = "alisio-gateway";

export function parseProcCmdline(raw: string): string[] {
  return raw
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isGatewayArgv(args: string[], opts?: { allowGatewayBinary?: boolean }): boolean {
  const normalized = args.map(normalizeProcArg);
  if (!normalized.includes("gateway")) {
    return false;
  }

  const entryCandidates = [
    "dist/index.js",
    "dist/entry.js",
    "alisio.mjs",
    "scripts/run-node.mjs",
    "src/entry.ts",
    "src/index.ts",
  ];
  if (normalized.some((arg) => entryCandidates.some((entry) => arg.endsWith(entry)))) {
    return true;
  }

  const exe = (normalized[0] ?? "").replace(/\.(bat|cmd|exe)$/i, "");
  return (
    exe.endsWith(`/${CURRENT_CLI_NAME}`) ||
    exe === CURRENT_CLI_NAME ||
    exe.endsWith(`/${LEGACY_RUNTIME_NAMESPACE}`) ||
    exe === LEGACY_RUNTIME_NAMESPACE ||
    (opts?.allowGatewayBinary === true &&
      (exe.endsWith(`/${CURRENT_GATEWAY_BINARY}`) ||
        exe.endsWith(`/${LEGACY_RUNTIME_NAMESPACE}-gateway`)))
  );
}
