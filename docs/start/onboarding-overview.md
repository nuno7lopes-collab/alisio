---
summary: "Choose between the macOS app, Windows app, and CLI depending on where account entry, workspace access, and runtime setup should happen."
read_when:
  - Choosing an onboarding path
  - Explaining setup options to a new user
title: "Onboarding Overview"
sidebarTitle: "Onboarding Overview"
---

# Onboarding Overview

Alisio has three entry paths:

- **macOS app**
- **Windows app**
- **CLI**

They share the same product model, but they are no longer the same story on
every platform.

## Which Path Should I Use?

|                       | macOS app                                              | Windows app                                                | CLI                                         |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------------------- | ------------------------------------------- |
| **Recommended**       | Yes, on a Mac                                          | Yes, on native Windows                                     | Only when needed                            |
| **Best for**          | Daily desktop use on macOS                             | Daily desktop use on Windows                               | Shared backend, servers, automation         |
| **What it optimizes** | Account entry, direct workspace access, runtime review | Account entry, direct workspace access, reconnect handling | Backend provisioning, scripting, operations |
| **Primary surface**   | App entry flow + workspace + Settings                  | App entry flow + workspace + Settings                      | Terminal                                    |
| **Command**           | Launch the app                                         | Launch the app                                             | `alisio onboard`                            |

If you are setting up a desktop product surface, start in the native app for
that platform. Use the CLI when you intentionally need operator-led or
headless runtime setup.

## What Each Path Still Decides

Regardless of path, Alisio still has to answer the same product questions:

1. Who is using this copy of Alisio?
2. Where should this device find its runtime?
3. Which AI source should run first: OpenAI, Local, or Server?
4. Which channels, connectors, and apps should connect to this machine?
5. Which devices should be paired into the same workspace?

## macOS App Setup

Use this when the Mac is the primary place where Alisio lives.

After account entry, the app handles:

- direct entry into the native workspace when account and runtime are ready
- runtime location and runtime fixes in Settings → General
- optional macOS permissions in Settings → Permissions
- connector, marketplace, and capability setup from the signed-in app

Reference: [macOS App Setup](/start/onboarding)

## Windows App Onboarding

Use this when Windows is the desktop product surface.

The app handles:

- account-required entry
- native workspace access when the signed-in app is ready
- reconnect and not-ready states inside the native app
- product settings through the canonical settings route

Reference: [Windows](/platforms/windows)

## CLI Onboarding

Use this when:

- you are setting up Linux or WSL2
- you are running a remote or headless shared backend
- you need a scripted or operator-led flow

Reference: [Onboarding (CLI)](/start/wizard)

## Runtime Placement

Every setup flow should make runtime placement obvious:

- **macOS app** chooses local vs remote runtime inside the app
- **Windows app** handles the native Windows path in-app
- **CLI** is for server-first or headless runtime setup
