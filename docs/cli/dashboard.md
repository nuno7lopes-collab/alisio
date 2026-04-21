---
summary: "CLI reference for `alisio dashboard` (open the legacy browser admin surface)"
read_when:
  - You want to open the legacy browser admin surface with your current token
  - You want to print the URL without launching a browser
title: "dashboard"
---

# `alisio dashboard`

Open the legacy browser admin surface using your current auth.

This is an operator and compatibility path. The main product surface is the
native macOS app, not the browser admin UI.

```bash
alisio dashboard
alisio dashboard --no-open
```

Notes:

- `dashboard` resolves configured `gateway.auth.token` SecretRefs when possible.
- For SecretRef-managed tokens (resolved or unresolved), `dashboard` prints/copies/opens a non-tokenized URL to avoid exposing external secrets in terminal output, clipboard history, or browser-launch arguments.
- If `gateway.auth.token` is SecretRef-managed but unresolved in this command path, the command prints a non-tokenized URL and explicit remediation guidance instead of embedding an invalid token placeholder.
