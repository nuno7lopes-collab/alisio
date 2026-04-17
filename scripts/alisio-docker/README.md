# Alisio Docker Helpers <!-- omit in toc -->

Stop typing long `docker compose` commands. Just type `alisio-docker-start`.

Inspired by Simon Willison's [Running Alisio in Docker](https://til.simonwillison.net/llms/alisio-docker).

- [Quickstart](#quickstart)
- [Available commands](#available-commands)
- [Configuration and secrets](#configuration-and-secrets)
- [Common workflows](#common-workflows)
- [Requirements](#requirements)

## Quickstart

**Install:**

```bash
mkdir -p ~/.alisio-docker && curl -sL https://raw.githubusercontent.com/alisio/alisio/main/scripts/alisio-docker/helpers.sh -o ~/.alisio-docker/helpers.sh
echo 'source ~/.alisio-docker/helpers.sh' >> ~/.zshrc && source ~/.zshrc
```

Canonical docs page: https://docs.alisio.ai/install/alisio-docker

**See what you get:**

```bash
alisio-docker-help
```

On first command, the helpers auto-detect your Alisio directory:

- Checks common paths (`~/alisio`, `~/workspace/alisio`, etc.)
- If found, asks you to confirm
- Saves to `~/.alisio-docker/config`

**First-time setup:**

```bash
alisio-docker-start
alisio-docker-fix-token
alisio-docker-dashboard
```

If you see "pairing required":

```bash
alisio-docker-devices
alisio-docker-approve <request-id>
```

## Available commands

| Command                     | Description                               |
| --------------------------- | ----------------------------------------- |
| `alisio-docker-start`       | Start the gateway                         |
| `alisio-docker-stop`        | Stop the gateway                          |
| `alisio-docker-restart`     | Restart the gateway                       |
| `alisio-docker-status`      | Check container status                    |
| `alisio-docker-logs`        | View live logs                            |
| `alisio-docker-shell`       | Interactive shell inside the container    |
| `alisio-docker-cli <cmd>`   | Run Alisio CLI commands                   |
| `alisio-docker-exec <cmd>`  | Execute arbitrary commands in the container |
| `alisio-docker-dashboard`   | Open the web UI with authentication       |
| `alisio-docker-devices`     | List device pairing requests              |
| `alisio-docker-approve <id>`| Approve a pairing request                 |
| `alisio-docker-fix-token`   | Configure the gateway token               |
| `alisio-docker-update`      | Pull latest, rebuild, and restart         |
| `alisio-docker-rebuild`     | Rebuild the Docker image only             |
| `alisio-docker-clean`       | Remove containers and volumes             |
| `alisio-docker-health`      | Run a gateway health check                |
| `alisio-docker-token`       | Show the gateway token                    |
| `alisio-docker-cd`          | Jump to the project directory             |
| `alisio-docker-config`      | Open the Alisio config directory          |
| `alisio-docker-show-config` | Print config files with redacted values   |
| `alisio-docker-workspace`   | Open the workspace directory              |
| `alisio-docker-help`        | Show all commands with examples           |

## Configuration and secrets

The Docker setup uses host-mounted files:

- `<project>/.env` for Docker infra values such as image, ports, and gateway token
- `~/.alisio/.env` for provider keys and bot tokens
- `~/.alisio/alisio.json` for behavior config

The helpers never store secrets inside the container. They just operate on the bind-mounted host files.

## Common workflows

**Update Alisio:**

```bash
alisio-docker-update
```

**Restart the gateway:**

```bash
alisio-docker-restart
```

**View logs:**

```bash
alisio-docker-logs
```

**Reset helper auto-detection:**

```bash
unset ALISIO_DOCKER_DIR && rm -f ~/.alisio-docker/config && source scripts/alisio-docker/helpers.sh
```

## Requirements

- Docker and Docker Compose installed
- Bash or Zsh shell
- Alisio project checked out locally
