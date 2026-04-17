---
summary: "Alisio Docker helpers for Docker-based installs"
read_when:
  - You run Alisio with Docker often and want shorter day-to-day commands
  - You want a helper layer for dashboard, logs, token setup, and pairing flows
title: "Alisio Docker Helpers"
---

# Alisio Docker Helpers

Alisio Docker Helpers is a small shell-helper layer for Docker-based Alisio installs.

It gives you short commands like `alisio-docker-start`, `alisio-docker-dashboard`, and `alisio-docker-fix-token` instead of longer `docker compose ...` invocations.

If you have not set up Docker yet, start with [Docker](/install/docker).

## Install

Use the canonical helper path:

```bash
mkdir -p ~/.alisio-docker && curl -sL https://raw.githubusercontent.com/alisio/alisio/main/scripts/alisio-docker/helpers.sh -o ~/.alisio-docker/helpers.sh
echo 'source ~/.alisio-docker/helpers.sh' >> ~/.zshrc && source ~/.zshrc
```

If you previously installed an older helper script, reinstall from `scripts/alisio-docker/helpers.sh` so your local shell tracks the current path.

## What you get

### Basic operations

| Command                 | Description            |
| ----------------------- | ---------------------- |
| `alisio-docker-start`   | Start the gateway      |
| `alisio-docker-stop`    | Stop the gateway       |
| `alisio-docker-restart` | Restart the gateway    |
| `alisio-docker-status`  | Check container status |
| `alisio-docker-logs`    | Follow gateway logs    |

### Container access

| Command                        | Description                                   |
| ------------------------------ | --------------------------------------------- |
| `alisio-docker-shell`          | Open a shell inside the gateway container     |
| `alisio-docker-cli <command>`  | Run Alisio CLI commands in Docker             |
| `alisio-docker-exec <command>` | Execute an arbitrary command in the container |

### Web UI and pairing

| Command                      | Description                  |
| ---------------------------- | ---------------------------- |
| `alisio-docker-dashboard`    | Open the Control UI URL      |
| `alisio-docker-devices`      | List pending device pairings |
| `alisio-docker-approve <id>` | Approve a pairing request    |

### Setup and maintenance

| Command                   | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `alisio-docker-fix-token` | Configure the gateway token inside the container |
| `alisio-docker-update`    | Pull, rebuild, and restart                       |
| `alisio-docker-rebuild`   | Rebuild the Docker image only                    |
| `alisio-docker-clean`     | Remove containers and volumes                    |

### Utilities

| Command                     | Description                             |
| --------------------------- | --------------------------------------- |
| `alisio-docker-health`      | Run a gateway health check              |
| `alisio-docker-token`       | Print the gateway token                 |
| `alisio-docker-cd`          | Jump to the Alisio project directory    |
| `alisio-docker-config`      | Open `~/.alisio`                        |
| `alisio-docker-show-config` | Print config files with redacted values |
| `alisio-docker-workspace`   | Open the workspace directory            |

## First-time flow

```bash
alisio-docker-start
alisio-docker-fix-token
alisio-docker-dashboard
```

If the browser says pairing is required:

```bash
alisio-docker-devices
alisio-docker-approve <request-id>
```

## Config and secrets

The helpers use the same Docker config split described in [Docker](/install/docker):

- `<project>/.env` for Docker-specific values like image name, ports, and the gateway token
- `~/.alisio/.env` for provider keys and bot tokens
- `~/.alisio/alisio.json` for behavior config

Use `alisio-docker-show-config` when you want to inspect those files quickly. It redacts `.env` values in its printed output.

## Related pages

- [Docker](/install/docker)
- [Docker VM Runtime](/install/docker-vm-runtime)
- [Updating](/install/updating)
