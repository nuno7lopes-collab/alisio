import fs from "node:fs";
import { dirname } from "node:path";

const TRANSIENT_REMOVE_ERROR_CODES = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
const REMOVE_RETRY_DELAYS_MS = [20, 50, 100];

export function writeTextFileIfChanged(filePath, contents) {
  const next = String(contents);
  try {
    const current = fs.readFileSync(filePath, "utf8");
    if (current === next) {
      return false;
    }
  } catch {
    // Write the file when it does not exist or cannot be read.
  }
  fs.mkdirSync(dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next, "utf8");
  return true;
}

export function removeFileIfExists(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function removePathIfExists(filePath) {
  const maxAttempts = REMOVE_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      fs.rmSync(filePath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
      return true;
    } catch (error) {
      if (!isTransientRemoveError(error) || attempt === maxAttempts - 1) {
        return false;
      }
      sleepSync(REMOVE_RETRY_DELAYS_MS[attempt] ?? 0);
    }
  }
}

function isTransientRemoveError(error) {
  return (
    !!error &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    TRANSIENT_REMOVE_ERROR_CODES.has(error.code)
  );
}

function sleepSync(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
