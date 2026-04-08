import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildWorkspaceSkillStatus,
  resolveWorkspaceMarketplaceCatalogStatus,
} from "./skills-status.js";
import { createCanonicalFixtureSkill } from "./skills.test-helpers.js";
import type { SkillEntry } from "./skills/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("buildWorkspaceSkillStatus", () => {
  it("does not surface install options for OS-scoped skills on unsupported platforms", () => {
    if (process.platform === "win32") {
      // Keep this simple; win32 platform naming is already explicitly handled elsewhere.
      return;
    }

    const mismatchedOs = process.platform === "darwin" ? "linux" : "darwin";

    const entry: SkillEntry = {
      skill: createFixtureSkill({
        name: "os-scoped",
        description: "test",
        filePath: "/tmp/os-scoped",
        baseDir: "/tmp",
        source: "test",
      }),
      frontmatter: {},
      metadata: {
        os: [mismatchedOs],
        requires: { bins: ["fakebin"] },
        install: [
          {
            id: "brew",
            kind: "brew",
            formula: "fake",
            bins: ["fakebin"],
            label: "Install fake (brew)",
          },
        ],
      },
    };

    const report = buildWorkspaceSkillStatus("/tmp/ws", { entries: [entry] });
    expect(report.skills).toHaveLength(1);
    expect(report.skills[0]?.install).toEqual([]);
  });

  it("passes marketplace access overrides into catalog status", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "alisio-marketplace-status-"));
    tempDirs.push(workspaceDir);
    const skillDir = path.join(workspaceDir, "skills", "plus-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      `---
name: plus-skill
description: Paid skill
manifest:
  name: plus-skill
  version: 1.0.0
  description: Paid skill
  permissions:
    consent: explicit
    sandbox:
      mode: isolated
      filesystem: read-only
      network: off
  outputs:
    primary: instructions
    formats:
      - text/markdown
  compat:
    runtimes:
      - alisio
  subscription:
    required: true
    plan: plus
---

# plus-skill

Paid skill
`,
      "utf8",
    );

    const catalog = await resolveWorkspaceMarketplaceCatalogStatus(workspaceDir, {
      access: {
        currentPlan: "free",
      },
    });
    const plusSkill = catalog.find((entry) => entry.name === "plus-skill");
    expect(plusSkill).toBeDefined();
    expect(plusSkill).toMatchObject({
      name: "plus-skill",
      installed: true,
      installable: false,
      access: {
        allowed: false,
        currentPlan: "free",
      },
    });
  });
});

function createFixtureSkill(params: {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: string;
}): SkillEntry["skill"] {
  return createCanonicalFixtureSkill(params);
}
