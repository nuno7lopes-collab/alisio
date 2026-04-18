---
title: "Computer use v2"
summary: "Current macOS native computer-use runtime, helper-process boundary, and lifecycle contracts"
---

# Computer use v2

This page documents the current **macOS local computer-use runtime** in Alisio after the v2 isolation pass, the frame/action-engine hardening pass, and the first local safety-policy pass.

## Scope

- **In scope now:** local macOS computer use with a native helper process boundary.
- **Not in scope now:** host-local VNC/noVNC, browser sandbox convergence, or claimed background-safe control.
- **Future-compatible seams:** `local-mac` now, with room for `remote-node` and `ssh-mac` later.

## Runtime split

The current runtime is intentionally split into two layers:

- **Gateway/node layer**
  - `src/agents/tools/computer-tool.ts`
  - `src/gateway/server-methods/computer.ts`
  - `src/computer/*`
- **macOS native executor layer**
  - `apps/macos/Sources/Alisio/NodeMode/MacNodeRuntime.swift`
  - `apps/macos/Sources/Alisio/NodeMode/MacNodeComputerHelperClient.swift`
  - `apps/macos/Sources/Alisio/NodeMode/MacNodeComputerHelperServer.swift`
  - `apps/macos/Sources/Alisio/ComputerControlService.swift`

The gateway/node layer owns session state, policy decisions, approvals, and product-facing orchestration. The native helper owns screen capture, context capture, and input execution.

## Process boundary

Alisio now uses a **separate helper process** for native computer control on macOS.

- The helper is launched from the app binary with `--computer-helper`.
- The parent node runtime talks to it over a **versioned JSON protocol over stdio**.
- The helper is not declared as a browser sandbox and is not mixed with browser automation.
- The helper is not exposed as background-safe control. It still uses foreground macOS accessibility and screen-capture primitives.

This is a real process boundary, but it is **not NSXPC yet**. We chose a separate process with a typed protocol because it fits the current packaging/runtime architecture without introducing a larger packaging rewrite in this phase.

## Helper protocol

Protocol versioning lives in `MacNodeComputerHelperProtocol.swift`.

Current helper methods:

- `startSession`
- `stopSession`
- `pauseSession`
- `resumeSession`
- `captureFrame`
- `performActions`
- `getContext`
- `getPermissionState`
- `health`
- `kill`

Every request and response carries:

- `version`
- `id`
- `method`
- `payloadJSON`

This gives a stable mapping between **session**, **call**, and **helper response** while keeping the gateway-side step model separate.

## Frame contract

Every captured frame now carries normalized metadata needed for accurate and auditable local control:

- `frame.id`
- `displayId`
- `logicalWidth` / `logicalHeight`
- `pixelWidth` / `pixelHeight`
- `scaleFactor`
- `orientation`
- `capturedAt`
- `maxAgeMs`
- `staleAt`
- active app and active window context in the observation payload

This makes the source display and capture age explicit instead of inferred from the pane render size.

## Coordinate pipeline

The runtime now uses an explicit coordinate transform pipeline:

- **Source space:** captured display pixels from the native screenshot
- **Rendered space:** optional pane-rendered coordinates when the client provides downscaled coordinates
- **Reverse mapping:** rendered-pane coordinates can be remapped back to display pixels using `transform.sourceWidth`, `transform.sourceHeight`, `renderedWidth`, `renderedHeight`, and optional downscale factors

The native action validator resolves coordinates against the original display capture, not the pane DOM size. This is what keeps click and drag accuracy stable across Retina, non-Retina, and multi-monitor layouts.

## Action contract

The current structured action schema covers:

- `move`
- `click`
- `double_click`
- `right_click`
- `drag`
- `scroll`
- `type`
- `keypress`
- `wait`
- `screenshot`
- `focus_app`
- `open_url`
- `reveal_path`
- `open_path`
- `open_app`

Legacy aliases such as `app_focus` are normalized into the canonical action type before validation and execution.

## Validation and execution

The native helper validates actions before execution:

- source-frame presence for frame-bound actions
- frame id, display id, and capture timestamp consistency
- stale-frame rejection from `capturedAt` plus `maxAgeMs`
- bounds checks inside the source frame
- required fields for URLs, paths, apps, keypresses, typing, and waits
- minimal debounce between actions to avoid event storms

Execution returns explicit per-action results:

- `success`
- `elapsedMs`
- `retryCount`
- `failureCategory`
- `sourceFrameId`
- `resultFrameId`

Current failure categories are:

- `validation`
- `stale-frame`
- `invalid-target`
- `permission-missing`
- `cancelled`
- `execution-failed`
- `action-rejected`

## Session lifecycle

The helper and parent runtime model these session states:

- `running`
- `paused`
- `stopped`

The parent client model also tracks connection lifecycle:

- `idle`
- `starting`
- `running`
- `interrupted`
- `invalidated`
- `disabled`

Current behavior:

- `computer.observe` and `computer.act` ensure the helper session exists for the active session key.
- `computer.session.*` commands map directly to helper lifecycle methods.
- `computer.session.export` returns an honest debug/export snapshot of the current session without pretending a full forensic bundle already exists.
- On helper interruption, the client marks the connection as `interrupted`, clears in-flight calls, and reconnects lazily on the next request.
- On reconnect, the client restores desired session state for running and paused sessions before serving the next request.

## Capability matrix

The runtime now exposes an explicit capability matrix per session target:

- `observe_only`
- `foreground_control`
- `background_safe_control`
- `future_virtualized_control`

Current local-mac truth:

- `observe_only` is available and exposed.
- `foreground_control` is available and exposed.
- `background_safe_control` is unavailable and hidden.
- `future_virtualized_control` is unavailable and hidden.

This is deliberate. The local helper still drives real foreground macOS input,
so the product does not market or expose host-local background-safe control.

## Concurrency and arbitration

The current runtime now uses explicit target arbitration:

- one shared capture lane per target for `computer.observe`
- one exclusive control lane per target for `computer.act`
- no reentrant native work inside the same session
- multiple sessions can observe the same target, but they queue behind the
  shared capture budget
- only one session can own active control for the same target at a time

Current block reasons surfaced in session state and timeline:

- `focus_required`
- `approval_required`
- `runtime_busy`
- `concurrency_denied`

Current blocked-state renderings:

- `blocked_on_focus`
- `blocked_on_approval`
- `blocked_on_runtime`

This is intentionally honest about local macOS behavior. If control would steal
focus or use global input, the runtime marks it as foreground control required
instead of hiding that behind softer wording.

## Approval policy engine

Local computer use now runs through an explicit gateway-side policy engine.

Current session modes:

- `observe_only`
- `approved_apps_only`
- `foreground_supervised`
- `elevated_watch_mode`

Per-action policy outcomes:

- `allow`
- `require_once`
- `require_session`
- `deny`

The policy engine is evaluated after the fresh pre-action observe and before native execution. This is deliberate: the model can propose an action from a screenshot, but the local runtime decides whether that action is actually allowed to advance on the current surface.

## Safety event model

The session manager stores first-class safety events in the timeline. Current event types:

- `malicious_instruction_suspected`
- `sensitive_surface`
- `scope_escape_attempt`
- `auth_context_detected`
- `prod_terminal_detected`
- `payment_or_credentials_surface`
- `untrusted_external_content`

Each event carries a stable type plus reason code, timestamp, action type, and matched context metadata when available.

## Local policy scope

The local policy supports configurable allow and deny scope for:

- apps
- paths
- actions
- sensitive surfaces and contexts
- hosts and domains for URL-carrying actions

The current runtime also keeps a `commandLikeActions` list so higher-risk actions such as typing, keypresses, app focus, opening paths, and opening URLs can be treated more conservatively than simple pointer movement.

## Visual prompt injection mitigation

The runtime treats the visual surface as **untrusted by default**.

- The screenshot is input to planning, not proof that an action is safe.
- The local policy engine evaluates the proposed action against the observed app, window title, URL/path target, and heuristic surface matches.
- Suspicious visual instructions such as attempts to override rules, ask for approvals, or reveal secrets raise `malicious_instruction_suspected`.
- External-content apps such as browsers, chat apps, and mail clients raise `untrusted_external_content` for control actions.
- Sensitive or adversarial signals can automatically raise the session safety level and, in `foreground_supervised`, escalate the session into `elevated_watch_mode`.

This is intentionally described as a **heuristic** mitigation layer. It does not claim perfect detection of hostile visual content, but it does make the decision path explicit, local, and auditable.

## Screenshot -> action -> screenshot loop

The gateway-side tool contract now enforces:

1. fresh pre-action observe
2. approval if required
3. native action execution
4. post-action observe

Each action step is linked to the originating frame and the resulting frame. The native runtime returns post-action observations directly when available, and the gateway fills the step/timeline correlation fields.

## Timeline correlation

The session manager keeps a first-class mapping between:

- `sessionId`
- `runId` when available
- `responseId` when available
- `toolCallId`
- `stepId`
- `actionId`
- `nativeActionId`
- `sourceFrameId`
- `resultFrameId`

This correlation is used by the workspace pane, approval UX, logs, and replay/export plumbing. `runId` and `responseId` are part of the contract but remain optional in the current local-mac path when the caller has not provided them. We do not invent them.

Safety and approval decisions are now also correlated in that same timeline so the pane can explain why an action was allowed, gated, escalated, or denied.

Concurrency and capability exposure also enter that same timeline through:

- `session_arbitrated`
- `session_blocked`
- `focus_required`
- `runtime_busy`
- `concurrency_denied`
- `mode_exposed`
- `mode_hidden`

## Event log and replay metadata

Alongside the user-facing timeline, the session manager now keeps a structured per-session event log.

Current event codes:

- `frame_captured`
- `action_requested`
- `action_validated`
- `action_executed`
- `action_failed`
- `approval_requested`
- `approval_decided`
- `safety_raised`
- `state_transition`
- `session_paused`
- `session_resumed`
- `session_stopped`
- `session_blocked`
- `session_arbitrated`
- `focus_required`

Replay frames now also carry stable metadata in addition to the raw observation:

- frame hash
- capture latency
- stale/fresh state
- staleness age
- byte size
- display/app/window snapshot
- source transform metadata

This is what the workspace pane now uses for stable step selection, overlays, partial-data handling, and error inspection.

## Error model

The helper uses explicit error codes instead of freeform-only strings:

- `PERMISSION_MISSING`
- `HELPER_UNAVAILABLE`
- `CAPTURE_FAILED`
- `ACTION_REJECTED`
- `CONNECTION_INTERRUPTED`
- `CONNECTION_INVALIDATED`
- `PROTOCOL_VERSION_MISMATCH`
- `INVALID_REQUEST`

The gateway stores the helper runtime snapshot on the computer session so the workspace pane can show real helper state instead of inferring from UI state alone.

## Kill switch

The helper can be disabled with a kill switch:

- env: `ALISIO_COMPUTER_HELPER_DISABLED=1`
- defaults key: `Alisio.computerHelperDisabled`

When disabled:

- the macOS node stops declaring computer helper commands
- the client reports `disabled`
- the coordinator tears down the live helper/runtime connection instead of pretending computer control is still available

## Logging

- The helper writes **structured JSON lines** to stderr and mirrors key events to unified logging.
- The parent runtime logs helper launch, interruption, invalidation, and reconnect events under the macOS app log subsystem.
- The gateway-side session manager logs structured safety and approval events:
  - `approval_requested`
  - `approval_decided`
  - `safety_raised`
  - `policy_denied`
  - `policy_escalated`
  - `policy_mode_changed`

The gateway-side session state also keeps bounded in-memory buffers for:

- timeline: `80`
- structured events: `160`
- replay frames: `24`
- replay steps: `24`

When those buffers roll over, the session marks replay data as partial/truncated so the pane and exports can say that clearly.

## Hardening checklist

Current hardening status for the local-mac release gate:

- **Permission preflight:** frame capture fails closed without Screen Recording; native actions fail closed without Accessibility. The macOS app can request both interactively and open the correct Settings panes when they remain missing.
- **Signed-app requirement:** persistent TCC trust depends on running a signed app bundle. `scripts/restart-mac.sh --no-sign` is a dev convenience only and should not be treated as the production path for computer use.
- **Entitlements minimums:** local computer use relies primarily on TCC permissions rather than a special helper-only entitlement set. The packaged app keeps the existing app-wide entitlements from macOS packaging, and the dev-only `disable-library-validation` override remains opt-in rather than part of the normal release claim.
- **Helper isolation:** the executor runs in a separate helper process with a versioned protocol, interruption/invalidation handling, reconnect, and a kill switch. This is process isolation, not a separate XPC service or separate entitlement profile.
- **Runtime health:** `computer.health` and `computer.permissions` are queried through the node helper boundary and stored on the session so the product can expose real runtime state.
- **Safety escalation:** safety events can automatically escalate `foreground_supervised` sessions into `elevated_watch_mode` instead of leaving the user-facing approval mode stale.
- **Approval UX:** approval prompts come from policy outcomes (`require_once` / `require_session` / `deny`), not from UI-only guesses.
- **Blocked-state truthfulness:** sessions expose `blocked_on_focus`, `blocked_on_approval`, and `blocked_on_runtime` when those are the real reasons work cannot proceed.
- **Replay/export limits:** replay and export are bounded in memory, expose truncation flags, and do not claim a full forensic bundle.
- **Capability truthfulness:** `observe_only` and `foreground_control` are the only exposed local-mac capabilities. `background_safe_control` remains hidden because the runtime still depends on real foreground macOS input.
- **Browser separation:** browser sandbox behavior remains a separate lane and is not merged with host-local computer control.

## Release scope and non-claims

Supported in this release:

- local macOS frame capture with explicit frame metadata and stale-frame handling
- foreground local control through the helper process
- approval modes, safety events, and policy-driven allow/require/deny decisions
- session arbitration for shared observe and exclusive control
- workspace-pane replay, step inspection, event log, and session export summary

Not supported in this release:

- host-local VNC/noVNC
- claimed background-safe control on local macOS
- remote-node or `ssh-mac` computer control
- a full deterministic forensic replay bundle with raw visual artifacts
- a separate NSXPC service or separate helper-only entitlement profile

Heuristic or partial by design:

- visual prompt-injection detection
- sensitive-surface and auth-context detection
- replay/export completeness once bounded buffers have truncated older frames, steps, or events

## Safety and limits

- The runtime now has a real local policy engine, structured approvals, and heuristic visual prompt-injection detection.
- It does **not** claim background-safe control.
- It does **not** merge local computer control with the browser sandbox.
- It does **not** yet provide a full deterministic forensic replay bundle. Current export/replay is bounded, metadata-driven, and honest about truncation.
- It does **not** claim perfect automatic detection of prompt injection, credential surfaces, or sensitive intent. Current safety signals are explicit heuristics plus local policy scope.
- It does **not** claim that all actions are background-safe. The helper still drives real foreground macOS input.

## Related docs

- [Gateway architecture](/concepts/architecture)
- [macOS IPC](/platforms/mac/xpc)
