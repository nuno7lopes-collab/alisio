---
summary: "Deep dive: session store + transcripts, lifecycle, and (auto)compaction internals"
read_when:
  - You need to debug session ids, transcript JSONL, or sessions.json fields
  - You are changing auto-compaction behavior or adding “pre-compaction” housekeeping
  - You want to implement memory flushes or silent system turns
title: "Session Management Deep Dive"
---

# Session Management & Compaction (Deep Dive)

This document explains how Alisio manages sessions end-to-end:

- **Session routing** (how inbound messages map to a `sessionKey`)
- **Session store** (`sessions.json`) and what it tracks
- **Transcript persistence** (`*.jsonl`) and its structure
- **Transcript hygiene** (provider-specific fixups before runs)
- **Context limits** (context window vs tracked tokens)
- **Compaction** (manual + auto-compaction) and where to hook pre-compaction work
- **Silent housekeeping** (e.g. memory writes that shouldn’t produce user-visible output)

If you want a higher-level overview first, start with:

- [/concepts/session](/concepts/session)
- [/concepts/compaction](/concepts/compaction)
- [/concepts/memory](/concepts/memory)
- [/concepts/memory-search](/concepts/memory-search)
- [/concepts/session-pruning](/concepts/session-pruning)
- [/reference/transcript-hygiene](/reference/transcript-hygiene)

---

## Source of truth: the Gateway

Alisio is designed around a single **Gateway process** that owns session state.

- UIs (macOS app, legacy browser admin UI, TUI) should query the Gateway for session lists and token counts.
- In remote mode, session files are on the remote host; “checking your local Mac files” won’t reflect what the Gateway is using.

---

## Canonical chat model

Use these terms distinctly when reasoning about chat/session behavior:

- **Agent**: the long-lived agent identity, persona, and memory owner.
- **Surface**: where the human is interacting. Examples: dashboard chat, desktop window, web tab, WhatsApp chat, Telegram topic, Discord thread.
- **Conversation**: the logical short-term context bucket for one chat. Multiple conversations can belong to the same agent at the same time.
- **Transcript**: the concrete active history file for one conversation.
- **Runtime**: an optional external execution/runtime binding such as ACP or Codex.
- **Client-local view state**: per-device or per-window UI state such as selected chat, draft text, scroll position, and active tab.

Important invariants:

- A conversation has one active transcript at a time.
- Reset keeps the same conversation and rotates to a new transcript.
- New chat creates a new conversation and its first transcript.
- Runtime reset is separate from conversation reset.
- Client-local view state is not shared conversation state.

---

## Two persistence layers

Alisio persists sessions in two layers:

1. **Session store (`sessions.json`)**
   - Key/value map: `sessionKey -> SessionEntry`
   - Small, mutable, safe to edit (or delete entries)
   - Tracks session metadata (current session id, last activity, toggles, token counters, etc.)

2. **Transcript (`<sessionId>.jsonl`)**
   - Append-only transcript with tree structure (entries have `id` + `parentId`)
   - Stores the actual conversation + tool calls + compaction summaries
   - Used to rebuild the model context for future turns

---

## On-disk locations

Per agent, on the Gateway host:

- Store: `~/.alisio/agents/<agentId>/sessions/sessions.json`
- Transcripts: `~/.alisio/agents/<agentId>/sessions/<sessionId>.jsonl`
  - Telegram topic sessions: `.../<sessionId>-topic-<threadId>.jsonl`

Alisio resolves these via `src/config/sessions.ts`.

---

## Store maintenance and disk controls

Session persistence has automatic maintenance controls (`session.maintenance`) for `sessions.json` and transcript artifacts:

- `mode`: `warn` (default) or `enforce`
- `pruneAfter`: stale-entry age cutoff (default `30d`)
- `maxEntries`: cap entries in `sessions.json` (default `500`)
- `rotateBytes`: rotate `sessions.json` when oversized (default `10mb`)
- `resetArchiveRetention`: retention for `*.reset.<timestamp>` transcript archives (default: same as `pruneAfter`; `false` disables cleanup)
- `maxDiskBytes`: optional sessions-directory budget
- `highWaterBytes`: optional target after cleanup (default `80%` of `maxDiskBytes`)

Enforcement order for disk budget cleanup (`mode: "enforce"`):

1. Remove oldest archived or orphan transcript artifacts first.
2. If still above the target, evict oldest session entries and their transcript files.
3. Keep going until usage is at or below `highWaterBytes`.

In `mode: "warn"`, Alisio reports potential evictions but does not mutate the store/files.

Run maintenance on demand:

```bash
alisio sessions cleanup --dry-run
alisio sessions cleanup --enforce
```

---

## Cron sessions and run logs

Isolated cron runs also create session entries/transcripts, and they have dedicated retention controls:

- `cron.sessionRetention` (default `24h`) prunes old isolated cron run sessions from the session store (`false` disables).
- `cron.runLog.maxBytes` + `cron.runLog.keepLines` prune `~/.alisio/cron/runs/<jobId>.jsonl` files (defaults: `2_000_000` bytes and `2000` lines).

---

## Session keys (`sessionKey`)

A `sessionKey` identifies the logical **conversation** bucket (routing + isolation).

Common patterns:

- Main/direct chat (per agent): `agent:<agentId>:<mainKey>` (default `main`)
- Group: `agent:<agentId>:<channel>:group:<id>`
- Room/channel (Discord/Slack): `agent:<agentId>:<channel>:channel:<id>` or `...:room:<id>`
- Cron: `cron:<job.id>`
- Webhook: `hook:<uuid>` (unless overridden)

The canonical rules are documented at [/concepts/session](/concepts/session).

In the current implementation, the conversation identity maps to the session key, while newer Gateway read models also expose explicit conversation metadata such as `conversationId`, `conversationKey`, `category`, `surfaceRef`, `runtimeRef`, and `relationship`.

---

## Session ids (`sessionId`)

Each `sessionKey` points at a current `sessionId` (the active **transcript** file for that conversation).

Rules of thumb:

- **Reset** (`/new`, `/reset`) creates a new `sessionId` for that `sessionKey`.
- **Daily reset** (default 4:00 AM local time on the gateway host) creates a new `sessionId` on the next message after the reset boundary.
- **Idle expiry** (`session.reset.idleMinutes` or legacy `session.idleMinutes`) creates a new `sessionId` when a message arrives after the idle window. When daily + idle are both configured, whichever expires first wins.
- **Thread parent fork guard** (`session.parentForkMaxTokens`, default `100000`) skips parent transcript forking when the parent session is already too large; the new thread starts fresh. Set `0` to disable.

Implementation detail: the decision happens in `initSessionState()` in `src/auto-reply/reply/session.ts`.

In the current model:

- `sessionKey` = conversation identity
- `sessionId` = active transcript identity

That mapping is preserved for compatibility, but new Gateway APIs expose the conversation/transcript split explicitly.

---

## Operation semantics

These operations are intentionally different:

### Reset (`/new`, `/reset`, `sessions.reset`)

Reset means:

- same conversation
- new transcript
- preserve conversation-level metadata

This is the existing contract and remains stable for hooks and automations.

### New chat (`sessions.create`, dashboard "New chat")

New chat means:

- new conversation
- new transcript
- current dashboard or desktop surface binds to the new conversation

This is how Alisio now models "real" additional chats for the same agent.

### Runtime reset (`sessions.runtime.reset`)

Runtime reset means:

- reset the bound external runtime only
- keep the same conversation
- keep the same transcript unless transcript rotation is explicitly requested

This separates ACP or external runtime lifecycle from chat lifecycle.

---

## Surface policy

Alisio supports multiple simultaneous conversations for the same agent, but surface behavior is intentionally different by channel type.

### Dashboard, web, and desktop surfaces

- Can create real new chats
- Can switch between existing conversations
- Can show the same conversation on multiple devices or windows at once
- Keep selected chat, draft, and scroll state locally per surface

### External messaging surfaces

Examples: WhatsApp, Telegram, Signal, iMessage, Discord channels.

- Default to one stable conversation binding per surface
- `/new` resets that conversation
- Do not implicitly create hidden extra chats behind the same surface

Threaded surfaces are modeled explicitly:

- Telegram topics are typed topic surfaces
- Discord or Slack threads are typed thread surfaces

Core semantics should not depend on inferring behavior from `:thread:` or `:topic:` suffix parsing alone.

---

## Lifecycle events

Gateway session change payloads now expose explicit lifecycle semantics alongside compatibility fields:

- `conversation.created`
- `transcript.rotated`
- `runtime.reset`
- `surface.rebound`

These lifecycle labels make it possible to plug future memory promotion or summarization logic into clean event boundaries without overloading `/new`.

---

## Session store schema (`sessions.json`)

The store’s value type is `SessionEntry` in `src/config/sessions.ts`.

Key fields (not exhaustive):

- `sessionId`: current transcript id (filename is derived from this unless `sessionFile` is set)
- `updatedAt`: last activity timestamp
- `sessionFile`: optional explicit transcript path override
- `chatType`: `direct | group | room` (helps UIs and send policy)
- `provider`, `subject`, `room`, `space`, `displayName`: metadata for group/channel labeling
- Toggles:
  - `thinkingLevel`, `verboseLevel`, `reasoningLevel`, `elevatedLevel`
  - `sendPolicy` (per-session override)
- Model selection:
  - `providerOverride`, `modelOverride`, `authProfileOverride`
- Token counters (best-effort / provider-dependent):
  - `inputTokens`, `outputTokens`, `totalTokens`, `contextTokens`
- `compactionCount`: how often auto-compaction completed for this session key
- `memoryFlushAt`: timestamp for the last pre-compaction memory flush
- `memoryFlushCompactionCount`: compaction count when the last flush ran

Newer session rows and Gateway payloads can also carry additive typed metadata such as:

- `category`
- `surfaceRef`
- `relationship`
- `conversationId` / `conversationKey`
- `transcriptId`
- `runtimeRef`

The store is safe to edit, but the Gateway is the authority: it may rewrite or rehydrate entries as sessions run.

---

## Transcript structure (`*.jsonl`)

Transcripts are managed by `@mariozechner/pi-coding-agent`’s `SessionManager`.

The file is JSONL:

- First line: session header (`type: "session"`, includes `id`, `cwd`, `timestamp`, optional `parentSession`)
- Then: session entries with `id` + `parentId` (tree)

Notable entry types:

- `message`: user/assistant/toolResult messages
- `custom_message`: extension-injected messages that _do_ enter model context (can be hidden from UI)
- `custom`: extension state that does _not_ enter model context
- `compaction`: persisted compaction summary with `firstKeptEntryId` and `tokensBefore`
- `branch_summary`: persisted summary when navigating a tree branch

Alisio intentionally does **not** “fix up” transcripts; the Gateway uses `SessionManager` to read/write them.

---

## Context windows vs tracked tokens

Two different concepts matter:

1. **Model context window**: hard cap per model (tokens visible to the model)
2. **Session store counters**: rolling stats written into `sessions.json` (used for /status and dashboards)

If you’re tuning limits:

- The context window comes from the model catalog (and can be overridden via config).
- `contextTokens` in the store is a runtime estimate/reporting value; don’t treat it as a strict guarantee.

For more, see [/token-use](/reference/token-use).

---

## Compaction: what it is

Compaction summarizes older conversation into a persisted `compaction` entry in the transcript and keeps recent messages intact.

After compaction, future turns see:

- The compaction summary
- Messages after `firstKeptEntryId`

Compaction is **persistent** (unlike session pruning). See [/concepts/session-pruning](/concepts/session-pruning).

---

## When auto-compaction happens (Pi runtime)

In the embedded Pi agent, auto-compaction triggers in two cases:

1. **Overflow recovery**: the model returns a context overflow error → compact → retry.
2. **Threshold maintenance**: after a successful turn, when:

`contextTokens > contextWindow - reserveTokens`

Where:

- `contextWindow` is the model’s context window
- `reserveTokens` is headroom reserved for prompts + the next model output

These are Pi runtime semantics (Alisio consumes the events, but Pi decides when to compact).

---

## Compaction settings (`reserveTokens`, `keepRecentTokens`)

Pi’s compaction settings live in Pi settings:

```json5
{
  compaction: {
    enabled: true,
    reserveTokens: 16384,
    keepRecentTokens: 20000,
  },
}
```

Alisio also enforces a safety floor for embedded runs:

- If `compaction.reserveTokens < reserveTokensFloor`, Alisio bumps it.
- Default floor is `20000` tokens.
- Set `agents.defaults.compaction.reserveTokensFloor: 0` to disable the floor.
- If it’s already higher, Alisio leaves it alone.

Why: leave enough headroom for multi-turn “housekeeping” (like memory writes) before compaction becomes unavoidable.

Implementation: `ensurePiCompactionReserveTokens()` in `src/agents/pi-settings.ts`
(called from `src/agents/pi-embedded-runner.ts`).

---

## Migration notes

This cleanup is intentionally additive and compatibility-first.

What stayed compatible:

- `/new` and `/reset` still mean "reset the current conversation"
- `sessionKey` still identifies the logical conversation
- `sessionId` still identifies the active transcript
- existing hooks that listen to `command:new` or `command:reset` keep their meaning

What is now explicit:

- real new chat creation is distinct from reset
- runtime reset is distinct from chat reset
- surface typing and lineage metadata are exposed as typed fields instead of only legacy `kind` or key-shape heuristics
- dashboard and desktop selections are treated as client-local view state rather than a global current-chat pointer

Deprecated mental model:

- do not treat "session" as a single overloaded concept
- prefer reasoning in terms of agent, surface, conversation, transcript, runtime, and client-local view state

---

## User-visible surfaces

You can observe compaction and session state via:

- `/status` (in any chat session)
- `alisio status` (CLI)
- `alisio sessions` / `sessions --json`
- Verbose mode: `🧹 Auto-compaction complete` + compaction count

---

## Silent housekeeping (`NO_REPLY`)

Alisio supports “silent” turns for background tasks where the user should not see intermediate output.

Convention:

- The assistant starts its output with `NO_REPLY` to indicate “do not deliver a reply to the user”.
- Alisio strips/suppresses this in the delivery layer.

As of `2026.1.10`, Alisio also suppresses **draft/typing streaming** when a partial chunk begins with `NO_REPLY`, so silent operations don’t leak partial output mid-turn.

---

## Pre-compaction "memory flush" (implemented)

Goal: before auto-compaction happens, run a silent agentic turn that writes durable
state to disk (e.g. `memory/backlog/YYYY-MM-DD/compaction.md` in the agent workspace) so compaction can’t
erase critical context.

Alisio uses the **pre-threshold flush** approach:

1. Monitor session context usage.
2. When it crosses a “soft threshold” (below Pi’s compaction threshold), run a silent
   “write memory now” directive to the agent.
3. Use `NO_REPLY` so the user sees nothing.

Config (`agents.defaults.compaction.memoryFlush`):

- `enabled` (default: `true`)
- `softThresholdTokens` (default: `4000`)
- `prompt` (user message for the flush turn)
- `systemPrompt` (extra system prompt appended for the flush turn)

Notes:

- The default prompt/system prompt include a `NO_REPLY` hint to suppress delivery.
- The flush runs once per compaction cycle (tracked in `sessions.json`).
- The flush runs only for embedded Pi sessions (CLI backends skip it).
- The flush is skipped when the session workspace is read-only (`workspaceAccess: "ro"` or `"none"`).
- The canonical `memory/backlog/YYYY-MM-DD/compaction.md` seed is marked for `daily-only` promotion, so compaction flushes roll into the dated daily note instead of creating an artificial topic note.
- See [Memory](/concepts/memory) for the workspace file layout and write patterns.

Pi also exposes a `session_before_compact` hook in the extension API, but Alisio’s
flush logic lives on the Gateway side today.

---

## Troubleshooting checklist

- Session key wrong? Start with [/concepts/session](/concepts/session) and confirm the `sessionKey` in `/status`.
- Store vs transcript mismatch? Confirm the Gateway host and the store path from `alisio status`.
- Compaction spam? Check:
  - model context window (too small)
  - compaction settings (`reserveTokens` too high for the model window can cause earlier compaction)
  - tool-result bloat: enable/tune session pruning
- Silent turns leaking? Confirm the reply starts with `NO_REPLY` (exact token) and you’re on a build that includes the streaming suppression fix.
