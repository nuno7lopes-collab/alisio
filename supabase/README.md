# Alisio Plans, Orgs, and Release Readiness

## Schema invariants

- `public.alisio_profiles` is the source of truth for the signed-in Alisio account profile and plan.
- The only supported persisted plans are `free` and `plus`.
- `auth.users.email` is authoritative. The trigger rewrites `public.alisio_profiles.email` from the authenticated Supabase user on every write.
- Username, display name, avatar label, and plan normalization run inside `public.alisio_apply_profile_invariants()`.
- Non-service-role clients cannot self-upgrade or self-downgrade plans. The trigger keeps normal authenticated writes pinned to the existing stored plan.
- Organization membership, connected app authorizations, and remote model servers are local runtime state today. They are gated from the local account plan at runtime.
- Onboarding fields currently persisted in Supabase are `agent_name`, `terms_accepted_at`, `marketing_opt_in`, and `birthdate`.

## Migrations

- `supabase/migrations/20260404193000_alisio_account_saas.sql`
  - Adds/normalizes SaaS profile constraints, RLS, and the profile invariants trigger.
  - Safe to rerun for the normal path because it uses `if not exists`, `create or replace`, and policy recreation.
  - Important precondition: it intentionally fails if existing usernames would collide after lowercase normalization.
- `supabase/migrations/20260407150500_alisio_account_onboarding_fields.sql`
  - Adds onboarding profile columns and extends the same invariants trigger.
  - Safe to rerun because it uses `if not exists`, `alter ... if needed`, and `create or replace function`.

## Plan matrix

- `free`
  - 1 connected app
  - no organizations or shared workspace mode
  - no custom remote model servers/endpoints
- `plus`
  - multiple connected apps
  - organizations and shared workspace mode
  - custom remote model servers/endpoints

## Runtime gating

- Backend gates live in `src/shared/alisio-billing.ts`, `src/infra/alisio-plan-gating.ts`, and the Alisio store/runtime paths.
- Organization writes are blocked on Free with an upgrade message.
- New connector connections are blocked on Free once the single connected app slot is occupied, including connectors that currently need reconnect.
- Remote model server save/select/runtime publication is blocked on Free with an upgrade message.
- Saved secrets must be encrypted at rest before persistence. If secure local token storage is unavailable, writes fail closed with a remediation message.

## Required environment

- Always validate:
  - `ALISIO_SUPABASE_URL`
  - `ALISIO_SUPABASE_ANON_KEY`
- OAuth providers also need their provider-specific client env vars before connector setup can begin.
- If the macOS login keychain is unavailable, set `ALISIO_CONNECTOR_TOKEN_ENCRYPTION_KEY` to a valid 32-byte key encoding before persisting account, connector, AI, or remote server secrets.

## Release checklist

- Do not bump versions without explicit operator approval.
- `package.json` is the canonical release version source.
- Confirm every mirrored version location that participates in a release is aligned before tagging:
  - `package.json`
  - `apps/android/app/build.gradle.kts`
  - `apps/ios/Sources/Info.plist`
  - `apps/ios/Tests/Info.plist`
  - `apps/macos/Sources/Alisio/Resources/Info.plist`
  - `docs/install/updating.md`
- Apply and verify both account Supabase migrations:
  - `20260404193000_alisio_account_saas.sql`
  - `20260407150500_alisio_account_onboarding_fields.sql`
- Run the minimum release validation bar:
  - `pnpm check`
  - `pnpm build`
  - `pnpm release:check`
- The forbidden-artifact guardrail in `scripts/committer`, pre-commit, CI, and `pnpm release:check`
  is derived from the `.gitignore` `forbidden-commit-dir` markers.
- If the installer or published install path changed, also run:
  - `OPENCLAW_INSTALL_SMOKE_SKIP_NONROOT=1 pnpm test:install:smoke`
  - The env var keeps its legacy name for compatibility with the current install smoke helper.
- NPM publish workflow reference:
  - `.github/workflows/alisio-npm-release.yml`
- Public macOS validation workflow reference:
  - `.github/workflows/macos-release.yml`
- macOS artifacts:
  - `scripts/package-mac-dist.sh` for the real signed/notarized release artifact path
  - `scripts/package-mac-app.sh` as the fallback placeholder/ad-hoc packaging path when Apple Developer signing is unavailable
- Placeholder macOS artifacts are useful for smoke validation only. They are not release-grade.
- See `RELEASE_POLICY.md` for the minimum repo release policy and current CODEOWNERS migration note.
