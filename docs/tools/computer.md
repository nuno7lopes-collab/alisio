---
summary: "Native-first local macOS computer use with screenshots plus structured actions"
read_when:
  - Enabling local host computer use on macOS
  - Debugging missing Screen Recording or Accessibility permissions
  - Understanding how the Computer pane differs from the sandbox browser
title: "Computer (local macOS)"
---

# Computer (local macOS)

Alisio can expose the **local macOS desktop** to the agent without embedding the
host in VNC/noVNC. The agent observes the machine through screenshots/frames and
acts through structured native macOS actions.

This is separate from the managed [Browser](/tools/browser):

- `browser` remains the isolated sandbox/browser-control lane.
- `computer` targets the real local macOS GUI.
- The right-hand pane can switch between **Browser**, **Computer**, and
  **Tool output** surfaces.

## What it does

- Captures the current desktop frame plus cursor and frontmost app/window context.
- Executes native actions such as click, double click, drag, scroll, type,
  keypress, wait, open URL, reveal path, open path, and app focus.
- Tracks session state, timeline, approvals, and permission status in the
  Computer pane.

## Availability

Local macOS computer use is part of the normal macOS runtime. There is no
feature flag for it anymore.

## Permissions

The native helper reuses the existing macOS permission flow:

- **Screen Recording** is required to observe frames.
- **Accessibility** is required to execute GUI actions.

If a permission is missing, the Computer pane shows the missing capability and
offers a native permission request path in the macOS app.

## Approval modes

The session supports three approval modes:

- `observe-only`
- `control-approved-apps`
- `elevated-watch`

Sensitive actions pause the loop and require explicit approval in the Computer
pane. The user can approve once, approve for the session, pause, or stop the
session.

## Architecture

Local computer use is split into a few layers:

- A native macOS executor validates permissions, captures frames, and performs
  structured actions.
- A Gateway-side computer session manager owns timeline, approval state, status,
  and session-level policy.
- The agent-facing `computer` tool uses screenshots plus structured actions
  rather than a live remote-control stream.
- The UI renders the Computer surface natively in the existing right-hand pane.

This design keeps the managed browser lane intact while adding a separate local
host control surface for macOS.
