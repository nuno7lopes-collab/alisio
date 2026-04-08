---
title: "Sharing Protocol"
summary: "Device and model sharing across accounts and organizations"
read_when:
  - Adding or reviewing Alisio sharing flows
  - Verifying approval, revocation, or audit behavior
---

# Sharing Protocol

Alisio uses **devices** as the primary product term. Internal runtime or gateway
code may still refer to nodes, but user-facing flows should say devices.

## Scope

Sharing is scoped to an owner identity:

- user owner: `user:<userId>`
- organization owner: `organization:<normalized-name>`

Supported grant scopes:

- `device.use`: the grantee can see and use the shared runtime target
- `model.use`: the grantee can use the target's published model surface

Approvals are explicit. Shared access is revocable. Shared devices are read-only
for model install and uninstall.

## Protocol

Gateway methods:

- `alisio.sharing.get`
- `alisio.sharing.request`
- `alisio.sharing.approve`
- `alisio.sharing.reject`
- `alisio.sharing.revoke`
- `alisio.sharing.policy.set`

Target state includes:

- owner identity and owner scope
- `deviceAccess` and `modelAccess`: `owner`, `shared`, `requestable`, or `blocked`
- request metadata: `requestId`, `requestStatus`
- grant metadata: `grantId`, `grantScopes`

## Flow

1. The owner publishes runtime targets through the current device and connected
   devices inventory.
2. Another account or organization calls `alisio.sharing.request` for a target
   and requested scopes.
3. The owner approves or rejects the request.
4. Approval creates a grant and changes the target access from `requestable` to
   `shared` for the grantee.
5. Revocation removes the effective shared access for either side.

## Policy

- Sharing requires the Plus plan.
- User-owned devices can receive direct sharing requests.
- Organization-owned devices require `allowExternalUse = true` before external
  accounts can request access.
- Only organization owners can change the external sharing policy.

## Audit

Audit entries are stored for:

- `policy.updated`
- `request.created`
- `request.approved`
- `request.rejected`
- `grant.revoked`

Each entry records the actor, target, related request or grant ids when
available, and a human-readable summary.

## Current persistence

The current implementation persists sharing state in the local Alisio state
store and keeps the target registry synchronized from the runtime inventory.
This is compatible with a future Supabase-backed sync layer without changing
the gateway method contract.
