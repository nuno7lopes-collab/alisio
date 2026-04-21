---
summary: "First-run setup flow for the Alisio macOS app."
read_when:
  - Documenting the macOS onboarding experience
  - Aligning setup copy with the product flow
title: "Onboarding (macOS App)"
sidebarTitle: "Onboarding: macOS App"
---

# Onboarding (macOS App)

This page describes the desktop-first setup flow.

The job of onboarding is simple: make one Mac ready to run Alisio with the right account, permissions, AI source, channels, connectors, and device capabilities.

For a path comparison, see [Onboarding Overview](/start/onboarding-overview).

<Steps>
  <Step title="Welcome">
    On first launch, the app explains what Alisio is going to configure on this Mac:

    - your account
    - the AI source for this computer
    - permissions and device capabilities
    - channels, apps, and connectors

  </Step>

  <Step title="Choose where this workspace lives">
    Decide whether this Mac is the primary local workspace or whether it should connect to a remote workspace that already exists elsewhere.

    Local is the normal desktop path.

  </Step>

  <Step title="Sign in">
    Sign in so the app can unlock account-level features such as:

    - OpenAI connection
    - connector setup
    - local marketplace installs
    - device identity for this computer

  </Step>

  <Step title="Grant macOS permissions">
    <Frame caption="Permissions are the product boundary on macOS.">
      <img src="/assets/macos-onboarding/05-permissions.png" alt="Alisio macOS permissions step" />
    </Frame>

    The app can request:

    - Notifications
    - Accessibility
    - Screen Recording
    - Microphone
    - Speech Recognition
    - Camera
    - Location
    - Automation

  </Step>

  <Step title="Pick the AI source for this Mac">
    Choose the first runtime:

    - **OpenAI** through OAuth or API key
    - **Local** for models on this machine
    - **Server** for OpenAI-compatible endpoints

    These can coexist later. The first choice just gets the machine into a working state quickly.

  </Step>

  <Step title="Connect apps, channels, and computers">
    Add the surfaces that matter for this computer:

    - channels for inbound and outbound work
    - connectors and apps for automation
    - paired computers that extend capture, voice, and local actions

  </Step>

  <Step title="Finish in a ready state">
    The setup is done when this Mac can:

    - chat
    - run the chosen AI source
    - expose the approved computer permissions
    - install at least one skill or integration
    - create or receive one real workflow

  </Step>
</Steps>

## Product Notes

- The macOS app is the primary product shell.
- The CLI remains available for operator, server, and non-macOS workflows.
- Permissions should stay explicit and reversible.
- OpenAI, Local, and Server are all first-class options in the product story.

## Related Pages

- [Getting Started](/start/getting-started)
- [Product Overview](/start/overview)
- [macOS App](/platforms/macos)
- [Local Models and Servers](/gateway/local-models)
