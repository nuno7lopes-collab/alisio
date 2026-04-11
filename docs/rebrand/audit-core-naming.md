---
title: "Core Naming Audit"
summary: "Deterministic audit notes for the core naming rebrand to Alisio."
---

# Core Naming Audit

This file records the deterministic audit requested for the core naming rebrand within Agent A ownership.

## Scope Audited

- `src/compat/**`
- `src/agents/**` files whose path includes `alisio`
- `extensions/**` files whose source imports `alisio/plugin-sdk/*`
- `scripts/lib/alisio-branding.sh`
- `alisio.mjs`

## Audit Method

- Ran `rg -n "Alisio|alisio|alisio/|alisio.plugin.json|PROJECT_NAME|MACOS_APP_SOURCES_DIR"` across the owned paths.
- Counted `extensions/**` files importing the legacy `plugin-sdk` package specifier.
- Verified the macOS source directory candidates on disk before changing the canonical constant.

## Initial Snapshot

- Canonical naming source still pointing at the legacy slug: `src/compat/legacy-names.ts`
- Legacy entrypoint shim already present and silent: `alisio.mjs`
- Legacy `plugin-sdk` specifier hits in `extensions/**`: **1223**
- Code files migrated from `alisio/plugin-sdk/*` to `alisio/plugin-sdk/*`: **1221**
- Affected extension packages with at least one migrated `plugin-sdk` import: **87**
- macOS app sources present at the new path: `apps/macos/Sources/Alisio`

## Files Changed In This Pass

- `src/compat/legacy-names.ts`
- `src/compat/legacy-names.test.ts`
- `alisio.mjs`
- `docs/rebrand/audit-core-naming.md`
- `extensions/**` files importing `alisio/plugin-sdk/*` or dynamically importing the same path

## Highest-Volume Extension Packages

- `extensions/discord/**` — 158 files
- `extensions/telegram/**` — 140 files
- `extensions/slack/**` — 101 files
- `extensions/whatsapp/**` — 83 files
- `extensions/memory-core/**` — 42 files
- `extensions/matrix/**` — 42 files
- `extensions/line/**` — 38 files
- `extensions/signal/**` — 37 files
- `extensions/browser/**` — 36 files
- `extensions/imessage/**` — 35 files

## Rebrand Decisions Applied

- `alisio` is the canonical project slug in compat constants.
- `alisio` is retained only as a legacy alias for manifests, canvas-handler compatibility, and historical macOS source paths.
- `apps/macos/Sources/Alisio` is the canonical macOS source directory, with the old path retained only as a legacy candidate.
- `alisio.mjs` remains a silent shim with an explicit removal note for the next release cycle.
- Owned extension imports now target `alisio/plugin-sdk/*` instead of `alisio/plugin-sdk/*`.

## Follow-Up Observations

- Manifest filename source-of-truth still has legacy literals outside this ownership boundary in `src/plugins/manifest.ts`.
- `scripts/lib/alisio-branding.sh` already models `alisio` as canonical and required no change in this pass.
