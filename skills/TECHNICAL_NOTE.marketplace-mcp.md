# Alisio Skills Marketplace MCP Bridge

Local stdio bridge for marketplace-ready skills with explicit manifests.

## Run

```bash
node --import tsx src/agents/skills-mcp-serve.ts --workspace /path/to/workspace
```

Alternative:

```bash
bun src/agents/skills-mcp-serve.ts --workspace /path/to/workspace
```

Optional MCP server injection for local/CI runs:

```bash
node --import tsx src/agents/skills-mcp-serve.ts \
  --workspace /path/to/workspace \
  --mcp-config-json '{"toolbox":{"command":"node","args":["server.mjs"]}}'
```

Optional subscription/feature gating overrides for local/CI runs:

```bash
node --import tsx src/agents/skills-mcp-serve.ts \
  --workspace /path/to/workspace \
  --marketplace-plan plus \
  --skill-features mcp-beta,paid-skills
```

## MCP resources

- `skills://catalog`
- `skills://skill/<name>/manifest`
- `skills://skill/<name>/instructions`

`skills://skill/<name>/manifest` returns the canonical manifest, including `permissions`, `outputs`, and `compat`.

## MCP prompts

- `skill_<name>`

Prompt args:

- `consent`: string flag (`"true"` to approve explicit permissions)
- `task`: optional task context

## MCP tools

- `skills_catalog`
- `skills_install`
- `skill_<name>`

Configured MCP servers are surfaced as virtual skills named `mcp:<server>`, so a local STDIO server `toolbox` becomes `skill_mcp_toolbox`.

Tool args:

- `skills_catalog.onlyReady`: string flag
- `skills_install.name`: skill name
- `skills_install.targetWorkspaceDir`: install destination
- `skills_install.force`: string flag
- `skills_install.consent`: string flag
- `skill_<name>.consent`: string flag

`skills://catalog` and `skills_catalog` now include runtime marketplace access data (`access.allowed`, `access.currentPlan`, `access.plan`, `access.featureFlag`) resolved against the active Alisio account or the optional bridge overrides above.

## Consent and isolation

- Marketplace-ready means explicit manifest + valid permissions contract.
- `skills_install` always requires explicit consent.
- `skill_<name>` requires `consent="true"` when the manifest declares explicit consent.
- Skill execution stages the skill inside an isolated temporary sandbox by default, with the sandbox policy taken from the manifest.
- Virtual `mcp:<server>` skills keep the same explicit-consent policy and expose the resolved MCP tools, prompts, and resources at execution time.
- Subscription-gated skills are blocked at catalog/install/execute time unless the current Alisio plan and optional feature flags satisfy the manifest.
- Marketplace installs are tracked in `.alisio-marketplace/`, while legacy `.clawhub/` and `.clawdhub/` metadata remains readable for back-compat updates.
