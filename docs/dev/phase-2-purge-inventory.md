# Phase 2 purge inventory

## Scope

This inventory records the final purge state after the product direction changed to:

- native macOS now
- native Windows later
- shared backend
- required account auth and per-account isolation
- web removed as a product surface

The default rule for this phase was deletion. Remaining legacy-shaped names are listed only when they still have a live contract or a concrete follow-up reason.

## Decision

Phase 2 can close with no active blockers.

The purge removed the public web docs, dead macOS smoke and testing hooks, legacy memory config surfaces, stale onboarding docs, and orphan development scripts. Remaining items are either live contracts, acceptable generated-doc debt, or Windows preparation.

## Blockers

None.

The final audit fixed the last blocking leftovers:

- `package.json` no longer exposes `test:e2e:openshell` pointing to the removed `test/openshell-sandbox.e2e.test.ts`.
- `docs/help/testing.md` now references `WorkspaceMainSessionKeyTests` and `WorkspaceNavigationStateTests` instead of removed WebChat and shell test names.
- `docs/dev/codex/AGENT_HERMES.md` and `docs/dev/codex/AGENT_HEPHAESTUS.md` no longer describe removed `memory.ledger.enabled` or `memory.legacyMarkdownProjection.enabled` rollout surfaces.

## Keep by live contract

- Internal `webchat` channel identifiers remain in `src/utils/message-channel.ts`, `src/config/sessions/**`, `src/auto-reply/**`, `src/gateway/**`, and `apps/macos/Sources/Alisio/GatewayConnection.swift`.
  This is not the web product. It is the internal session and routing surface used by local UI, gateway events, and historical session metadata.
- `docs/platforms/mac/webchat.md` remains as a compatibility path, but its visible content is now the native workspace story. Published redirects still point there for old `/webchat` and `/mac/webchat` URLs.
- `src/commands/dashboard.ts`, `src/infra/control-ui-assets.ts`, `docs/cli/dashboard.md`, and gateway security docs retain Control UI and dashboard terminology for the legacy admin and operator surface. This is not positioned as the product UI.
- Canvas `WKWebView` code remains in `apps/macos/Sources/Alisio/CanvasWindowController.swift`, `apps/macos/Sources/Alisio/CanvasSchemeHandler.swift`, and `apps/shared/AlisioKit/Sources/AlisioKit/WebViewJavaScriptSupport.swift`.
  This is Canvas runtime, not an embedded web shell for the product workspace.
- OpenShell references remain under gateway sandboxing and the `extensions/openshell` package. This is a sandbox backend plugin, not the removed web product.
- `src/config/config.memory-settings.test.ts` still mentions `legacyMarkdownProjection` as a negative test that proves the removed config key is rejected.

## Acceptable debt

- `docs/zh-CN/web/**` still exists because `docs/zh-CN/**` is generated. The English source pages were removed and `docs/docs.json` no longer promotes the web section. Remove these through the i18n pipeline, not by hand-editing generated docs.
- `docs/zh-CN/**` and `docs/gateway/configuration-examples.md` still contain known formatting debt reported by `pnpm format:docs:check`. This predates the purge slices and was not introduced by the final inventory changes.
- Some FAQ and gateway operator docs still mention Control UI and dashboard flows because the admin surface still exists. A future naming pass can rename this to "legacy admin" more aggressively, but deleting it now would remove live operator documentation.

## Deferred to Windows

- `apps/windows/**` keeps shell compatibility and host foundation code. It is allowed only as a transition layer toward a future native Windows frontend.
- Windows documentation should keep saying "Windows later" and must not promise parity with macOS until the native host work starts.

## Removed in Phase 2

- Public English `docs/web/**` pages.
- Redundant docs hubs and duplicate platform pages.
- macOS `+Testing` helpers, coverage-only tests, preview smoke tests, and workspace shell names that no longer matched the native product.
- Orphan dev scripts `scripts/dev/gateway-smoke.ts` and `scripts/dev/gateway-ws-client.ts`.
- Memory config surfaces `memory.legacyMarkdownProjection` and `memory.ledger`.
- Legacy memory projection aliases, old sync env precedence, and historical derived-state materialization paths.

## Final follow-up list

- Run the zh-CN i18n pipeline when ready to remove generated `docs/zh-CN/web/**`.
- Decide later whether the operator/admin Control UI should be renamed more aggressively across CLI and gateway docs.
- Revisit `apps/windows/**` only when starting the Windows native frontend phase.
