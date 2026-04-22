---
summary: "Choose between the macOS app, the Windows app, and CLI onboarding depending on where the desktop product or runtime should live."
read_when:
  - Choosing an onboarding path
  - Explaining setup options to a new user
title: "Onboarding Overview"
sidebarTitle: "Onboarding Overview"
---

# Onboarding Overview

Alisio has three onboarding surfaces:

- **macOS app**
- **Windows app**
- **CLI**

They answer the same product questions, but they optimize for different environments.

## Which Path Should I Use?

|                       | macOS app onboarding       | Windows app onboarding                 | CLI onboarding                      |
| --------------------- | -------------------------- | -------------------------------------- | ----------------------------------- |
| **Recommended**       | Yes, on a Mac              | Yes, on native Windows                 | Only when needed                    |
| **Best for**          | Daily desktop use on macOS | Daily desktop use on Windows           | Shared backend, servers, automation |
| **What it optimizes** | Sign-in, permissions, AI   | Sign-in, settings, shared-backend chat | Control, scripting, operations      |
| **Primary surface**   | App UI                     | App UI                                 | Terminal                            |
| **Command**           | Launch the app             | Launch the app                         | `alisio onboard`                    |

If you are setting up a desktop product surface, start in the native app for that platform. Use the CLI when you intentionally need operator-led or headless setup.

## What Onboarding Configures

Regardless of path, setup should answer the same product questions:

1. Who is using this copy of Alisio?
2. Which backend and account state should this device trust?
3. Which AI source should run first: OpenAI, Local, or Server?
4. Which channels, connectors, and apps should connect to this machine?
5. Which devices should be paired into the same workspace?

## macOS App Onboarding

Use this when the Mac is the primary place where Alisio lives.

The app handles:

- sign-in
- macOS permissions
- OpenAI connection
- local model or server selection
- device-aware setup for this computer
- connector and marketplace flows

Reference: [Onboarding (macOS App)](/start/onboarding)

## Windows App Onboarding

Use this when Windows is the desktop product surface.

The app handles:

- account-required setup
- honest signed-out gating
- shared-backend auth/bootstrap state
- product settings through the canonical settings route
- chat only after the bootstrap is ready

Reference: [Windows](/platforms/windows)

## CLI Onboarding

Use this when:

- you are setting up Linux or WSL2
- you are running a remote or headless shared backend
- you need a scripted or operator-led flow

Reference: [Onboarding (CLI)](/start/wizard)

## AI Source Selection

Every onboarding flow should make these three choices obvious:

- **OpenAI** for fast hosted setup
- **Local** for models on the current machine
- **Server** for OpenAI-compatible endpoints on another machine

Deeper details: [Model Providers](/concepts/model-providers)
