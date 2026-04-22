---
summary: "Setup surfaces for the Alisio macOS app after account entry."
read_when:
  - Documenting the macOS setup experience
  - Aligning setup copy with the current product flow
title: "macOS App Setup"
sidebarTitle: "macOS App Setup"
---

# macOS App Setup

The macOS app no longer treats a dedicated multi-step onboarding wizard as the
main entry story.

After account entry, setup for this Mac happens through the native app surface
and Settings.

For a path comparison, see [Onboarding Overview](/start/onboarding-overview).

## Recommended Path

1. Finish account entry in the app.
2. Open **Settings → General** and choose where the runtime lives:
   - **Local** when this Mac should run Alisio itself
   - **Remote** when this Mac should attach to another host
   - **Not configured** when you want to enter the workspace first and decide later
3. Open **Settings → Permissions** and enable only the macOS capabilities this
   Mac should expose.
4. Enter the workspace and finish product-specific setup there:
   - **Apps** for connected app surfaces
   - **Capabilities** for skills and agent behavior
   - **Connections** for local infrastructure and linked systems

## Where Setup Lives

| Task                      | Surface                             | Notes                                                                     |
| ------------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| Account entry             | App entry flow                      | Required before the workspace unlocks                                     |
| Runtime location          | Settings → General                  | Local runtime health, remote endpoint, and CLI install state              |
| macOS permissions         | Settings → Permissions              | Accessibility, Screen Recording, microphone, location, and related access |
| Apps and connectors       | Workspace / Settings → Apps         | Configure product surfaces after sign-in                                  |
| Skills and agent behavior | Workspace / Settings → Capabilities | Review bundled and installed capabilities                                 |

## Product Notes

- The workspace is the main product surface after account entry.
- Runtime setup on macOS is now a Settings concern, not a standalone wizard.
- Use [Onboarding (CLI)](/start/wizard) when you need headless, remote, or
  operator-led setup.

## Related Pages

- [Getting Started](/start/getting-started)
- [Product Overview](/start/overview)
- [macOS App](/platforms/macos)
- [Local Models and Servers](/gateway/local-models)
