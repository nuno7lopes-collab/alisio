---
summary: "How the macOS app handles account entry, direct workspace access, and follow-up runtime review."
read_when:
  - Documenting the macOS account-entry and first-workspace flow
  - Aligning setup copy with the current product flow
title: "macOS App Setup"
sidebarTitle: "macOS App Setup"
---

# macOS App Setup

The macOS app starts with account entry, not a standalone technical wizard.

When account entry is finished and this Mac already knows how it should reach
Alisio, the app opens the workspace directly. Settings is only the setup
surface when this Mac still needs a runtime choice, a runtime fix, or optional
device permissions.

For a path comparison, see [Onboarding Overview](/start/onboarding-overview).

## Recommended Path

1. Finish account entry in the app.
2. If **Settings → General** shows that this Mac is still unconfigured or
   missing its runtime, choose where it should connect:
   - **Local** when this Mac should run Alisio itself
   - **Remote** when this Mac should attach to another host
3. Open the workspace as soon as the runtime is ready.
4. Review **Settings → Permissions** only for the macOS capabilities this Mac
   should expose.
5. Finish product-specific setup in the workspace:
   - **Apps** for connected app surfaces
   - **Capabilities** for skills and agent behavior
   - **Connections** for local infrastructure and linked systems

## Where Follow-up Setup Lives

| Task                      | Surface                             | Notes                                                       |
| ------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| Account entry             | App entry flow                      | Required before the first workspace open                    |
| Runtime location          | Settings → General                  | Only blocks when Local or Remote is still missing or broken |
| macOS permissions         | Settings → Permissions              | Optional until a feature on this Mac needs them             |
| Apps and connectors       | Workspace / Settings → Apps         | Configure product surfaces after sign-in                    |
| Skills and agent behavior | Workspace / Settings → Capabilities | Review bundled and installed capabilities                   |

## Product Notes

- The workspace is the main product surface after account entry.
- Runtime review on macOS lives in Settings, not in a standalone onboarding
  surface.
- Permissions are not the main gate. Turn them on when this Mac needs the
  corresponding feature.
- Use [Onboarding (CLI)](/start/wizard) when you need headless, remote, or
  operator-led setup.

## Related Pages

- [Getting Started](/start/getting-started)
- [Product Overview](/start/overview)
- [macOS App](/platforms/macos)
- [Local Models and Servers](/gateway/local-models)
