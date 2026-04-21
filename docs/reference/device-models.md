---
summary: "How Alisio vendors Apple device model identifiers for friendly names in the macOS app."
read_when:
  - Updating device model identifier mappings or NOTICE/license files
  - Changing how Instances UI displays device names
title: "Device Model Database"
---

# Device model database (friendly names)

The macOS app shows friendly Apple device model names in the **Instances** UI by mapping Apple model identifiers (e.g. `Mac16,6`) to human-readable names.

The mapping is vendored as JSON under:

- `apps/macos/Sources/Alisio/Resources/DeviceModels/`

## Data source

We currently vendor the mapping from the MIT-licensed repository:

- `kyle-seongwoo-jun/apple-device-identifiers`

To keep builds deterministic, the JSON files are pinned to specific upstream commits (recorded in `apps/macos/Sources/Alisio/Resources/DeviceModels/NOTICE.md`).

## Updating the database

1. Pick the upstream commit you want to pin for macOS.
2. Update the commit hashes in `apps/macos/Sources/Alisio/Resources/DeviceModels/NOTICE.md`.
3. Re-download the JSON file, pinned to that commit:

```bash
MAC_COMMIT="<commit sha for mac-device-identifiers.json>"

curl -fsSL "https://raw.githubusercontent.com/kyle-seongwoo-jun/apple-device-identifiers/${MAC_COMMIT}/mac-device-identifiers.json" \
  -o apps/macos/Sources/Alisio/Resources/DeviceModels/mac-device-identifiers.json
```

4. Ensure `apps/macos/Sources/Alisio/Resources/DeviceModels/LICENSE.apple-device-identifiers.txt` still matches upstream (replace it if the upstream license changes).
5. Verify the macOS app builds cleanly (no warnings):

```bash
swift build --package-path apps/macos
```
