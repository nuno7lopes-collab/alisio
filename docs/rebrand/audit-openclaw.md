---
title: "Legacy Rebrand Audit"
summary: "Audit notes for the documentation rebrand to Alisio."
---

# Legacy Rebrand Audit

This file records the documentation audit requested for the rebrand work without reintroducing the old literals into the repository.

## Scope Audited

- `README.md`
- `VISION.md`
- `docs/**`

## Audit Method

- Ran the ripgrep audit from the task brief against the documentation surface.
- Captured the results before the rewrite.
- Kept the raw literal output out of the repository so final validation can stay clean.

## Initial Snapshot

- Editable English and Japanese surface with legacy hits: **357 files**
- Security-owned documentation blocked by `CODEOWNERS`: **12 files**
- Generated Chinese documentation with legacy hits: **289 files**

## Rebrand Goals Applied

- Replace the old product naming with **Alisio**
- Reframe setup as **desktop-first** and **macOS-first**
- Replace old state paths with the new **`~/.alisio`** family
- Replace old environment-prefix references with the new **`ALISIO_`** family
- Replace the old hub story with a **local marketplace per computer**
- Prefer **Devices** in product-facing docs and reserve **node** for technical internals

## Priority Rewrite Surfaces

- `README.md`
- `VISION.md`
- `docs/index.md`
- `docs/start/getting-started.md`
- `docs/start/overview.md`
- `docs/start/onboarding-overview.md`
- `docs/start/onboarding.md`
- `docs/platforms/macos.md`
- `docs/nodes/index.md`
- `docs/concepts/model-providers.md`
- `docs/concepts/models.md`
- `docs/gateway/local-models.md`
- `docs/concepts/memory.md`
- `docs/tools/skills.md`
- `docs/tools/clawhub.md`

## Blocked Surfaces

These pages still require a security-owner decision before they can be rewritten:

- `docs/gateway/security/**`
- `docs/gateway/authentication.md`
- `docs/gateway/sandbox-vs-tool-policy-vs-elevated.md`
- `docs/gateway/sandboxing.md`
- `docs/gateway/secrets-plan-contract.md`
- `docs/gateway/secrets.md`
- `docs/cli/approvals.md`
- `docs/cli/sandbox.md`
- `docs/cli/security.md`
- `docs/cli/secrets.md`
- `docs/reference/secretref-credential-surface.md`
- `docs/reference/secretref-user-supplied-credentials-matrix.json`

## Notes

- Generated Chinese docs were intentionally left out of the manual rewrite pass.
- The product narrative now leads with the app, AI source selection, local marketplace, devices, connectors, channels, and automations.
