import { describe, expect, it } from "vitest";
import {
  resolveLegacySkillMetadata,
  resolveSkillInvocationPolicy,
  resolveSkillManifestContract,
} from "./frontmatter.js";

describe("resolveSkillInvocationPolicy", () => {
  it("defaults to enabled behaviors", () => {
    const policy = resolveSkillInvocationPolicy({});
    expect(policy.userInvocable).toBe(true);
    expect(policy.disableModelInvocation).toBe(false);
  });

  it("parses frontmatter boolean strings", () => {
    const policy = resolveSkillInvocationPolicy({
      "user-invocable": "no",
      "disable-model-invocation": "yes",
    });
    expect(policy.userInvocable).toBe(false);
    expect(policy.disableModelInvocation).toBe(true);
  });
});

describe("resolveLegacySkillMetadata install validation", () => {
  function resolveInstall(frontmatter: Record<string, string>) {
    return resolveLegacySkillMetadata(frontmatter)?.install;
  }

  it("accepts safe install specs", () => {
    const install = resolveInstall({
      metadata:
        '{"openclaw":{"install":[{"kind":"apt","package":"gh"},{"kind":"brew","formula":"python@3.12"},{"kind":"node","package":"@scope/pkg@1.2.3"},{"kind":"npm","package":"@xdevplatform/xurl"},{"kind":"go","module":"example.com/tool/cmd@v1.2.3"},{"kind":"uv","package":"uvicorn[standard]==0.31.0"},{"kind":"download","url":"https://example.com/tool.tar.gz"}]}}',
    });
    expect(install).toEqual([
      { kind: "apt", package: "gh" },
      { kind: "brew", formula: "python@3.12" },
      { kind: "node", package: "@scope/pkg@1.2.3" },
      { kind: "node", package: "@xdevplatform/xurl" },
      { kind: "go", module: "example.com/tool/cmd@v1.2.3" },
      { kind: "uv", package: "uvicorn[standard]==0.31.0" },
      { kind: "download", url: "https://example.com/tool.tar.gz" },
    ]);
  });

  it("drops unsafe apt package values", () => {
    const install = resolveInstall({
      metadata: '{"openclaw":{"install":[{"kind":"apt","package":"gh curl"}]}}',
    });
    expect(install).toBeUndefined();
  });

  it("drops unsafe brew formula values", () => {
    const install = resolveInstall({
      metadata: '{"openclaw":{"install":[{"kind":"brew","formula":"wget --HEAD"}]}}',
    });
    expect(install).toBeUndefined();
  });

  it("drops unsafe npm package specs for node installers", () => {
    const install = resolveInstall({
      metadata: '{"openclaw":{"install":[{"kind":"node","package":"file:../malicious"}]}}',
    });
    expect(install).toBeUndefined();
  });

  it("drops unsafe go module specs", () => {
    const install = resolveInstall({
      metadata: '{"openclaw":{"install":[{"kind":"go","module":"https://evil.example/mod"}]}}',
    });
    expect(install).toBeUndefined();
  });

  it("drops unsafe download urls", () => {
    const install = resolveInstall({
      metadata: '{"openclaw":{"install":[{"kind":"download","url":"file:///tmp/payload.tgz"}]}}',
    });
    expect(install).toBeUndefined();
  });
});

describe("resolveSkillManifestContract", () => {
  it("parses canonical manifests with explicit permissions", () => {
    const contract = resolveSkillManifestContract({
      skill: {
        name: "mcporter",
        description: "desc",
        baseDir: "/tmp/mcporter",
        filePath: "/tmp/mcporter/SKILL.md",
      } as never,
      frontmatter: {
        name: "mcporter",
        description: "Use mcporter",
        manifest: JSON.stringify({
          name: "mcporter",
          version: "1.2.3",
          permissions: {
            consent: "explicit",
            sandbox: {
              mode: "isolated",
              filesystem: "read-only",
              network: "off",
            },
            exec: { bins: ["mcporter"] },
            mcp: { consume: true },
          },
          outputs: {
            primary: "instructions",
            formats: ["markdown", "json"],
          },
          compat: {
            runtimes: ["alisio"],
            requires: { bins: ["mcporter"] },
            mcp: {
              transports: ["stdio"],
              capabilities: ["tools", "prompts", "resources"],
            },
          },
          subscription: {
            required: false,
            plan: "free",
          },
        }),
      },
    });

    expect(contract.validation).toEqual({
      valid: true,
      explicit: true,
      source: "manifest",
      issues: [],
    });
    expect(contract.manifest.version).toBe("1.2.3");
    expect(contract.manifest.permissions.exec?.bins).toEqual(["mcporter"]);
    expect(contract.metadata.requires?.bins).toEqual(["mcporter"]);
  });

  it("marks canonical manifests invalid when dangerous permissions omit explicit consent", () => {
    const contract = resolveSkillManifestContract({
      skill: {
        name: "network-probe",
        description: "desc",
        baseDir: "/tmp/network-probe",
        filePath: "/tmp/network-probe/SKILL.md",
      } as never,
      frontmatter: {
        name: "network-probe",
        description: "Probe a remote host",
        manifest: JSON.stringify({
          name: "network-probe",
          version: "1.0.0",
          permissions: {
            consent: "implicit",
            sandbox: {
              mode: "isolated",
              filesystem: "read-only",
              network: "off",
            },
            network: { outbound: true },
          },
          outputs: {
            primary: "instructions",
            formats: ["markdown"],
          },
          compat: {
            runtimes: ["alisio"],
          },
        }),
      },
    });

    expect(contract.validation.valid).toBe(false);
    expect(contract.validation.explicit).toBe(true);
    expect(contract.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          path: "manifest.permissions.consent",
        }),
      ]),
    );
  });
});
