---
summary: "Skills in Alisio: what they are, where they live, and how they relate to the local marketplace."
read_when:
  - Explaining skills to users
  - Documenting install locations and precedence
title: "Skills"
---

# Skills

Skills teach Alisio how to do specific kinds of work.

They are part of the product, not a sidecar novelty. Skills are how a computer gains new workflows without bloating the base installation.

## Where Skills Come From

Skills can come from:

- the local marketplace on this computer
- the workspace for the current Alisio setup
- personal or project-level skill folders
- bundled skills that ship with the product

## Local By Default

The important product rule is:

**skills are installed where they run**.

If you install a skill on one Mac, that does not automatically mean it exists on every other computer you use.

## Common Locations

- shared local skills: `~/.alisio/skills`
- workspace skills: `<workspace>/skills`
- personal agent skills: `~/.agents/skills`
- project agent skills: `<workspace>/.agents/skills`

## Precedence

The closest skill to the active workspace wins.

In practice:

1. workspace skills
2. project agent skills
3. personal agent skills
4. local machine-wide skills
5. bundled skills

## Security

Skills are powerful because they can change what the system can do.

Treat third-party skills as code you chose to trust:

- read them before enabling them
- keep risky workflows sandboxed when possible
- do not treat marketplace installs as harmless content

## Install Paths

Use the app or advanced CLI flows to:

- discover skills
- install skills
- update skills
- remove skills that no longer belong on that computer

## Related Pages

- [Local Marketplace](/tools/clawhub)
- [Product Overview](/start/overview)
- [Memory](/concepts/memory)
