import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GATEWAY_LAUNCH_AGENT_LABEL } from "../daemon/constants.js";
import { resolveAlisioPackageRootSync } from "./alisio-root.js";

export type AlisioAppRebuildResult = {
  ok: true;
  message: string;
  logPath: string;
};

function shellQuote(text: string): string {
  if (text.length === 0) {
    return "''";
  }
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function normalizePath(target: string): string {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return path.resolve(target);
  }
}

function hasDeveloperRestartScript(candidate: string): boolean {
  return (
    fs.existsSync(path.join(candidate, "package.json")) &&
    fs.existsSync(path.join(candidate, "scripts", "restart-mac.sh"))
  );
}

function resolveDeveloperCheckoutRoot(packageRoot: string): string | null {
  const normalizedPackageRoot = normalizePath(packageRoot);
  if (hasDeveloperRestartScript(normalizedPackageRoot)) {
    return normalizedPackageRoot;
  }

  let cursor = normalizedPackageRoot;
  for (let depth = 0; depth < 8; depth += 1) {
    const expectedPackagedRoot = normalizePath(
      path.join(cursor, "dist", "Alisio.app", "Contents", "Resources", "alisio-package"),
    );
    if (hasDeveloperRestartScript(cursor) && expectedPackagedRoot === normalizedPackageRoot) {
      return cursor;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }

  return null;
}

export function startAlisioDeveloperRebuild(): AlisioAppRebuildResult {
  if (process.platform !== "darwin") {
    throw new Error("This action is only available on macOS.");
  }

  const packageRoot = resolveAlisioPackageRootSync({
    cwd: process.cwd(),
    argv1: process.argv[1],
    moduleUrl: import.meta.url,
  });
  if (!packageRoot) {
    throw new Error("Could not resolve the Alisio package root for this runtime.");
  }

  const checkoutRoot = resolveDeveloperCheckoutRoot(packageRoot);
  if (!checkoutRoot) {
    throw new Error(
      "This action is only available for runtimes launched from dist/Alisio.app or a local checkout.",
    );
  }

  const restartScript = path.join(checkoutRoot, "scripts", "restart-mac.sh");
  if (!fs.existsSync(restartScript)) {
    throw new Error("Missing scripts/restart-mac.sh in the local checkout.");
  }

  const appBundle = path.join(checkoutRoot, "dist", "Alisio.app");
  const logPath = "/tmp/alisio-dev-rebuild.log";
  const backgroundScript = `
set -euo pipefail
launchctl bootout gui/"$UID"/${GATEWAY_LAUNCH_AGENT_LABEL} >/dev/null 2>&1 || true
cd ${shellQuote(checkoutRoot)}
if ! env SKIP_PNPM_INSTALL=1 SKIP_TSC=0 ALISIO_APP_BUNDLE=${shellQuote(appBundle)} ALISIO_RESTART_LOG=${shellQuote(logPath)} bash ${shellQuote(restartScript)} --wait --no-sign; then
  env ALLOW_LOCKFILE_REFRESH=1 SKIP_TSC=0 ALISIO_APP_BUNDLE=${shellQuote(appBundle)} ALISIO_RESTART_LOG=${shellQuote(logPath)} bash ${shellQuote(restartScript)} --wait --no-sign
fi
`.trim();
  const command = `nohup /bin/bash -lc ${shellQuote(backgroundScript)} >/dev/null 2>&1 </dev/null &`;
  const child = spawn("/bin/sh", ["-lc", command], {
    cwd: checkoutRoot,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  return {
    ok: true,
    message: `Rebuild started. The app will close and reopen. Log: ${logPath}`,
    logPath,
  };
}
