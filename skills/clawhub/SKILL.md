---
name: clawhub
description: Use the Alisio Marketplace CLI to search, install, update, and publish agent skills from clawhub.com. Use when you need to fetch new skills on the fly, sync installed skills to latest or a specific version, or publish new/updated skill folders with the npm-installed clawhub CLI.
manifest:
  {
    "schemaVersion": 1,
    "name": "clawhub",
    "version": "1.0.0",
    "description": "Use the Alisio Marketplace CLI to search, install, update, and publish skills from clawhub.com.",
    "install":
      [
        {
          "id": "node",
          "kind": "node",
          "package": "clawhub",
          "bins": ["clawhub"],
          "label": "Install Alisio Marketplace CLI (npm)",
        },
      ],
    "permissions":
      {
        "consent": "explicit",
        "sandbox": { "mode": "isolated", "filesystem": "workspace-write", "network": "off" },
        "exec": { "bins": ["clawhub"] },
        "files": { "write": ["skills/**"] },
        "network": { "outbound": true, "hosts": ["clawhub.com", "api.clawhub.com"] },
      },
    "outputs": { "primary": "instructions", "formats": ["text/markdown", "text/plain"] },
    "compat": { "runtimes": ["node"], "requires": { "bins": ["clawhub"] } },
    "subscription": { "required": false, "plan": "free" },
  }
---

# Alisio Marketplace CLI

Install

```bash
npm i -g clawhub
```

Auth (publish)

```bash
clawhub login
clawhub whoami
```

Search

```bash
clawhub search "postgres backups"
```

Install

```bash
clawhub install my-skill
clawhub install my-skill --version 1.2.3
```

Update (hash-based match + upgrade)

```bash
clawhub update my-skill
clawhub update my-skill --version 1.2.3
clawhub update --all
clawhub update my-skill --force
clawhub update --all --no-input --force
```

List

```bash
clawhub list
```

Publish

```bash
clawhub publish ./my-skill --slug my-skill --name "My Skill" --version 1.2.0 --changelog "Fixes + docs"
```

Notes

- Default registry: https://clawhub.com (override with CLAWHUB_REGISTRY or --registry)
- Default workdir: cwd (falls back to Alisio workspace); install dir: ./skills (override with --workdir / --dir / CLAWHUB_WORKDIR)
- Update command hashes local files, resolves matching version, and upgrades to latest unless --version is set
