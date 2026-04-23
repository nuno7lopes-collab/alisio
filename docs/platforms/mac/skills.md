---
summary: "macOS Capabilities settings UI and gateway-backed status"
read_when:
  - Updating the macOS Capabilities settings UI
  - Changing capabilities gating or install behavior
title: "Capabilities (macOS)"
---

# Capabilities (macOS)

The macOS app surfaces Alisio capabilities through the `Capabilities` tab.
That product surface is capability-first. Under the hood, the gateway still
reports the backing runtime skills, and the app maps them into one native
capabilities surface instead of exposing a separate "skills" product area.

## Data source

- `skills.status` (gateway) returns all skills plus eligibility and missing requirements
  (including allowlist blocks for bundled skills).
- Requirements are derived from `metadata.alisio.requires` in each `SKILL.md`.

## Install actions

- `metadata.alisio.install` defines install options (brew/node/go/uv).
- The app calls `skills.install` to run installers on the gateway host.
- The gateway surfaces only one preferred installer when multiple are provided
  (brew when available, otherwise node manager from `skills.install`, default npm).

## Env/API keys

- The app stores keys in `~/.alisio/alisio.json` under `skills.entries.<skillKey>`.
- `skills.update` patches `enabled`, `apiKey`, and `env`.

## Remote mode

- Install + config updates happen on the gateway host (not the local Mac).
