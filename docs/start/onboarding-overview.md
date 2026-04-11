---
summary: "Choose between the desktop-first macOS flow and the secondary CLI/on-server setup paths."
read_when:
  - Choosing an onboarding path
  - Explaining setup options to a new user
title: "Onboarding Overview"
sidebarTitle: "Onboarding Overview"
---

# Onboarding Overview

Alisio has two setup paths, but they are not equal.

The primary path is the macOS app. The CLI path still exists for operators, servers, and non-macOS environments.

## Which Path Should I Use?

|                       | macOS app onboarding           | CLI onboarding                 |
| --------------------- | ------------------------------ | ------------------------------ |
| **Recommended**       | Yes                            | Only when needed               |
| **Best for**          | Daily desktop use on a Mac     | Servers, headless, automation  |
| **What it optimizes** | Sign-in, permissions, AI setup | Control, scripting, operations |
| **Primary surface**   | App UI                         | Terminal                       |
| **Command**           | Launch the app                 | `alisio onboard`               |

Most people should start with **macOS app onboarding**.

## What Onboarding Configures

Regardless of path, setup should answer the same product questions:

1. Who is using this copy of Alisio?
2. Which permissions does this computer expose?
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

## CLI Onboarding

Use this when:

- you are setting up Linux or Windows
- you are running a remote or headless gateway
- you need a scripted or operator-led flow

Reference: [Onboarding (CLI)](/start/wizard)

## AI Source Selection

Every onboarding flow should make these three choices obvious:

- **OpenAI** for fast hosted setup
- **Local** for models on the current machine
- **Server** for OpenAI-compatible endpoints on another machine

Deeper details: [Model Providers](/concepts/model-providers)
