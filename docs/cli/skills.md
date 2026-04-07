---
summary: "CLI reference for `alisio skills` (search/install/update/list/info/check)"
read_when:
  - You want to see which skills are available and ready to run
  - You want to search, install, or update skills from Local Marketplace
  - You want to debug missing binaries/env/config for skills
title: "skills"
---

# `alisio skills`

Inspect local skills and install/update skills from Local Marketplace.

Related:

- Skills system: [Skills](/tools/skills)
- Skills config: [Skills config](/tools/skills-config)
- Local Marketplace installs: [Local Marketplace](/tools/marketplace)

## Commands

```bash
alisio skills search "calendar"
alisio skills install <slug>
alisio skills install <slug> --version <version>
alisio skills update <slug>
alisio skills update --all
alisio skills list
alisio skills list --eligible
alisio skills info <name>
alisio skills check
```

`search`/`install`/`update` use Local Marketplace directly and install into the active
workspace `skills/` directory. `list`/`info`/`check` still inspect the local
skills visible to the current workspace and config.
