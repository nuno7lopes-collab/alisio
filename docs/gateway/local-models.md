---
summary: "Run Alisio with local models on this machine or with private OpenAI-compatible servers."
read_when:
  - Choosing between OpenAI, local models, and private servers
  - Setting up local models or OpenAI-compatible endpoints for Alisio
title: "Local Models and Servers"
---

# Local Models and Servers

Alisio treats local and server-backed AI as first-class product choices.

That means you do not have to pick between "hosted only" and "expert mode." You can start with OpenAI, then add local or private servers as the product grows with your setup.

## The Three Runtime Shapes

### OpenAI

Hosted, easiest to start, best default for quality and setup speed.

### Local

The runtime lives on the same computer as Alisio.

Best when you want:

- privacy
- local control
- low-latency loops on capable hardware

### Server

The runtime lives elsewhere and Alisio connects to it.

Best when you want:

- an OpenAI-compatible endpoint on another machine
- a shared private runtime for multiple computers
- to keep the current Mac lightweight

## Server Types

Alisio should clearly support:

- **OpenAI-compatible servers**
- **Linked private runtimes**

Those cover the practical server shapes operators expect without baking product behavior around one vendor-specific runtime.

## Recommended Setup Order

1. Get a working setup with OpenAI
2. Add a local model on the current computer if you need it
3. Add an OpenAI-compatible server if another machine should host inference

## Practical Guidance

- The **Local** view is per computer. It should show only the models that are available on the current machine and the recommendations that make sense for that machine's hardware.
- The **Server** view is also per machine. It lists only the models exposed by the server you added, not a merged global catalog.
- Local models are great for privacy and control, but quality still depends on hardware and the model you can actually run.
- Server-backed models are a good middle ground when the current Mac should stay lightweight.
- Hosted and local/server setups should coexist so you can use fallbacks instead of committing to one path forever.

## Runtime Discovery

- **Local on this computer**: Alisio discovers the models available on the current machine and keeps the Local view scoped to that device.
- **Linked devices**: when a connected node exposes an OpenAI-compatible runtime, Alisio shows it as a separate linked target instead of folding everything into one generic server catalog.
- **Private servers on another machine**: add any OpenAI-compatible endpoint in the **Server** tab when inference should run elsewhere.

## Important Limits

- Nothing syncs automatically between machines just because two devices appear in Alisio. A linked runtime is still a runtime on that specific machine.
- Local model availability is device-specific. A model that exists on one machine does not appear on another until that machine exposes it.
- `llama.cpp` runtime management still depends on native `node-llama-cpp` support for your platform and hardware. GGUF installs are only usable when that native runtime can build and run correctly on the target machine.

## Example Policy

A realistic product policy for one computer:

- OpenAI as the default
- a local model for private or low-latency work
- an OpenAI-compatible server as an additional runtime when another machine is available

## Related Pages

- [Model Providers](/concepts/model-providers)
- [Models](/concepts/models)
- [Getting Started](/start/getting-started)
