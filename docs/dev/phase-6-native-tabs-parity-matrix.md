# Phase 6 native tabs parity matrix

## Scope

Phase 6 closes the native macOS workspace tabs against the old web/server behavior
oracle without reopening the web product.

Rules for this phase:

- native macOS is the product surface
- old web/server is behavior-only baseline
- no embedded web product shell
- no roadmap rewrite
- no wishlist expansion
- parity means final product behavior, not debug UI parity

## Current tab state

- `Chat` is already a native SwiftUI route with a native inspector, native session
  switching, and Gateway-backed chat transport. It is the closest tab to product
  closure, but its state machine still spans `apps/macos` and `AlisioChatUI`.
- `Memory` is already a native list/graph/detail surface over canonical personal
  context files. Its biggest remaining closure gap is stale behavior: refresh
  failure currently clears the working surface instead of preserving the last
  trusted catalog.
- `Apps` is already a native grouped connector surface over the canonical
  providers/connectors RPCs. It already distinguishes connected, reconnect,
  auth/setup, and disconnected states.
- `Schedules` is already a native CRUD + activity surface over the canonical
  `cron.*` contract. The remaining closure risk is not missing CRUD, but making
  sure unsupported calendar projections never hide schedules silently.
- `Capabilities` is already a native capability-first surface over the canonical
  `skills.*` RPCs. It already keeps the last known list visible during refresh
  issues and has the cleanest stale semantics after `Connections`.
- `Connections` is already a native runtime/health/nodes surface with explicit
  reconnect and last-known-node behavior. It is the tab with the clearest
  current truthfulness contract.
- `Settings` is already intentionally launcher-only inside the workspace. The
  real app settings live in the native Settings window and must stay there.

## Canonical matrix by tab

### Chat

- Source of truth:
  `apps/macos/Sources/Alisio/WorkspaceNavigationState.swift`,
  `apps/macos/Sources/Alisio/AlisioWorkspaceRootView.swift`,
  `apps/macos/Sources/Alisio/MacGatewayChatTransport.swift`,
  `apps/macos/Sources/Alisio/GatewayConnection.swift`.
- Relevant old web/server reference:
  legacy WebChat/dashboard behavior through `chat.history`, `chat.send`,
  `chat.abort`, `chat.inject`, `sessions.list`, `sessions.create`,
  `sessions.patch`, `sessions.reset`, `sessions.delete`, and
  `sessions.compact` in `src/gateway/server-methods/chat.ts` and
  `src/gateway/server-methods/sessions.ts`.
- Required states:
  `loading` yes; `empty` yes; `filtered-empty` not applicable;
  `error` yes; `success` yes; `stale` yes; `reconnect` yes; `auth/setup` yes.
- Required actions:
  send text, send attachments, abort active run, switch session, create session,
  rename session, change model, change thinking level, reset session, compact
  session, delete session, open Apps when chat setup requires it.
- Required detail / selection / navigation:
  default to the canonical main session, preserve `activeSessionKey` across route
  changes, keep the native inspector tied to the tracked session, and never
  replace the tab with a web shell.
- Acceptable differences from the old web:
  native inspector layout, native session switcher, native spacing/typography,
  and stronger native activity visibility.
- Not acceptable:
  reintroducing WebKit as the primary chat shell, hiding reconnect/error state,
  losing the current session on route changes, or shipping weaker send/abort/
  session controls than the legacy behavior contract.
- Remaining drift risks:
  the visible chat state machine is split between the macOS shell and
  `AlisioChatUI`; reconnect and first-message behavior can drift unless the
  transport contract remains the canonical gate.
- Validation gates:
  `apps/macos/Tests/AlisioTests/WorkspaceNavigationStateTests.swift`,
  `apps/macos/Tests/AlisioTests/AlisioWorkspaceWindowSmokeTests.swift`,
  `apps/macos/Tests/AlisioTests/GatewayConnectionControlTests.swift`,
  `src/gateway/server.chat.gateway-server-chat.test.ts`,
  `src/gateway/server-methods/chat.directive-tags.test.ts`,
  `src/gateway/server-methods/chat.abort-authorization.test.ts`.

### Memory

- Source of truth:
  `apps/macos/Sources/Alisio/MemoryModels.swift`,
  `apps/macos/Sources/Alisio/MemorySettings.swift`.
- Relevant old web/server reference:
  canonical personal-context projection and file-read behavior from
  `src/gateway/server-methods/memory.ts`, plus the direct `agents.list` and
  `agents.files.get` contracts used by the native surface.
- Required states:
  `loading` yes; `empty` yes; `filtered-empty` yes; `error` yes; `success` yes;
  `stale` yes; `reconnect` not applicable as a tab-specific mode;
  `auth/setup` yes.
- Required actions:
  refresh, change agent, search, switch list/graph view, select file, select
  graph node, reload selected document.
- Required detail / selection / navigation:
  deterministic initial selection, stable agent selection, stable selected file,
  graph and list resolving to the same canonical document, and detail showing the
  exact canonical file content.
- Acceptable differences from the old web:
  native section grouping, native graph navigation, and omitting unsupported
  canonical files from the primary product surface.
- Not acceptable:
  exposing `preferences`, `setup_bootstrap`, or backlog notes as parity rows,
  reading arbitrary workspace files outside the canonical contract, or allowing
  search to escape the selected agent scope.
- Remaining drift risks:
  `MemorySettingsModel.refresh()` currently clears the last good catalog on load
  failure; that prevents Phase 6 from claiming full stale parity today.
- Validation gates:
  `apps/macos/Tests/AlisioTests/MemorySettingsModelTests.swift`,
  `src/gateway/server-methods/memory.test.ts`.

### Apps

- Source of truth:
  `apps/macos/Sources/Alisio/AppsSettings.swift`,
  `apps/macos/Sources/Alisio/AppsSettings+View.swift`,
  `apps/macos/Sources/Alisio/AppsSettings+State.swift`,
  `apps/macos/Sources/Alisio/AppsSettings+Helpers.swift`.
- Relevant old web/server reference:
  the legacy control/admin connector surface backed by
  `alisio.providers.get`, `connectors.begin`, and `connectors.revoke` in
  `src/gateway/server-methods/alisio.ts`.
- Required states:
  `loading` yes; `empty` yes; `filtered-empty` not applicable; `error` yes;
  `success` yes; `stale` yes; `reconnect` yes; `auth/setup` yes.
- Required actions:
  refresh, select app, connect, reconnect, disconnect, open setup guide, open
  OAuth flow, open docs URL when present.
- Required detail / selection / navigation:
  canonical grouping by app surface, stable selection across refresh, honest
  account/status summaries, and capability-level detail within each app group.
- Acceptable differences from the old web:
  grouping multiple OAuth scopes into one native app card and using the external
  browser for setup/auth completion.
- Not acceptable:
  surfacing `coming_soon` or unavailable zombies, flattening auth/setup into
  “connected”, or collapsing `needsReconnect` into a generic error.
- Remaining drift risks:
  catalog metadata and connector grouping can drift; browser-based OAuth
  completion depends on the follow-up refresh loop staying truthful.
- Validation gates:
  `apps/macos/Tests/AlisioTests/AppsSurfaceModelTests.swift`,
  `src/gateway/server-methods/alisio.test.ts`.

### Schedules

- Source of truth:
  `apps/macos/Sources/Alisio/CronJobsStore.swift`,
  `apps/macos/Sources/Alisio/CronSettings.swift`,
  `apps/macos/Sources/Alisio/CronSettings+Calendar.swift`,
  `apps/macos/Sources/Alisio/CronSettings+Rows.swift`,
  `apps/macos/Sources/Alisio/CronJobEditor.swift`.
- Relevant old web/server reference:
  legacy dashboard/control scheduling behavior backed by `cron.status`,
  `cron.list`, `cron.runs`, `cron.run`, `cron.remove`, `cron.update`, and
  `cron.add` in `src/gateway/server-methods/cron.ts`.
- Required states:
  `loading` yes; `empty` yes; `filtered-empty` not applicable; `error` yes;
  `success` yes; `stale` yes; `reconnect` shared through runtime state only;
  `auth/setup` yes.
- Required actions:
  refresh jobs, refresh runs, create schedule, edit schedule, run now,
  pause/resume, delete, change display mode, select occurrence, open linked
  session.
- Required detail / selection / navigation:
  stable selected schedule, scoped run history, explicit unsupported-calendar
  bucket, and detail staying authoritative even when calendar rendering is not.
- Acceptable differences from the old web:
  native list/week/month presentation instead of a browser dashboard table.
- Not acceptable:
  silently hiding unsupported schedules, scoping activity/errors to the wrong
  job, or allowing the calendar view to imply full schedule coverage when it
  cannot render all definitions.
- Remaining drift risks:
  unsupported schedule projection is the main parity footgun; list/detail must
  stay the canonical truth even when the calendar cannot render a job.
- Validation gates:
  `apps/macos/Tests/AlisioTests/CronSettingsStateTests.swift`,
  `apps/macos/Tests/AlisioTests/ScheduleCalendarProjectionTests.swift`,
  `apps/macos/Tests/AlisioTests/CronJobEditorTests.swift`,
  `src/gateway/server-cron.test.ts`.

### Capabilities

- Source of truth:
  `apps/macos/Sources/Alisio/CapabilitiesSettings.swift`,
  `docs/platforms/mac/skills.md`.
- Relevant old web/server reference:
  the legacy skills surface backed by `skills.status`, `skills.install`, and
  `skills.update` in `src/gateway/server-methods/skills.ts`.
- Required states:
  `loading` yes; `empty` yes; `filtered-empty` yes; `error` yes; `success` yes;
  `stale` yes; `reconnect` shared through runtime error copy; `auth/setup` yes.
- Required actions:
  refresh, filter, enable/disable, install on gateway, install on this Mac, set
  API key, set non-primary env values.
- Required detail / selection / navigation:
  capability-first naming, deterministic filters, per-capability busy state, and
  no promotion of raw “skills” as the user-facing product category.
- Acceptable differences from the old web:
  capability-first naming, native install targeting, and native environment-key
  editor sheets.
- Not acceptable:
  leaking raw skills terminology as the primary product, silently enabling a
  capability whose requirements still fail, or dropping the last known list on a
  refresh issue.
- Remaining drift risks:
  capability mapping is only as stable as the `SkillStatus` contract; install and
  env update flows must keep verifying post-refresh truth, not optimistic local
  state.
- Validation gates:
  `apps/macos/Tests/AlisioTests/CapabilitiesSettingsStateTests.swift`,
  `src/gateway/server-methods/skills.marketplace.test.ts`,
  `src/gateway/server-methods/skills.update.normalizes-api-key.test.ts`.

### Connections

- Source of truth:
  `apps/macos/Sources/Alisio/InstancesSettings.swift`,
  `apps/macos/Sources/Alisio/InstancesStore.swift`,
  `apps/macos/Sources/Alisio/HealthStore.swift`.
- Relevant old web/server reference:
  legacy runtime/health/presence behavior through `health`, `status`,
  `system-presence`, and presence push events in the gateway.
- Required states:
  `loading` yes; `empty` yes; `filtered-empty` not applicable; `error` yes;
  `success` yes; `stale` yes; `reconnect` yes; `auth/setup` yes.
- Required actions:
  refresh all, refresh health, refresh nodes. Local mode also includes the
  Tailscale section behavior from the same native tab.
- Required detail / selection / navigation:
  honest route facts, honest auth facts, honest local vs remote distinction,
  explicit reconnecting vs disconnected vs degraded states, and no fabricated
  node rows when presence is empty.
- Acceptable differences from the old web:
  native card layout and local-only Tailscale section instead of a generic web
  status dashboard.
- Not acceptable:
  claiming “connected” while the control channel is down, inventing connection
  details when unconfigured, or discarding last-known nodes on invalid presence
  payloads.
- Remaining drift risks:
  endpoint-state truth and control-channel truth come from different sources; the
  tab must continue resolving those conflicts honestly instead of flattening them.
- Validation gates:
  `apps/macos/Tests/AlisioTests/ConnectionsSurfaceTests.swift`,
  `apps/macos/Tests/AlisioTests/InstancesStoreTests.swift`,
  `apps/macos/Tests/AlisioTests/HealthStoreStateTests.swift`.

### Settings

- Source of truth:
  workspace route launcher in
  `apps/macos/Sources/Alisio/WorkspaceSettingsLauncherView.swift`,
  actual settings product in
  `apps/macos/Sources/Alisio/SettingsRootView.swift`,
  `apps/macos/Sources/Alisio/SettingsWindowOpener.swift`.
- Relevant old web/server reference:
  old control/admin settings and account/runtime/config flows, now expressed
  natively through the Settings window and the underlying `config.*`,
  `alisio.account.*`, `voicewake.*`, and related gateway methods.
- Required states:
  `loading` yes for summary refresh and Permissions tab refresh;
  `empty` not applicable as a workspace tab state;
  `filtered-empty` not applicable;
  `error` only in the underlying native settings sub-tabs, not as a workspace
  launcher page;
  `success` yes;
  `stale` not applicable beyond transient summary lag;
  `reconnect` not applicable as a dedicated tab state;
  `auth/setup` yes.
- Required actions:
  open General, Permissions, Voice Wake, Config, Debug when enabled, and About.
- Required detail / selection / navigation:
  the workspace route must remain a launcher-only shell, each launcher card must
  open the matching native Settings tab, and app-level settings must not be
  duplicated back into the workspace shell.
- Acceptable differences from the old web:
  a separate native Settings window and native summary cards instead of a full
  in-tab settings form.
- Not acceptable:
  duplicating General/Permissions/Config/Debug forms inside the workspace tab,
  reopening web settings as a product surface, or scattering app-level settings
  back into other product tabs.
- Remaining drift risks:
  launcher summaries can drift from the real Settings tabs if refresh timing
  regresses; Phase 6 must treat the Settings window, not the launcher copy, as
  the authoritative settings product.
- Validation gates:
  `apps/macos/Tests/AlisioTests/WorkspaceNavigationStateTests.swift`,
  `apps/macos/Tests/AlisioTests/SettingsWindowOpenerTests.swift`,
  `apps/macos/Tests/AlisioTests/SystemSettingsURLSupportTests.swift`.

## Ideal execution order

1. `Connections`
   Make runtime truth, reconnect semantics, and health honesty non-negotiable
   before closing any dependent tab.
2. `Settings`
   Lock the launcher-only contract so app settings do not get re-duplicated into
   the workspace.
3. `Chat`
   Close the main product route once connection truth and settings ownership are
   fixed.
4. `Memory`
   Close canonical file scope and stale behavior next because chat context and
   memory semantics are tightly coupled.
5. `Capabilities`
   Close install/setup/enablement truth before connector flows depend on it.
6. `Apps`
   Close connector parity once setup/install semantics are already canonical.
7. `Schedules`
   Close scheduling last, because it depends on runtime truth, sessions, channels,
   and account state already being stable.

## Real blockers

- `Memory` does not yet preserve last-known-good content on refresh failure, so
  it cannot claim full stale parity.
- `Chat` behavior spans both the native shell and `AlisioChatUI`, so parity can
  drift unless Phase 6 treats the transport/state contract as the hard gate.
- `Schedules` still has a partial calendar renderer; list/detail must remain the
  canonical authority for unsupported schedules or the tab will hide real state.
- `Settings` is only safe if the launcher-only contract stays explicit; otherwise
  future work will re-duplicate app settings into the workspace and effectively
  reopen the old web product shape by another name.

## Definition of done by tab

### Chat

- The default workspace route is native chat and never embeds the old web shell.
- All required chat/session actions are reachable from native UI and map to the
  canonical gateway methods.
- Loading, empty, error, stale, reconnect, success, and auth/setup states are
  explicit and truthful.
- The session switcher, inspector, and route transitions preserve the active
  session key.
- Route smoke, transport, and gateway chat/session gates are green.

### Memory

- The tab shows only canonical memory files that belong in the product surface.
- List, graph, search, and detail all resolve to the same canonical file set.
- Sign-in, empty, filtered-empty, detail error, and success states are explicit.
- The last trusted catalog remains visible when refresh fails.
- Memory model and gateway memory gates are green.

### Apps

- Grouping and status derive from the canonical providers/connectors contracts.
- Connect, reconnect, disconnect, and setup-guide actions are all native and
  honest.
- The app keeps the last known list visible during refresh failures.
- No unreleased or unavailable connector zombies appear.
- Apps surface and connector gateway gates are green.

### Schedules

- CRUD, run-now, pause/resume, delete, edit, and activity history all work from
  native UI.
- Empty, error, auth-required, success, and stale states are explicit.
- Unsupported calendar items are visible and selectable instead of silently
  disappearing.
- Selection and activity remain scoped to the selected schedule.
- Schedule UI, editor, projection, and gateway cron gates are green.

### Capabilities

- The user-facing product is “Capabilities”, not raw “Skills”.
- Filter, install, enable/disable, and env/API-key setup actions all round-trip
  through the canonical gateway contracts.
- Refresh failures do not blank the last known list.
- Ready vs needs-setup vs disabled remains explicit and stable.
- Capability UI and gateway skills gates are green.

### Connections

- The tab never overstates runtime health or connectivity.
- Reconnecting, disconnected, degraded, healthy, unconfigured, empty, and stale
  node states are explicit and distinct.
- Invalid presence updates preserve the last known nodes instead of fabricating
  fake fallback rows.
- Local and remote transport facts stay accurate.
- Connections UI, presence, and health gates are green.

### Settings

- The workspace tab remains a launcher-only route.
- General, Permissions, Voice Wake, Config, Debug, and About open in the native
  Settings window at the correct destination.
- Summary cards refresh enough to stay directionally honest, but the real source
  of truth remains the native Settings window.
- No app-level settings form is reintroduced into the workspace shell.
- Settings launcher/opener/system-settings gates are green.
