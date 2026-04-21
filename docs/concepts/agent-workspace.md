---
summary: "Agent workspace: location, layout, and backup strategy"
read_when:
  - You need to explain the agent workspace or its file layout
  - You want to back up or migrate an agent workspace
title: "Agent Workspace"
---

# Agent workspace

The workspace is the agent's home. It is the only working directory used for
file tools and for workspace context. Keep it private and treat it as memory.

This is separate from `~/.alisio/`, which stores config, credentials, and
sessions.

For authenticated desktop product flows, treat the configured workspace path as
the shared local runtime root, not as a single global person root. When account
scoping is active, the live per-account runtime sits under
`accounts/<accountId>/` inside that root. The product root is still
`accountId`, and backend auth, linked-device bindings, session indexes, and
automations do not live in the workspace.

Gateway request handlers resolve that account-scoped path at runtime. They do
not treat the configured workspace root as the person identity itself.

**Important:** the workspace is the **default cwd**, not a hard sandbox. Tools
resolve relative paths against the workspace, but absolute paths can still reach
elsewhere on the host unless sandboxing is enabled. If you need isolation, use
[`agents.defaults.sandbox`](/gateway/sandboxing) (and/or per‑agent sandbox config).
When sandboxing is enabled and `workspaceAccess` is not `"rw"`, tools operate
inside a sandbox workspace under `~/.alisio/sandboxes`, not your host workspace.

## Default location

- Default: `~/.alisio/workspace`
- If `ALISIO_PROFILE` is set and not `"default"`, the default becomes
  `~/.alisio/workspace-<profile>`.
- When account scoping is active, the signed-in local runtime uses
  `accounts/<accountId>/` under that root.
- Override in `~/.alisio/alisio.json`:

```json5
{
  agent: {
    workspace: "~/.alisio/workspace",
  },
}
```

`alisio onboard`, `alisio configure`, or `alisio setup` will create the
workspace and seed the bootstrap files if they are missing.
Sandbox seed copies only accept regular in-workspace files; symlink/hardlink
aliases that resolve outside the source workspace are ignored.

If you already manage the workspace files yourself, you can disable bootstrap
file creation:

```json5
{ agent: { skipBootstrap: true } }
```

## Extra workspace folders

Older installs may have created `~/alisio`. Keeping multiple workspace
directories around can cause confusing auth or state drift, because only one
workspace is active at a time.

**Recommendation:** keep a single active workspace. If you no longer use the
extra folders, archive or move them to Trash (for example `trash ~/alisio`).
If you intentionally keep multiple workspaces, make sure
`agents.defaults.workspace` points to the active one.

`alisio doctor` warns when it detects extra workspace directories.

## Workspace file map (what each file means)

These are the standard files Alisio expects inside the workspace:

- `AGENTS.md`
  - Operating instructions for the agent and how it should use memory.
  - Loaded at the start of every session.
  - Good place for rules, priorities, and "how to behave" details.

- `SOUL.md`
  - Persona, tone, and boundaries.
  - Loaded every session.

- `USER.md`
  - Who the user is and how to address them.
  - Also holds durable human preferences that should survive sessions.
  - Loaded every session.

- `IDENTITY.md`
  - The canonical durable answer to "who is the agent?"
  - Holds the name, vibe, emoji, avatar, and other stable identity cues.

- `TOOLS.md`
  - Notes about your local tools and conventions.
  - Does not control tool availability; it is only guidance.

- `HEARTBEAT.md`
  - Optional tiny checklist for heartbeat runs.
  - Keep it short to avoid token burn.

- `BOOT.md`
  - Optional startup checklist executed on gateway restart when internal hooks are enabled.
  - Keep it short; use the message tool for outbound sends.

- `BOOTSTRAP.md`
  - One-time first-run ritual.
  - Only created for a brand-new workspace.
  - Once setup is complete, it should stop participating in normal operation.

- `memory/backlog/YYYY-MM-DD/<slug>.md`
  - Canonical intake queue for pending memory captures before promotion.
  - Good for session flushes, `/new`/`/reset` captures, and other promotable notes.

- `memory/<topic>.md`
  - Durable operational notes for a specific person, project, routine, or area.
  - Retrieval-driven; not injected automatically on every turn.

- `memory/YYYY-MM-DD.md`
  - Promoted daily rollup (one file per day).
  - Useful for recent temporal recall; not the first intake path and not injected automatically.

- `MEMORY.md` (optional)
  - Curated long-term memory.
  - Injected into private direct sessions, including the canonical `main` session.
  - Not injected into shared group/channel sessions.

See [Memory](/concepts/memory) for the workflow and automatic memory flush.

- `skills/` (optional)
  - Workspace-specific skills.
  - Overrides managed/bundled skills when names collide.

- `canvas/` (optional)
  - Canvas UI files for node displays (for example `canvas/index.html`).

If any bootstrap file is missing, Alisio injects a "missing file" marker into
the session and continues. Large bootstrap files are truncated when injected;
adjust limits with `agents.defaults.bootstrapMaxChars` (default: 20000) and
`agents.defaults.bootstrapTotalMaxChars` (default: 150000).
`alisio setup` can recreate missing defaults without overwriting existing
files.

## Session semantics

- `main` is the default personal home session key for an agent.
- New private direct chats still inherit the same durable identity, persona,
  preferences, and `MEMORY.md` context.
- Operational memory under `memory/` stays retrieval-driven across all session
  types.

## What is NOT in the workspace

These live under `~/.alisio/` and should NOT be committed to the workspace repo:

- `~/.alisio/alisio.json` (config)
- `~/.alisio/credentials/` (OAuth tokens, API keys)
- `~/.alisio/agents/<agentId>/sessions/` (session transcripts + metadata)
- `~/.alisio/skills/` (managed skills)
- backend-owned account auth/session state
- linked-device bindings
- automation records

If you need to migrate sessions or config, copy them separately and keep them
out of version control.

## Git backup (recommended, private)

Treat the workspace as private memory. Put it in a **private** git repo so it is
backed up and recoverable.

Run these steps on the machine where the Gateway runs (that is where the
workspace lives).

### 1) Initialize the repo

If git is installed, brand-new workspaces are initialized automatically. If this
workspace is not already a repo, run:

```bash
cd ~/.alisio/workspace
git init
git add AGENTS.md SOUL.md TOOLS.md IDENTITY.md USER.md HEARTBEAT.md memory/
git commit -m "Add agent workspace"
```

### 2) Add a private remote (beginner-friendly options)

Option A: GitHub web UI

1. Create a new **private** repository on GitHub.
2. Do not initialize with a README (avoids merge conflicts).
3. Copy the HTTPS remote URL.
4. Add the remote and push:

```bash
git branch -M main
git remote add origin <https-url>
git push -u origin main
```

Option B: GitHub CLI (`gh`)

```bash
gh auth login
gh repo create alisio-workspace --private --source . --remote origin --push
```

Option C: GitLab web UI

1. Create a new **private** repository on GitLab.
2. Do not initialize with a README (avoids merge conflicts).
3. Copy the HTTPS remote URL.
4. Add the remote and push:

```bash
git branch -M main
git remote add origin <https-url>
git push -u origin main
```

### 3) Ongoing updates

```bash
git status
git add .
git commit -m "Update memory"
git push
```

## Do not commit secrets

Even in a private repo, avoid storing secrets in the workspace:

- API keys, OAuth tokens, passwords, or private credentials.
- Anything under `~/.alisio/`.
- Raw dumps of chats or sensitive attachments.

If you must store sensitive references, use placeholders and keep the real
secret elsewhere (password manager, environment variables, or `~/.alisio/`).

Suggested `.gitignore` starter:

```gitignore
.DS_Store
.env
**/*.key
**/*.pem
**/secrets*
```

## Moving the workspace to a new machine

1. Clone the repo to the desired path (default `~/.alisio/workspace`).
2. Set `agents.defaults.workspace` to that path in `~/.alisio/alisio.json`.
3. Run `alisio setup --workspace <path>` to seed any missing files.
4. If you need sessions, copy `~/.alisio/agents/<agentId>/sessions/` from the
   old machine separately.

## Advanced notes

- Multi-agent routing can use different workspaces per agent. See
  [Channel routing](/channels/channel-routing) for routing configuration.
- If `agents.defaults.sandbox` is enabled, non-main sessions can use per-session sandbox
  workspaces under `agents.defaults.sandbox.workspaceRoot`.
