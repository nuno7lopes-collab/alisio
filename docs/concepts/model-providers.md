---
summary: "How Alisio chooses between OpenAI, local models, and operator-managed servers."
read_when:
  - Explaining AI source selection in the product
  - Comparing hosted, local, and server-backed model paths
title: "Model Providers"
---

# Model Providers

In Alisio, model selection should feel like choosing an **AI source**, not memorizing internal provider plumbing.

The product has three first-class paths:

## 1. OpenAI

Best when you want:

- the fastest setup
- strong hosted models
- OAuth or API-key-based access

This is the best default for most new users.

## 2. Local

Best when you want:

- more privacy
- lower-latency loops on your own hardware
- per-computer model ownership

This means the model runtime lives on the same computer as Alisio.

## 3. Server

Best when you want:

- Ollama on another machine
- OpenAI-compatible endpoints you control
- one shared runtime serving multiple computers

This means Alisio connects to a model server instead of running the model directly on the current computer.

## What The Picker Should Communicate

The user should understand four things immediately:

1. Where the model runs
2. Which credentials are required
3. Whether the source is local to this computer or shared remotely
4. Whether OpenAI, Local, and Server can coexist

They can. One computer can use all three.

## Recommended Product Order

Start here:

1. OpenAI for the first working setup
2. add Local when privacy or ownership matters
3. add Server when a separate machine should host the runtime

## Common Examples

- **OpenAI**: sign in or paste an API key
- **Local**: run a model directly on your Mac
- **Server**: connect to an Ollama or OpenAI-compatible endpoint on another machine

## Advanced Surfaces

The CLI and config still expose deeper controls such as:

- model allowlists
- fallbacks
- aliases
- per-agent overrides

Those matter for operators, but they should not define the top-level product story.

## Related Pages

- [Models](/concepts/models)
- [Local Models and Servers](/gateway/local-models)
- [Getting Started](/start/getting-started)
