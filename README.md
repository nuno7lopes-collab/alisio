# Alisio

Alisio is a desktop-first AI workspace for your own computer.

The product starts on macOS, not in a terminal. You install the app, sign in, grant macOS permissions, choose how AI should run on that machine, and then connect channels, apps, devices, and automations around it.

Alisio can run with:

- OpenAI via OAuth or API key
- local models on your Mac
- OpenAI-compatible servers you control

It can then:

- connect channels such as WhatsApp, Telegram, Slack, Discord, and email
- expose device-local capabilities such as camera, microphone, notifications, screen capture, and automation
- install skills and app integrations from a local marketplace on each computer
- automate work through connectors, channels, schedules, and device actions

[Install Alisio](https://docs.alisio.ai/start/getting-started) · [Product Overview](https://docs.alisio.ai/start/overview) · [macOS App](https://docs.alisio.ai/platforms/macos) · [Local Models and Servers](https://docs.alisio.ai/gateway/local-models) · [Devices](https://docs.alisio.ai/nodes) · [Skills](https://docs.alisio.ai/tools/skills) · [Memory](https://docs.alisio.ai/concepts/memory) · [Vision](https://github.com/alisio/alisio/blob/main/VISION.md)

## Install Alisio

Recommended path:

1. Install the macOS app.
2. Sign in.
3. Grant macOS permissions.
4. Choose AI: OpenAI, Local, or Server.
5. Connect channels, apps, and devices.
6. Start your first automation.

For Linux, Windows, headless gateway, and operator workflows, use the install and gateway docs.

## What Alisio Is

Alisio is not just a gateway and not just a chat bot.

It is a personal operating layer for AI on your computer:

- the Mac app is the primary shell
- AI can be remote, local, or server-backed
- each computer has its own local marketplace and device capabilities
- channels and connectors bring work into Alisio
- automations push work back out through the same surfaces

## Core Product Shape

- **Desktop-first**: the main experience starts in the macOS app.
- **OpenAI plus local**: strong hosted models and private local/runtime models can coexist.
- **Per-computer marketplace**: skills, apps, and integrations are installed where they run.
- **Device-aware automation**: actions can target the current Mac or another paired device.
- **Channel-native workflows**: channels are not an afterthought; they are input and output surfaces for work.

## Documentation Map

- Product framing: [https://docs.alisio.ai/start/overview](https://docs.alisio.ai/start/overview)
- First-run flow: [https://docs.alisio.ai/start/getting-started](https://docs.alisio.ai/start/getting-started)
- macOS-first onboarding: [https://docs.alisio.ai/start/onboarding](https://docs.alisio.ai/start/onboarding)
- AI sources and model selection: [https://docs.alisio.ai/concepts/model-providers](https://docs.alisio.ai/concepts/model-providers)
- Local models and servers: [https://docs.alisio.ai/gateway/local-models](https://docs.alisio.ai/gateway/local-models)
- Devices and device-local actions: [https://docs.alisio.ai/nodes](https://docs.alisio.ai/nodes)
- Skills and local marketplace: [https://docs.alisio.ai/tools/skills](https://docs.alisio.ai/tools/skills)
- Memory and durable context: [https://docs.alisio.ai/concepts/memory](https://docs.alisio.ai/concepts/memory)

## Advanced And Ops

If you are running Alisio without the macOS app, or you are operating remote gateways, containers, or headless hosts, start from:

- [https://docs.alisio.ai/install](https://docs.alisio.ai/install)
- [https://docs.alisio.ai/start/wizard](https://docs.alisio.ai/start/wizard)
- [https://docs.alisio.ai/gateway](https://docs.alisio.ai/gateway)

## License

MIT. See `LICENSE`.
