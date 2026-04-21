---
summary: "Native-first local macOS computer use with screenshots plus structured actions"
read_when:
  - Enabling local host computer use on macOS
  - Debugging missing Screen Recording or Accessibility permissions
  - Understanding how local macOS computer use differs from remote web tooling
title: "Computer (local macOS)"
---

# Computer (local macOS)

Alisio can expose the **local macOS desktop** to the agent through screenshots,
frames, and structured native macOS actions instead of a remote-control stream.

On macOS, visible local interaction should happen through `computer`.

Remote/non-local web capabilities such as `web_search`, `web_fetch`, apps, and
connectors remain separate from this local computer surface.

## What it does

- Captures the current desktop frame plus cursor, display metadata, and
  frontmost app/window context.
- Normalizes each frame with display id, logical size, pixel size, scale
  factor, orientation, capture timestamp, and stale-frame window metadata.
- Executes native actions such as move, click, double click, drag, scroll,
  type, keypress, wait, screenshot, focus app, open URL, reveal path, open
  path, and open app.
- Forces a fresh screenshot before each control action, then captures the
  resulting post-action frame for a deterministic screenshot -> action ->
  screenshot loop.
- Rejects stale or invalid action targets before execution instead of trying to
  guess intent from an outdated frame.
- Tracks session state, timeline, approvals, step ids, action ids, source and
  result frame ids, and permission status in the Computer pane.
- Evaluates each proposed control action through a local approval and safety
  policy before native execution.

## Availability

Local macOS computer use is part of the normal macOS runtime. There is no
feature flag for it anymore.

The current capability truth for local macOS is:

- `observe_only`: available
- `foreground_control`: available

Windows note:

- `windows-local` remains capability-gated and unavailable
- native Windows currently stops at the desktop-host shell foundation, not at a
  Windows equivalent of the local macOS `computer` runtime
- for the current Windows host status, see [Windows](/platforms/windows)

Web note:

- the web app does **not** expose host-local `computer`
- web keeps remote/non-local capabilities such as `web_search`, `web_fetch`,
  apps, and connectors

In practice this means local host control still depends on real foreground
macOS input. The UI should say **Foreground control required** when that is the
real execution mode.

## Permissions

The native helper reuses the existing macOS permission flow:

- **Screen Recording** is required to observe frames.
- **Accessibility** is required to execute GUI actions.

If a permission is missing, the Computer pane shows the missing capability and
offers a native permission request path in the macOS app.

If macOS has already recorded the grant but the running process still needs a
restart to pick it up, the session should move into
`blocked_on_restart_required` instead of pretending the permission is fully
ready. The pane should show a restart action and an explicit summary instead
of waiting for a later observe/action failure to reveal the truth.

## Approval modes

The session supports four approval modes:

- `observe_only`
- `approved_apps_only`
- `foreground_supervised`
- `elevated_watch_mode`

The current mode is session state, not just UI state. The local policy engine
evaluates every control action and returns one of four decisions:

- `allow`
- `require_once`
- `require_session`
- `deny`

When approval is required, the Computer pane shows the concrete reason and lets
the user choose **Approve once**, **Approve for session**, or **Deny**.

`observe_only` never allows control actions.

`approved_apps_only` only grants session-level access to approved targets and
still asks for one-time approval on sensitive actions or surfaces.

`foreground_supervised` allows low-risk foreground actions but escalates to
approval on sensitive surfaces and can automatically switch into
`elevated_watch_mode`.

`elevated_watch_mode` is the strictest active-control mode and requires
one-time approval for control actions.

## Safety policy

The local runtime ships with an explicit policy engine instead of ad hoc UI
rules.

Configurable scope exists for:

- apps
- paths
- actions
- sensitive surfaces and contexts
- hosts and domains for URL-carrying actions

Current safety event types are:

- `malicious_instruction_suspected`
- `sensitive_surface`
- `scope_escape_attempt`
- `auth_context_detected`
- `prod_terminal_detected`
- `payment_or_credentials_surface`
- `untrusted_external_content`

These events are recorded in the session timeline and can raise the safety
level or change the approval behavior for subsequent actions.

## Visual prompt injection

The visual surface is treated as **untrusted by default**.

- The model can propose the next action from the screenshot.
- The local Alisio policy decides whether that action is allowed, requires
  approval, or must be denied.
- Heuristics look at the observed app, window title, URL/path target, and
  suspicious on-screen phrases such as attempts to bypass safety or request
  approvals.
- Browsers, chat apps, and similar external-content surfaces are treated more
  conservatively for control actions.

This is a heuristic local defense layer. It improves safety and auditability,
but it does not claim perfect detection of adversarial content.

## Architecture

Local computer use is split into a few layers:

- A native macOS executor validates permissions, captures frames, and performs
  structured actions.
- That executor runs inside a separate local helper process with a versioned
  protocol; it is not a VNC/noVNC host flow.
- A Gateway-side computer session manager owns timeline, approval state, status,
  step lifecycle, session-level policy, and safety events.
- The agent-facing `computer` tool uses screenshots plus structured actions
  rather than a live remote-control stream, and links each tool call to an
  explicit computer step with approval/action/observation phases.
- The UI renders the Computer surface natively in the existing right-hand pane.

This design gives macOS a single local interaction path through `computer`.

## Concurrency model

The local runtime now uses explicit session arbitration:

- multiple sessions can observe the same local target, but they share a single
  capture lane and queue fairly behind the current capture
- only one session can own control of the same local target at a time
- the same session cannot start overlapping native actions or reenter the
  native lane while another action is still active
- pause, stop, and runtime interruption abort the current lane through session
  cancellation

When a lane cannot proceed, the session exposes a real blocked state instead of
pretending the action is still active:

- `blocked_on_focus`
- `blocked_on_approval`
- `blocked_on_runtime`
- `blocked_on_permissions`
- `blocked_on_restart_required`

The timeline also records runtime-side concurrency events such as
`session_arbitrated`, `focus_required`, `runtime_busy`, and
`concurrency_denied`.

During helper startup or restart, `blocked_on_runtime` is the expected state.
The runtime should expose an honest summary such as `computer helper cold start
in progress` instead of a generic execution error.

The native macOS pane should read that shared session state from
`computer.session.get` / `computer.session.update` rather than reconstructing a
separate local-only lifecycle model.

## Frame and coordinate accuracy

The runtime treats the captured display frame as the source of truth.

- Source coordinates are expressed in captured display pixels.
- If the UI or caller sends downscaled pane coordinates, the action payload can
  include transform metadata so the helper remaps them back into source pixels.
- The helper validates display bounds and frame freshness before dispatching
  click, drag, or move events.

This is what keeps click and drag accuracy stable across Retina and non-Retina
displays, multi-monitor layouts, and downscaled pane renders.

## Action results

Each executed action now returns structured result data:

- `success`
- `elapsedMs`
- `retryCount`
- `failureCategory`
- `sourceFrameId`
- `resultFrameId`

This allows the session timeline and later replay tooling to correlate
session-level state with the physical frame that an action used and the frame it
produced.

## Event log and replay

The session manager now keeps a structured event log alongside the user-facing
timeline.

Current structured event codes:

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

Replay frames now also expose stable metadata such as frame hash, capture
latency, stale/fresh state, byte size, display/app/window context, and source
transform metadata.

The right-hand Workspace Pane uses this to keep replay ordering, step
inspection, diff overlays, and partial-data states consistent.

## Structured logging

The local policy path emits structured logs for:

- `approval_requested`
- `approval_decided`
- `safety_raised`
- `policy_denied`
- `policy_escalated`
- `policy_mode_changed`

The runtime/concurrency path also emits:

- `session_arbitrated`
- `session_blocked`
- `focus_required`
- `runtime_busy`
- `concurrency_denied`
- `mode_exposed`
- `mode_hidden`

These logs are intended for auditability and support the right-pane safety
timeline without mixing unrelated remote web-tool events into the local
computer lane.

## Session export

The gateway now exposes `computer.session.export` for support/debug flows.

This export includes:

- session summary
- buffer limits and truncation flags
- structured event history
- last errors
- approval history
- safety history
- timeline summary
- replay steps
- replay frame metadata

The export deliberately omits raw frame image payloads and marks replay frames
as redacted instead of pretending the current runtime already provides a full
forensic artifact bundle.

## Operator guide

Recommended operator flow for local macOS computer use:

1. Run the signed macOS app bundle, not an ad-hoc dev bundle, before relying on Screen Recording or Accessibility state.
2. Keep the lanes separate:
   `computer` is the real local macOS surface, and `tool_output` is the generic
   workspace output lane. Remote web tools remain separate and do not provide
   host-local control.
3. Use `observe_only` when you only need visibility. Switch to a control mode only when foreground local input is acceptable.
4. Treat **Foreground control required** literally. On local macOS, control can still move focus or use global input.
5. If macOS permissions were just granted and the runtime still reports them missing, restart the app and re-check the Computer pane before assuming the session is broken.

## Manual QA checklist

Manual QA for the current local-mac release gate should cover at least:

- Screen Recording missing: observation fails closed, UI shows the missing permission, and the permission path opens the correct macOS settings.
- Accessibility missing: control actions fail closed, UI shows the missing permission, and the permission path opens the correct macOS settings.
- Permission grant plus restart path: after granting permissions, restart the app and confirm the session transitions back to healthy state.
- Helper restart or invalidation: force a helper restart/invalidation and confirm the runtime reports the interruption honestly, then reconnects on the next request.
- Pause, resume, and stop: confirm these commands change real helper state rather than only local UI state.
- Approval allow and deny: verify **Approve once**, **Approve for session**, and **Deny** all change real execution outcomes and timeline state.
- Sensitive-surface escalation: verify a sensitive surface raises a safety event and escalates into stricter supervision when policy requires it.
- Replay partial or truncated: confirm the pane marks partial/truncated replay data clearly instead of crashing or pretending history is complete.
- Multi-monitor and Retina: confirm frame metadata, remap accuracy, and overlays stay correct across display scale and display selection changes.
- Focus-steal truthfulness: confirm control paths that need real foreground input show **Foreground control required**.
- Stop during long input: stop a long drag or typing sequence and confirm cancellation is reflected in state, timeline, and error reporting.
- Concurrent sessions: multiple sessions may observe, but only one may control the same target at a time; blocked sessions should show a real blocked reason.
- No browser-sandbox fallback: local macOS interaction should not fall back to a browser-only control path.
- Old or partial session payloads: older or truncated session data should not break the Workspace Pane.
- Session export: `computer.session.export` should return summary, errors, approval history, safety history, and replay metadata without raw frame payloads.

## Current support and limits

What is production-grade in the current local-mac release:

- native local observation with explicit frame metadata
- foreground local control through the helper-process boundary
- policy-driven approvals and safety escalation
- real blocked states, session arbitration, and capability gating
- workspace-pane replay, structured event logging, and session export summary

What remains capability-gated or out of scope:

- remote-node and `ssh-mac` control are future work, not part of this release
- `windows-local` remains unavailable
- web remains remote/non-local only and does not expose host-local `computer`

What remains heuristic or bounded:

- visual prompt-injection and sensitive-surface detection
- auth/payment/credential-surface inference
- replay and export completeness once session buffers truncate older artifacts

This page should not be read as a claim of perfect detection, full forensic replay, or background-safe host-local control.

## Release note

Current release note for this surface:

- the **macOS local computer** lane is production-grade enough to ship with
  explicit limitations
- the **Windows desktop host** is foundation work only and does not yet expose
  local `computer`
- the **web app** does not expose host-local `computer` and should keep using
  remote/non-local surfaces such as `web_search`, `web_fetch`, apps, and
  connectors

The honest launch message is therefore:

- macOS: local observation plus foreground-supervised control
- Windows: desktop host foundation without local computer control
- web: no host-local computer control

This should not be marketed as full cross-platform parity yet.
