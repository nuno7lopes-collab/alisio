---
summary: "Choose between macOS app setup, Windows app onboarding, and CLI onboarding depending on where the product surface or runtime should live."
read_when:
  - Choosing an onboarding path
  - Explaining setup options to a new user
title: "Onboarding Overview"
sidebarTitle: "Onboarding Overview"
---

# Onboarding Overview

Alisio has three setup entry points:

- **macOS app setup**
- **Windows app**
- **CLI**

They are related, but they are no longer the same story on every platform.

## Which Path Should I Use?

|                       | macOS app setup                   | Windows app onboarding                 | CLI onboarding                      |
| --------------------- | --------------------------------- | -------------------------------------- | ----------------------------------- |
| **Recommended**       | Yes, on a Mac                     | Yes, on native Windows                 | Only when needed                    |
| **Best for**          | Daily desktop use on macOS        | Daily desktop use on Windows           | Shared backend, servers, automation |
| **What it optimizes** | Account entry, permissions, setup | Sign-in, settings, shared-backend chat | Control, scripting, operations      |
| **Primary surface**   | App entry flow + Settings         | App UI                                 | Terminal                            |
| **Command**           | Launch the app                    | Launch the app                         | `alisio onboard`                    |

If you are setting up a desktop product surface, start in the native app for that platform. Use the CLI when you intentionally need operator-led or headless setup.

## What Onboarding Configures

Regardless of path, setup should answer the same product questions:

1. Who is using this copy of Alisio?
2. Which backend and account state should this device trust?
3. Which AI source should run first: OpenAI, Local, or Server?
4. Which channels, connectors, and apps should connect to this machine?
5. Which devices should be paired into the same workspace?

## macOS App Setup

Use this when the Mac is the primary place where Alisio lives.

After account entry, the app handles:

- runtime location in Settings → General
- macOS permissions in Settings → Permissions
- entry into the native workspace
- connector, marketplace, and capability setup from the signed-in app

Reference: [macOS App Setup](/start/onboarding)

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

## Runtime Placement

Every setup flow should make runtime placement obvious:

- **macOS app setup** chooses local vs remote runtime inside the app
- **Windows app onboarding** handles the native Windows path
- **CLI onboarding** is for server-first or headless runtime setup
