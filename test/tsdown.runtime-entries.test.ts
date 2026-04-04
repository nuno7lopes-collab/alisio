import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSrcRuntimeBoundaryEntries } from "../tsdown.config.ts";

function listSrcRuntimeBoundaries(): string[] {
  const srcRoot = path.join(process.cwd(), "src");
  const boundaries: string[] = [];
  const queue = [srcRoot];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    for (const dirent of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!dirent.isFile() || !dirent.name.endsWith(".runtime.ts")) {
        continue;
      }
      const relativePath = path.relative(srcRoot, fullPath).replaceAll(path.sep, "/");
      boundaries.push(relativePath.slice(0, -".ts".length));
    }
  }

  return boundaries.toSorted();
}

describe("tsdown runtime boundary entries", () => {
  it("emits a stable build entry for every src runtime boundary", () => {
    const runtimeEntries = buildSrcRuntimeBoundaryEntries();
    const expectedKeys = listSrcRuntimeBoundaries();

    expect(Object.keys(runtimeEntries).toSorted()).toEqual(expectedKeys);
  });

  it("keeps session store runtime on a stable entry path", () => {
    expect(buildSrcRuntimeBoundaryEntries()["config/sessions/store.runtime"]).toBe(
      "src/config/sessions/store.runtime.ts",
    );
  });
});
