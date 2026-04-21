---
summary: "Troubleshoot runtime pairing, foreground requirements, permissions, and tool failures"
read_when:
  - A runtime computer is connected but camera/canvas/screen/exec tools fail
  - You need the pairing versus approvals mental model
title: "Node Troubleshooting"
---

# Node troubleshooting

Use this page when a runtime computer is visible in status but node tools fail.

## Command ladder

```bash
alisio status
alisio gateway status
alisio logs --follow
alisio doctor
alisio channels status --probe
```

Then run runtime-specific checks:

```bash
alisio nodes status
alisio nodes describe --node <idOrNameOrIp>
alisio approvals get --node <idOrNameOrIp>
```

Healthy signals:

- The runtime computer is connected and paired for role `node`.
- `nodes describe` includes the capability you are calling.
- Exec approvals show expected mode/allowlist.

## Foreground requirements

Some GUI capture commands (`canvas.*`, `camera.*`, and `screen.*`) may require
the runtime app to stay in the foreground on the host that owns them.

Quick check and fix:

```bash
alisio nodes describe --node <idOrNameOrIp>
alisio nodes canvas snapshot --node <idOrNameOrIp>
alisio logs --follow
```

If you see `NODE_BACKGROUND_UNAVAILABLE`, bring the runtime app to the foreground and retry.

## Permissions matrix

| Capability                   | Runtime host requirement         | Typical failure code           |
| ---------------------------- | -------------------------------- | ------------------------------ |
| `camera.snap`, `camera.clip` | Camera (+ mic for clip audio)    | `*_PERMISSION_REQUIRED`        |
| `screen.record`              | Screen Recording                 | `*_PERMISSION_REQUIRED`        |
| `location.get`               | Location permission on that host | `LOCATION_PERMISSION_REQUIRED` |
| `system.run`                 | Exec approvals required          | `SYSTEM_RUN_DENIED`            |

## Pairing versus approvals

These are different gates:

1. **Computer pairing**: can this runtime computer connect to the gateway?
2. **Exec approvals**: can this runtime computer run a specific shell command?

Quick checks:

```bash
alisio devices list
alisio nodes status
alisio approvals get --node <idOrNameOrIp>
alisio approvals allowlist add --node <idOrNameOrIp> "/usr/bin/uname"
```

If pairing is missing, approve the computer first.
If pairing is fine but `system.run` fails, fix exec approvals/allowlist.

## Common node error codes

- `NODE_BACKGROUND_UNAVAILABLE` → app is backgrounded; bring it foreground.
- `CAMERA_DISABLED` → camera toggle disabled in runtime settings.
- `*_PERMISSION_REQUIRED` → OS permission missing/denied.
- `LOCATION_DISABLED` → location mode is off.
- `LOCATION_PERMISSION_REQUIRED` → requested location mode not granted.
- `LOCATION_BACKGROUND_UNAVAILABLE` → app is backgrounded but only While Using permission exists.
- `SYSTEM_RUN_DENIED: approval required` → exec request needs explicit approval.
- `SYSTEM_RUN_DENIED: allowlist miss` → command blocked by allowlist mode.
  On Windows node hosts, shell-wrapper forms like `cmd.exe /c ...` are treated as allowlist misses in
  allowlist mode unless approved via ask flow.

## Fast recovery loop

```bash
alisio nodes status
alisio nodes describe --node <idOrNameOrIp>
alisio approvals get --node <idOrNameOrIp>
alisio logs --follow
```

If still stuck:

- Re-approve device pairing.
- Re-open the runtime app (foreground).
- Re-grant OS permissions.
- Recreate/adjust exec approval policy.

Related:

- [/nodes/index](/nodes/index)
- [/nodes/camera](/nodes/camera)
- [/nodes/location-command](/nodes/location-command)
- [/tools/exec-approvals](/tools/exec-approvals)
- [/gateway/pairing](/gateway/pairing)
