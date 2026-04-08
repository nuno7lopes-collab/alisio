# Core Runtime Rebrand Audit

This note records the Phase A audit for the AG2 runtime rebrand slice without reintroducing the full legacy grep payload into the repository.

## Scope

- `src/config/**`
- `src/shared/**`
- `src/infra/**` for paths, config, env-vars, OAuth/browser storage keys, and identifiers
- `alisio.mjs` (wrapper legacy mantido fora do scope deste inventário)
- `package.json` for naming, bins, scripts, and env-var references

## Audit Method

- Ran the requested repository audit against the AG2 ownership surface.
- Kept the raw grep output out of this file so cleanup validation can stay focused on the actual code.

## Current Snapshot

- Matching files in the requested audit surface: **0**
- Matching non-test runtime files in that same surface: **0**
- Case-insensitive matches for legacy brand tokens in that same surface: **0**

## Completed In This Slice

- Default state/config roots now resolve to the Alisio names.
- First-run migration copies legacy state into the new root, verifies the copy, renames the config file, and keeps a timestamped backup of the legacy directory.
- Runtime env reads now prefer `ALISIO_*` and fall back to the legacy prefix where this phase touched startup/config/runtime path code.
- Browser OAuth/local storage code now reads legacy keys, rewrites to the new keys, and stops writing the legacy names.
- Default temp/log naming in the touched runtime paths now uses the Alisio names.
- The new JS entrypoint is `alisio.mjs`; the old wrapper remains as a compatibility trampoline.

## Validation

- Audit commands now return zero on the AG2 ownership surface:
  - the requested case-sensitive legacy-brand audit grep
  - the matching case-insensitive legacy-brand audit grep
- Full repo build now passes again after restoring one-release compatibility aliases for legacy config type imports on the public config/plugin-sdk surfaces.
- Targeted tests passed for the rebrand-critical paths:
  - `src/config/paths.test.ts`
  - `src/config/runtime-schema.test.ts`
  - `src/config/schema.help.quality.test.ts`
  - `src/infra/env.test.ts`
  - `src/infra/exec-allowlist-pattern.test.ts`
  - `src/infra/distribution-profile.test.ts`
  - `src/infra/state-migrations.test.ts`
  - `src/infra/state-migrations.state-dir.test.ts`
  - `src/plugin-sdk/runtime-api-guardrails.test.ts`
  - `src/shared/node-match.test.ts`
  - `src/shared/alisio-openai-oauth.test.ts`

## Compatibility Note

- Public config/plugin-sdk surfaces now expose a one-release compatibility alias for the old config type name so the wider repo keeps building while runtime ownership stays fully rebranded.
- That compatibility layer is type-only and does not reintroduce legacy runtime naming into the AG2 ownership surface.
