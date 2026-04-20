---
summary: "What the Alisio system prompt contains and how it is assembled"
read_when:
  - Editing system prompt text, tools list, or time/heartbeat sections
  - Changing workspace bootstrap or skills injection behavior
title: "System Prompt"
---

# System Prompt

Alisio builds a custom system prompt for every agent run. The prompt is **Alisio-owned** and does not use the pi-coding-agent default prompt.

The prompt is assembled by Alisio and injected into each agent run.

## Structure

The prompt is intentionally compact and uses fixed sections:

- **Tooling**: current tool list + short descriptions.
- **Safety**: short guardrail reminder to avoid power-seeking behavior or bypassing oversight.
- **Skills** (when available): tells the model how to load skill instructions on demand.
- **Alisio Self-Update**: how to run `config.apply` and `update.run`.
- **Workspace**: working directory (`agents.defaults.workspace`).
- **Documentation**: local path to Alisio docs (repo or npm package) and when to read them.
- **Workspace Files (injected)**: indicates bootstrap files are included below.
- **Sandbox** (when enabled): indicates sandboxed runtime, sandbox paths, and whether elevated exec is available.
- **Current Date & Time**: user-local time, timezone, and time format.
- **Reply Tags**: optional reply tag syntax for supported providers.
- **Heartbeats**: heartbeat prompt and ack behavior.
- **Runtime**: host, OS, node, model, repo root (when detected), thinking level (one line).
- **Reasoning**: current visibility level + /reasoning toggle hint.

Safety guardrails in the system prompt are advisory. They guide model behavior but do not enforce policy. Use tool policy, exec approvals, sandboxing, and channel allowlists for hard enforcement; operators can disable these by design.

## Prompt modes

Alisio can render smaller system prompts for sub-agents. The runtime sets a
`promptMode` for each run (not a user-facing config):

- `full` (default): includes all sections above.
- `minimal`: used for sub-agents; omits **Skills**, **Memory Recall**, **Alisio
  Self-Update**, **Model Aliases**, **User Identity**, **Reply Tags**,
  **Messaging**, **Silent Replies**, and **Heartbeats**. Tooling, **Safety**,
  Workspace, Sandbox, Current Date & Time (when known), Runtime, and injected
  context stay available.
- `none`: returns only the base identity line.

When `promptMode=minimal`, extra injected prompts are labeled **Subagent
Context** instead of **Group Chat Context**.

## Workspace bootstrap injection

Bootstrap files are trimmed and appended under **Project Context** so the model sees durable context without needing explicit reads:

- `AGENTS.md`
- `SOUL.md`
- `TOOLS.md`
- `IDENTITY.md`
- `USER.md`
- `HEARTBEAT.md`
- `BOOTSTRAP.md` (only on brand-new workspaces)
- `MEMORY.md` when present

All of these files are **injected into the context window** on every turn, which
means they consume tokens. Keep them concise — especially `MEMORY.md`, which can
grow over time and lead to unexpectedly high context usage and more frequent
compaction.

Because they are already injected, the runtime guidance treats these bootstrap
files as **already read**. The agent should not waste startup `read` calls
reopening `SOUL.md`, `USER.md`, `MEMORY.md`, or the other bootstrap files
unless it needs exact lines for an edit or the user explicitly asks.

The runtime also teaches the durable context contract explicitly:

- `IDENTITY.md` answers who the agent is.
- `SOUL.md` answers how the agent behaves.
- `USER.md` answers who the human is and which preferences are durable.
- `MEMORY.md` is curated durable memory for private direct sessions.
- `memory/` is operational memory retrieved on demand.
- `BOOTSTRAP.md` is setup-only and should disappear from normal flow after setup.

> **Note:** `memory/*.md` daily files are **not** injected automatically. They
> are accessed on demand via the `memory_search` and `memory_get` tools, so they
> do not count against the context window unless the model explicitly reads them.
> When `memory.jobs` is enabled, background promotion can distill those daily
> notes back into `MEMORY.md`, and that long-term projection is then injected as
> normal bootstrap context.

The agent also should not probe daily files by guessing fixed dated paths during
startup. Daily, topic, backlog, and transcript recall should stay query-driven
and only be pulled when relevant.

## Session-type policy

The runtime injects different subsets depending on the session type:

- Private direct sessions, including the canonical `main` session, can inject `MEMORY.md`.
- Shared group and channel sessions omit `MEMORY.md`.
- Sub-agent and cron sessions use a reduced subset (`AGENTS.md`, `TOOLS.md`,
  `SOUL.md`, `IDENTITY.md`, `USER.md`) to keep delegated runs lean.

This means "new chat" creates a fresh conversation, but not a fresh identity.
The durable personal context still comes from the workspace contract above.

Large files are truncated with a marker. The max per-file size is controlled by
`agents.defaults.bootstrapMaxChars` (default: 20000). Total injected bootstrap
content across files is capped by `agents.defaults.bootstrapTotalMaxChars`
(default: 150000). Missing files inject a short missing-file marker. When truncation
occurs, Alisio can inject a warning block in Project Context; control this with
`agents.defaults.bootstrapPromptTruncationWarning` (`off`, `once`, `always`;
default: `once`).

Sub-agent sessions use a smaller bootstrap allowlist: `AGENTS.md`, `TOOLS.md`,
`SOUL.md`, `IDENTITY.md`, and `USER.md`. `MEMORY.md`, `HEARTBEAT.md`, and
`BOOTSTRAP.md` stay out of sub-agent context to keep it small and focused.

Internal hooks can intercept this step via `agent:bootstrap` to mutate or replace
the injected bootstrap files (for example swapping `SOUL.md` for an alternate persona).

To inspect how much each injected file contributes (raw vs injected, truncation, plus tool schema overhead), use `/context list` or `/context detail`. See [Context](/concepts/context).

## Time handling

The system prompt includes a dedicated **Current Date & Time** section when the
user timezone is known. To keep the prompt cache-stable, it now only includes
the **time zone** (no dynamic clock or time format).

Use `session_status` when the agent needs the current time; the status card
includes a timestamp line.

Configure with:

- `agents.defaults.userTimezone`
- `agents.defaults.timeFormat` (`auto` | `12` | `24`)

See [Date & Time](/date-time) for full behavior details.

## Skills

When eligible skills exist, Alisio injects a compact **available skills list**
(`formatSkillsForPrompt`) that includes the **file path** for each skill. The
prompt instructs the model to use `read` to load the SKILL.md at the listed
location (workspace, managed, or bundled). If no skills are eligible, the
Skills section is omitted.

```
<available_skills>
  <skill>
    <name>...</name>
    <description>...</description>
    <location>...</location>
  </skill>
</available_skills>
```

This keeps the base prompt small while still enabling targeted skill usage.

## Documentation

When available, the system prompt includes a **Documentation** section that points to the
local Alisio docs directory (either `docs/` in the repo workspace or the bundled npm
package docs) and also notes the public mirror, source repo, community Discord, and
Local Marketplace ([/tools/marketplace](/tools/marketplace)) for skills discovery. The prompt instructs the model to consult local docs first
for Alisio behavior, commands, configuration, or architecture, and to run
`alisio status` itself when possible (asking the user only when it lacks access).
