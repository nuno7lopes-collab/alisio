#!/usr/bin/env node

// Legacy entrypoint shim. Keep silent for backwards compatibility and remove
// after the next release cycle once callers have migrated to `alisio.mjs`.
await import("./alisio.mjs");
