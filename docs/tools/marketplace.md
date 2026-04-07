---
summary: "The Alisio local marketplace: install skills, apps, and integrations on the computer where they run."
read_when:
  - Explaining the marketplace model in Alisio
  - Documenting how local installs differ from global registries
title: "Local Marketplace"
sidebarTitle: "Local Marketplace"
---

# Local Marketplace

Alisio uses a **local marketplace** model.

That means the skills, apps, and integrations available to one computer belong to that computer unless you explicitly install them somewhere else too.

## Why Local Matters

This matches how Alisio actually works:

- permissions are local
- devices are local
- connectors may be local
- AI runtimes may be local
- skills should be installed where they execute

## What You Install Here

- skills
- app integrations
- connector-specific add-ons
- optional runtime capabilities

## Product Rule

The marketplace is **per computer**, not an invisible global catalog that assumes every machine is identical.

That makes the system easier to reason about:

- one Mac can have a local automation stack
- another machine can stay minimal
- a remote server can keep only the pieces it actually needs

## Typical Flow

1. Open the marketplace from the app
2. Review what the skill or integration does
3. Install it on the current computer
4. Verify the required permissions, runtime, or AI source
5. Use it in chat, automations, or connector workflows

## Security Stance

Marketplace installs should be treated like trusted capability installs, not like harmless themes or snippets.

Before installing, ask:

- what can this run
- what does it connect to
- what permissions does it assume
- which computer should own it

## Related Pages

- [Skills](/tools/skills)
- [Product Overview](/start/overview)
- [Getting Started](/start/getting-started)
