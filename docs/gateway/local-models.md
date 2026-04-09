---
summary: "Run Alisio with local models on this machine or with private Ollama, LM Studio, and OpenAI-compatible servers."
read_when:
  - Choosing between OpenAI, local models, and private servers
  - Setting up Ollama, LM Studio, or OpenAI-compatible endpoints for Alisio
title: "Local Models and Servers"
---

# Local Models and Servers

Alisio treats local and server-backed AI as first-class product choices.

That means you do not have to pick between “hosted only” and “expert mode.” You can start with OpenAI, then add local or private servers as the product grows with your setup.

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

- Ollama on another machine
- an OpenAI-compatible endpoint
- a shared private runtime for multiple computers

## Server Types

Alisio should clearly support:

- **Ollama**
- **OpenAI-compatible servers**

Those are the practical server categories most operators expect. LM Studio also appears as a separate runtime when Alisio can see its local server directly.

## Recommended Setup Order

1. Get a working setup with OpenAI
2. Add a local model on the current computer if you need it
3. Add an Ollama, LM Studio, or OpenAI-compatible server if another machine should host inference

## Practical Guidance

- The **Local** view is per computer. It should show only the models that are installed on the current machine and the recommendations that make sense for that machine's hardware.
- The **Server** view is also per machine. It lists only the models exposed by the server you added, not a merged global catalog.
- Local models are great for privacy and control, but quality still depends on hardware and the model you can actually run.
- Server-backed models are a good middle ground when the current Mac should stay lightweight.
- Hosted and local/server setups should coexist so you can use fallbacks instead of committing to one path forever.

## Runtime Discovery

- **Ollama on this computer**: Alisio probes the local Ollama API on `127.0.0.1:11434`, discovers installed models, and can request install, update, or uninstall actions with explicit user consent.
- **LM Studio on this computer**: Alisio probes the LM Studio local server on `127.0.0.1:1234`. If the server is not running yet, Alisio can offer a start action when the LM Studio CLI (`lms`) is available on that device. Model downloads and model loading still stay in LM Studio itself.
- **Linked devices**: when a connected node exposes separate Ollama, LM Studio, or generic OpenAI-compatible runtimes, Alisio shows them as separate linked runtime targets instead of collapsing them into one generic server.
- **Private servers on another machine**: add Ollama or any OpenAI-compatible endpoint in the **Server** tab when inference should run elsewhere.

## Important Limits

- Nothing syncs automatically between machines just because two devices appear in Alisio. A linked runtime is still a runtime on that specific machine.
- LM Studio server start only turns on the local LM Studio API. It does not auto-download models and it does not auto-load a model for you.
- `llama.cpp` runtime management still depends on native `node-llama-cpp` support for your platform and hardware. GGUF installs are only usable when that native runtime can build and run correctly on the target machine.

## Example Policy

A realistic product policy for one computer:

- OpenAI as the default
- a local model for private or low-latency work
- an Ollama or OpenAI-compatible server as an additional runtime when another machine is available

## Related Pages

- [Model Providers](/concepts/model-providers)
- [Models](/concepts/models)
- [Getting Started](/start/getting-started)
