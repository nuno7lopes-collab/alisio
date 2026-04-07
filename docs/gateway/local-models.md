---
summary: "Run Alisio with local models on this machine or with private Ollama and OpenAI-compatible servers."
read_when:
  - Choosing between OpenAI, local models, and private servers
  - Setting up Ollama or OpenAI-compatible endpoints for Alisio
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

Those are the practical server categories most operators expect.

## Recommended Setup Order

1. Get a working setup with OpenAI
2. Add a local model on the current computer if you need it
3. Add an Ollama or OpenAI-compatible server if another machine should host inference

## Practical Guidance

- Local models are great for privacy and control, but quality still depends on hardware and the model you can actually run.
- Server-backed models are a good middle ground when the current Mac should stay lightweight.
- Hosted and local/server setups should coexist so you can use fallbacks instead of committing to one path forever.

## Example Policy

A realistic product policy for one computer:

- OpenAI as the default
- a local model for private or low-latency work
- an Ollama or OpenAI-compatible server as an additional runtime when another machine is available

## Related Pages

- [Model Providers](/concepts/model-providers)
- [Models](/concepts/models)
- [Getting Started](/start/getting-started)
