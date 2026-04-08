# Shared Rebrand Plan

## Scope

- `apps/shared/**`
- `extensions/**` manifests named `openclaw.plugin.json` and direct wiring that references that filename
- `packages/**` only `claw*` packages when needed for compatibility context

## Audit Summary

- The shared Swift package currently lives at `apps/shared/OpenClawKit`.
- Public Swift modules exported today are `OpenClawProtocol`, `OpenClawKit`, and `OpenClawChatUI`.
- iOS consumers outside this ownership still import those legacy module names and still reference the legacy shared package path.
- Extension manifests still use `openclaw.plugin.json` broadly across `extensions/*`.
- A small amount of direct extension wiring and tests also hardcode `openclaw.plugin.json`.

## Strategy

- Canonical shared package: add `apps/shared/AlisioKit`.
- Canonical Swift modules: expose `AlisioProtocol`, `AlisioKit`, and `AlisioChatUI`.
- Canonical shared public symbols: expose `Alisio*` aliases from the new package so new consumers stop importing `OpenClaw*`.
- Compatibility shim for one release: keep `apps/shared/OpenClawKit` as the legacy implementation surface while `apps/shared/AlisioKit` re-exports it.
- Canonical extension manifest filename: `alisio.plugin.json`.
- Compatibility shim for one release: keep `openclaw.plugin.json` beside `alisio.plugin.json` as a deprecated copy while loaders and external callers converge.

## Why Wrapper Plus Shim

- A full in-place rename would immediately break iOS/macOS imports that still use `OpenClawKit`, `OpenClawProtocol`, and `OpenClawChatUI`.
- The legacy shared package path is still referenced by app build configuration and support tooling outside this ownership.
- The runtime/plugin loader surface is mid-migration and still contains legacy manifest filename assumptions.

## Exit Criteria For This Phase

- `apps/shared/AlisioKit` exists as the canonical import surface for new work.
- `apps/shared/OpenClawKit` is explicitly treated as a temporary legacy shim in the plan and in package comments.
- `extensions/*/alisio.plugin.json` exists wherever `openclaw.plugin.json` existed in the owned surface.
- Direct references in `extensions/**` prefer `alisio.plugin.json`.
- Remaining `OpenClaw*` hits in this ownership are limited to documented shims.
