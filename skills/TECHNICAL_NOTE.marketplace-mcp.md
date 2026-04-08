# Skills Marketplace and MCP Bridge

This note summarizes the marketplace/MCP surface added for skills.

## Canonical manifest

`SKILL.md` frontmatter remains the canonical source of truth for marketplace metadata.

Required marketplace-facing fields are validated through the existing manifest/frontmatter pipeline:

- identity and version
- declared permissions
- output contract
- runtime compatibility
- optional subscription gates

Marketplace readiness is derived from explicit manifest validation instead of ad hoc UI state.

## Consent and audit trail

Marketplace actions use an explicit consent flow:

- `install`
- `remove`
- `execute`

Consent storage lives under the Alisio state directory:

- consent grants: `skills/marketplace-consent.json`
- audit trail: `skills/marketplace-audit.jsonl`

`allow-always` grants are persisted per workspace, skill, action, and manifest fingerprint.
Audit entries capture request, grant, deny, completion, and failure events.

## Marketplace status model

`skills.status` now returns `marketplaceCatalog` alongside the existing `skills` list.

Each catalog entry can expose:

- install/remove/execute affordances
- declared permissions and outputs
- recent audit entries
- stored consent grants
- MCP virtual skill metadata (`mcp:<name>`)

Local catalog entries are only treated as ready once they are actually installed.
Virtual MCP skills are surfaced as installed/read-only catalog entries.

## Gateway methods

New gateway methods:

- `skills.marketplace.install`
- `skills.marketplace.remove`
- `skills.marketplace.execute`

The handlers resolve marketplace consent before executing the action and append audit records for completed or failed operations.

## MCP bridge

The bridge works in both directions:

- marketplace-ready local skills are exposed as MCP tools/resources/prompts
- configured MCP servers are surfaced as virtual skills named `mcp:<server>`

Bridge actions now use the same consent store and audit trail as the gateway handlers.

Available MCP bridge mutation tools:

- `skills_install`
- `skills_remove`
- per-skill execute tools (`skill_<name>`)

Available MCP bridge read resources:

- `skills://catalog`
- `skills://audit`
- `skills://consent-grants`

Executing a virtual MCP skill returns a safe capability summary for tools, prompts, and resources instead of mutating workspace state, and persisted `allow-always` approvals are reused on later runs.
