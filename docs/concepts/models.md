---
summary: "How Alisio picks a primary model, adds fallbacks, and presents AI choices in the product."
read_when:
  - Explaining the model picker
  - Documenting primary/fallback behavior
title: "Models"
---

# Models

Alisio should make model selection feel simple:

- pick the main AI source for this computer
- set a primary model
- add fallbacks only when you need them

## Primary And Fallbacks

The product model is:

1. **Primary** model
2. optional **fallback** models
3. provider-specific auth refresh or retry inside the chosen source

That lets one machine start with OpenAI, then fall back to a local or server-backed model when needed.

## What A Good Default Looks Like

- strongest practical primary model
- at least one fallback when uptime matters
- local or server fallback when cost, privacy, or resilience matters

## Product Framing

Most users should first choose:

- **OpenAI**
- **Local**
- **Server**

Then, only if needed, configure:

- aliases
- per-agent overrides
- image models
- generation-specific models

## Advanced Operator Surfaces

Advanced users can still manage models through:

- the CLI
- config
- provider-specific setup

Examples:

```bash
alisio models list
alisio models status
alisio models set <provider/model>
```

## Related Pages

- [Model Providers](/concepts/model-providers)
- [Local Models and Servers](/gateway/local-models)
- [Getting Started](/start/getting-started)
