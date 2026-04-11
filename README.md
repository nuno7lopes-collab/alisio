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

[Install Alisio](docs/start/getting-started.md) · [Product Overview](docs/start/overview.md) · [macOS App](docs/platforms/macos.md) · [Local Models and Servers](docs/gateway/local-models.md) · [Devices](docs/nodes/index.md) · [Skills](docs/tools/skills.md) · [Memory](docs/concepts/memory.md) · [Vision](VISION.md)

## Install Alisio

Recommended path:

1. Install the macOS app.
2. Sign in.
3. Grant macOS permissions.
4. Choose AI: OpenAI, Local, or Server.
5. Connect channels, apps, and devices.
6. Start your first automation.

CLI and hosted-gateway flows still exist for Linux, Windows, and advanced operations, but they are not the primary product path anymore.

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

## Screenshot Placeholders

- `[Placeholder]` macOS home and setup flow
- `[Placeholder]` AI source picker with OpenAI, Server, and Local
- `[Placeholder]` local marketplace for skills, connectors, and apps
- `[Placeholder]` automations tied to channels and connectors

## Documentation Map

- Product framing: `docs/start/overview.md`
- First-run flow: `docs/start/getting-started.md`
- macOS-first onboarding: `docs/start/onboarding.md`
- AI sources and model selection: `docs/concepts/model-providers.md`
- Local models and servers: `docs/gateway/local-models.md`
- Devices and device-local actions: `docs/nodes/index.md`
- Skills and local marketplace: `docs/tools/skills.md`
- Memory and durable context: `docs/concepts/memory.md`

## Advanced And Ops

If you are running Alisio without the macOS app, or you are operating remote gateways, containers, or headless hosts, start from:

- `docs/install/index.md`
- `docs/start/wizard.md`
- `docs/gateway/index.md`

## License

MIT. See `LICENSE`.
