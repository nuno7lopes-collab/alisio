---
summary: "Install Alisio on macOS, sign in with your account, choose your AI source, and run the first workflow."
read_when:
  - First time setup from zero
  - You want the real desktop-first path
title: "Getting Started"
---

# Getting Started

The recommended path starts with the macOS app.

You install Alisio, sign in with your Alisio account, grant the permissions you want, choose how AI should run on that computer, and then connect the channels, apps, and other computers you care about.

## What You Need

- **A Mac** for the primary desktop experience
- **An Alisio account** because sign-in is required
- **An OpenAI account** or **API key**, if you want hosted AI on day one
- Optional: **a local model runtime** or **a private server** if you want Alisio to run outside OpenAI

## The Recommended Setup

<Steps>
  <Step title="Install the macOS app">
    Install **Alisio.app** and launch it.

    <Note>
    macOS is still the most complete desktop path, but Windows now has a native frontend for setup, settings, and chat. Use the install and CLI docs when you intentionally need backend, server, or operator setup outside the native apps.
    </Note>

  </Step>

  <Step title="Sign in">
    Sign in to your Alisio account from the app.

    This unlocks the desktop flow for:

    - account identity
    - OpenAI connection
    - connector setup
    - per-computer marketplace installs

  </Step>

  <Step title="Grant macOS permissions">
    Approve only the permissions you want Alisio to use on this Mac:

    - Notifications
    - Accessibility
    - Screen Recording
    - Microphone
    - Speech Recognition
    - Camera
    - Location
    - Automation, when you want AppleScript-style workflows

  </Step>

  <Step title="Choose your AI source">
    Pick the first AI source for this computer:

    - **OpenAI**: fastest path, with OAuth or API key
    - **Local**: run a local model on this Mac
    - **Server**: connect a shared OpenAI-compatible backend you control

    You can add more than one source later and choose fallbacks.

  </Step>

  <Step title="Connect channels, apps, and computers">
    Add the surfaces Alisio should use:

    - channels for inbound and outbound work
    - connectors and apps for automation
    - paired computers for camera, voice, screen, notifications, and local actions

  </Step>

  <Step title="Run the first workflow">
    Open chat in the app and test one real task:

    - ask a question with OpenAI
    - run a local workflow
    - connect a channel
    - install a skill from the local marketplace
    - create a simple automation tied to a connector or channel

  </Step>
</Steps>

## AI Choices In Plain Language

<Columns>
  <Card title="OpenAI" href="/concepts/model-providers" icon="sparkles">
    Best default when you want fast setup and strong hosted models.
  </Card>
  <Card title="Local models" href="/gateway/local-models" icon="cpu">
    Best when privacy, ownership, or low-latency local loops matter more.
  </Card>
  <Card title="Shared backend" href="/gateway/local-models" icon="server">
    Best when another machine should host the runtime for this workspace.
  </Card>
</Columns>

## What To Read Next

<Columns>
  <Card title="Product Overview" href="/start/overview" icon="layout-panel-top">
    Product framing, use cases, and the minimum sellable product.
  </Card>
  <Card title="macOS App" href="/platforms/macos" icon="monitor-smartphone">
    The main product surface for setup, permissions, and computer control.
  </Card>
  <Card title="Computers" href="/nodes" icon="monitor-smartphone">
    Pair computers and run local actions where they make sense.
  </Card>
  <Card title="Skills" href="/tools/skills" icon="sparkles">
    Install skills and apps from the local marketplace on each computer.
  </Card>
</Columns>

<Accordion title="Secondary backend and operator paths">
  If you are deliberately setting up Alisio outside the macOS product flow:

- Use [Onboarding Overview](/start/onboarding-overview) to choose the right setup path.
- Use [Onboarding (CLI)](/start/wizard) for terminal-led setup.
- Use [Install](/install) for shared backend, containers, servers, and hosted deployments.
- Use [Environment](/help/environment) for advanced paths such as `ALISIO_HOME`, `ALISIO_STATE_DIR`, and `ALISIO_CONFIG_PATH`.
  </Accordion>
