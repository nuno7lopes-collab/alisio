import fs from "node:fs/promises";
import path from "node:path";

export const CLI_ENTRYPOINT_BASENAMES = ["alisio.mjs", "alisio.mjs"] as const;

export async function resolveCliEntrypointPath(root: string): Promise<string | null> {
  for (const basename of CLI_ENTRYPOINT_BASENAMES) {
    const candidate = path.join(root, basename);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next known entrypoint.
    }
  }
  return null;
}
