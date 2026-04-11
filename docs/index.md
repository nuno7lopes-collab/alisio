---
summary: "Alisio is a desktop-first AI workspace that starts on macOS and extends across channels, devices, and servers."
read_when:
  - Introducing Alisio to newcomers
title: "Alisio"
---

# Alisio

<p align="center">
  <img src="/assets/pixel-lobster.svg" alt="Alisio" width="160" />
</p>

<p align="center">
  <strong>Desktop-first AI for your own computer.</strong><br />
  Start on macOS, choose OpenAI, Local, or Server, then add channels, devices, and automations.
</p>

<Columns>
  <Card title="Product Overview" href="/start/overview" icon="layout-panel-top">
    What Alisio is, who it is for, and what the first sellable product looks like.
  </Card>
  <Card title="Getting Started" href="/start/getting-started" icon="rocket">
    Install the macOS app, sign in, grant permissions, and choose your AI source.
  </Card>
  <Card title="macOS App" href="/platforms/macos" icon="monitor-smartphone">
    The primary product shell for setup, permissions, devices, and daily use.
  </Card>
</Columns>

## What Is Alisio?

Alisio is a personal AI workspace that runs on your own computer and expands outward from there.

The desktop app is the center. Around it, you can add:

- OpenAI accounts and API keys
- local models on the machine you are using
- OpenAI-compatible servers on other machines
- channels such as WhatsApp, Telegram, Slack, Discord, and email
- connectors, apps, and skills from a local marketplace on each computer
- paired devices for camera, voice, screen, notifications, and automation

## Product Shape

```mermaid
flowchart LR
  A["Alisio on your Mac"] --> B["OpenAI"]
  A --> C["Local models"]
  A --> D["Servers"]
  A --> E["Channels"]
  A --> F["Connectors and apps"]
  A --> G["Paired devices"]
  F --> H["Automations"]
  E --> H
  G --> H
```

## Start Here

<Columns>
  <Card title="Overview" href="/start/overview" icon="book-open">
    Product positioning, use cases, and the minimum sellable product.
  </Card>
  <Card title="AI Sources" href="/concepts/model-providers" icon="cpu">
    OpenAI, local runtimes, and OpenAI-compatible servers.
  </Card>
  <Card title="Devices" href="/nodes" icon="smartphone">
    Device-local actions, permissions, and pairing.
  </Card>
  <Card title="Skills" href="/tools/skills" icon="sparkles">
    Skills, apps, and the local marketplace on each computer.
  </Card>
  <Card title="Memory" href="/concepts/memory" icon="brain">
    Durable context stored in your workspace.
  </Card>
  <Card title="Help" href="/help" icon="life-buoy">
    Troubleshooting, environment details, and advanced setup paths.
  </Card>
</Columns>
