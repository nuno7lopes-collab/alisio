import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveAccountScopedAgentWorkspaceDir,
  resolveDefaultAgentWorkspaceDir,
} from "./workspace.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DEFAULT_AGENT_WORKSPACE_DIR", () => {
  it("uses ALISIO_HOME when resolving the default workspace dir", () => {
    const home = path.join(path.sep, "srv", "alisio-home");
    vi.stubEnv("ALISIO_HOME", home);
    vi.stubEnv("HOME", path.join(path.sep, "home", "other"));

    expect(resolveDefaultAgentWorkspaceDir()).toBe(
      path.join(path.resolve(home), ".alisio", "workspace"),
    );
  });

  it("resolves account-scoped workspace dirs under the shared workspace root", () => {
    expect(
      resolveAccountScopedAgentWorkspaceDir("/srv/alisio/workspace", " Person@example.com "),
    ).toBe(
      path.join(
        path.resolve(path.join(path.sep, "srv", "alisio", "workspace")),
        "accounts",
        "person-example-com",
      ),
    );
  });

  it("does not double-scope a workspace that is already rooted under the account", () => {
    expect(
      resolveAccountScopedAgentWorkspaceDir(
        "/srv/alisio/workspace/accounts/person-example-com",
        " Person@example.com ",
      ),
    ).toBe(path.join(path.sep, "srv", "alisio", "workspace", "accounts", "person-example-com"));
  });

  it("keeps the legacy workspace root when no account id exists yet", () => {
    expect(resolveAccountScopedAgentWorkspaceDir("/srv/alisio/workspace")).toBe(
      path.join(path.sep, "srv", "alisio", "workspace"),
    );
  });
});
