---
summary: "macOS permission persistence (TCC) and signing requirements"
read_when:
  - Debugging missing or stuck macOS permission prompts
  - Packaging or signing the macOS app
  - Changing bundle IDs or app install paths
title: "macOS Permissions"
---

# macOS permissions (TCC)

macOS permission grants are fragile. TCC associates a permission grant with the
app's code signature, bundle identifier, and on-disk path. If any of those change,
macOS treats the app as new and may drop or hide prompts.

## Requirements for stable permissions

- Same path: run the app from a fixed location (for Alisio, `dist/Alisio.app`).
- Same bundle identifier: changing the bundle ID creates a new permission identity.
- Signed app: unsigned or ad-hoc signed builds do not persist permissions.
- Consistent signature: use a real Apple Development or Developer ID certificate
  so the signature stays stable across rebuilds.

Ad-hoc signatures generate a new identity every build. macOS will forget previous
grants, and prompts can disappear entirely until the stale entries are cleared.

## Recovery checklist when prompts disappear

1. Quit the app.
2. Remove the app entry in System Settings -> Privacy & Security.
3. Relaunch the app from the same path and re-grant permissions.
4. If the prompt still does not appear, reset TCC entries with `tccutil` and try again.
5. Some permissions only reappear after a full macOS restart.

## Restart-required states

Screen Recording and Accessibility can land in an awkward intermediate state:
System Settings shows them as granted, but the already-running Alisio process
still cannot use them yet.

When that happens, the local runtime should surface an explicit
**restart required** state instead of downgrading the permission back to
"missing" or waiting for a later helper failure. In practice:

- Screen Recording granted but not yet visible to the process should block
  observation as restart-required.
- Accessibility granted but not yet visible to the process should block local
  control as restart-required.
- The macOS UI should offer a restart action immediately.

This keeps the permission story honest across the native app, the local helper,
and the shared Gateway session state.

Example resets (replace bundle ID as needed):

```bash
sudo tccutil reset Accessibility ai.alisio.mac
sudo tccutil reset ScreenCapture ai.alisio.mac
sudo tccutil reset AppleEvents
```

## Files and folders permissions (Desktop/Documents/Downloads)

macOS may also gate Desktop, Documents, and Downloads for terminal/background processes. If file reads or directory listings hang, grant access to the same process context that performs file operations (for example Terminal/iTerm, LaunchAgent-launched app, or SSH process).

Workaround: move files into the Alisio workspace (`~/.alisio/workspace`) if you want to avoid per-folder grants.

If you are testing permissions, always sign with a real certificate. Ad-hoc
builds are only acceptable for quick local runs where permissions do not matter.
