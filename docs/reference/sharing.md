---
title: "Sharing Protocol"
summary: "Computer and model sharing across accounts and organizations"
read_when:
  - Adding or reviewing Alisio sharing flows
  - Verifying approval, revocation, or audit behavior
---

# Sharing Protocol

In product-facing docs and UI, Alisio uses **computers** as the primary term.
The sharing API still uses `devices.*` because that is the stable wire
contract, and some runtime internals still say `node`.

## Scope

Sharing is scoped to an owner identity:

- user owner: `user:<userId>`
- organization owner: `organization:<normalized-name>`

Supported grant scopes:

- `read-only`: the grantee can see the shared runtime target
- `model-use`: the grantee can use the target's published model surface
- `exec`: the grantee can run execution on the shared target

Approvals are explicit. Shared access is revocable. Shared computers are read-only
for model install and uninstall.

## Protocol

Canonical Gateway methods:

- `devices.list`
- `devices.share.request`
- `devices.share.approve`
- `devices.share.revoke`
- `devices.policy.set`

Legacy compatibility methods:

- `alisio.sharing.get`
- `alisio.sharing.request`
- `alisio.sharing.approve`
- `alisio.sharing.reject`
- `alisio.sharing.revoke`
- `alisio.sharing.policy.set`

The `alisio.sharing.*` methods remain as a temporary compatibility bridge. New
code should use the `devices.*` contract.

Current sunset target for the remaining sharing compatibility layer: `2026-06-30`.

This sunset covers:

- `alisio.sharing.*`
- scope aliases `device.use` and `model.use`
- `approvalId` as a compatibility alias of `grantId`

These compatibility paths stay only until first-party clients and supported
external clients emit the canonical `devices.*` methods, canonical scopes, and
`grantId` only.

Target state includes:

- owner identity and owner scope
- `deviceAccess`, `modelAccess`, and `execAccess`: `owner`, `shared`,
  `requestable`, or `blocked`
- request metadata: `requestId`, `requestStatus`
- grant metadata: `grantId`, `grantScopes`

`grantId` is the canonical identifier for approved access. `approvalId` is still
returned on some compatibility paths as a deprecated alias of `grantId` and is
part of the same `2026-06-30` sunset.

## Flow

1. The owner publishes runtime targets through the current computer and the
   connected-computers inventory.
2. Another account or organization calls `devices.share.request` for a target
   and requested scopes.
3. The owner approves or rejects the request.
4. Approval creates a grant and changes the target access from `requestable` to
   `shared` for the grantee.
5. Revocation removes the effective shared access for either side.

## Policy

- Sharing requires the Plus plan.
- User-owned computers can receive direct sharing requests.
- Organization-owned computers require `allowExternalUse = true` before external
  accounts can request access.
- Only organization owners can change the external sharing policy.

## Audit

Audit entries are stored for:

- `policy.updated`
- `request.created`
- `request.approved`
- `request.denied`
- `grant.revoked`

Each entry records the actor, target, related request or grant ids when
available, and a human-readable summary.

## Current persistence

When the current account has an active Supabase cloud session, Alisio uses the
Supabase sharing tables as the source of truth for policies, targets, requests,
grants, and audit entries. The local state file remains a compatibility fallback
when cloud-backed sharing is unavailable.

The runtime inventory still refreshes the target registry from the current
computer and connected-computers list. Memory, vault, files, and other sensitive
context are not auto-shared through this contract.
