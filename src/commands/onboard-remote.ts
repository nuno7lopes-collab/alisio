import type { AlisioConfig } from "../config/config.js";
import { DEFAULT_GATEWAY_PORT, resolveGatewayPort } from "../config/paths.js";
import type { SecretInput } from "../config/types.secrets.js";
import { isSecureWebSocketUrl } from "../gateway/net.js";
import { discoverGatewayBeacons, type GatewayBonjourBeacon } from "../infra/bonjour-discovery.js";
import {
  buildGatewayDiscoveryLabel,
  buildGatewayDiscoveryTarget,
} from "../infra/gateway-discovery-targets.js";
import { resolveWideAreaDiscoveryDomain } from "../infra/widearea-dns.js";
import { resolveSecretInputModeForEnvSelection } from "../plugins/provider-auth-mode.js";
import { promptSecretRefForSetup } from "../plugins/provider-auth-ref.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { detectBinary } from "./onboard-helpers.js";
import type { SecretInputMode } from "./onboard-types.js";

function buildLabel(beacon: GatewayBonjourBeacon): string {
  return buildGatewayDiscoveryLabel(beacon);
}

function buildDefaultGatewayUrl(cfg?: AlisioConfig): string {
  return `ws://127.0.0.1:${resolveGatewayPort(cfg, process.env)}`;
}

function ensureWsUrl(value: string, cfg?: AlisioConfig): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return buildDefaultGatewayUrl(cfg);
  }
  return trimmed;
}

function validateGatewayWebSocketUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
    return "URL must start with ws:// or wss://";
  }
  if (
    !isSecureWebSocketUrl(trimmed, {
      allowPrivateWs: process.env.ALISIO_ALLOW_INSECURE_PRIVATE_WS === "1",
    })
  ) {
    return (
      "Use wss:// for remote hosts, or ws://127.0.0.1/localhost via SSH tunnel. " +
      "Break-glass: ALISIO_ALLOW_INSECURE_PRIVATE_WS=1 for trusted private networks."
    );
  }
  return undefined;
}

export async function promptRemoteGatewayConfig(
  cfg: AlisioConfig,
  prompter: WizardPrompter,
  options?: { secretInputMode?: SecretInputMode },
): Promise<AlisioConfig> {
  let selectedBeacon: GatewayBonjourBeacon | null = null;
  let suggestedUrl = cfg.gateway?.remote?.url ?? buildDefaultGatewayUrl(cfg);
  let discoveryTlsFingerprint: string | undefined;
  let trustedDiscoveryUrl: string | undefined;

  const hasBonjourTool = (await detectBinary("dns-sd")) || (await detectBinary("avahi-browse"));
  const wantsDiscover = hasBonjourTool
    ? await prompter.confirm({
        message: "Discover gateway on LAN (Bonjour)?",
        initialValue: true,
      })
    : false;

  if (!hasBonjourTool) {
    await prompter.note(
      [
        "Bonjour discovery requires dns-sd (macOS) or avahi-browse (Linux).",
        "Docs: https://docs.alisio.pt/gateway/discovery",
      ].join("\n"),
      "Discovery",
    );
  }

  if (wantsDiscover) {
    const wideAreaDomain = resolveWideAreaDiscoveryDomain({
      configDomain: cfg.discovery?.wideArea?.domain,
    });
    const spin = prompter.progress("Searching for gateways…");
    const beacons = await discoverGatewayBeacons({ timeoutMs: 2000, wideAreaDomain });
    spin.stop(beacons.length > 0 ? `Found ${beacons.length} gateway(s)` : "No gateways found");

    if (beacons.length > 0) {
      const selection = await prompter.select({
        message: "Select gateway",
        options: [
          ...beacons.map((beacon, index) => ({
            value: String(index),
            label: buildLabel(beacon),
          })),
          { value: "manual", label: "Enter URL manually" },
        ],
      });
      if (selection !== "manual") {
        const idx = Number.parseInt(String(selection), 10);
        selectedBeacon = Number.isFinite(idx) ? (beacons[idx] ?? null) : null;
      }
    }
  }

  if (selectedBeacon) {
    const target = buildGatewayDiscoveryTarget(selectedBeacon);
    if (target.endpoint) {
      const { host, port } = target.endpoint;
      const mode = await prompter.select({
        message: "Connection method",
        options: [
          {
            value: "direct",
            label: `Direct gateway WS (${host}:${port})`,
          },
          { value: "ssh", label: "SSH tunnel (loopback)" },
        ],
      });
      if (mode === "direct") {
        suggestedUrl = `wss://${host}:${port}`;
        const fingerprint = target.endpoint.gatewayTlsFingerprintSha256;
        const trusted = await prompter.confirm({
          message: `Trust this gateway? Host: ${host}:${port} TLS fingerprint: ${fingerprint ?? "not advertised (connection will not be pinned)"}`,
          initialValue: false,
        });
        if (trusted) {
          discoveryTlsFingerprint = fingerprint;
          trustedDiscoveryUrl = suggestedUrl;
          await prompter.note(
            [
              "Direct remote access defaults to TLS.",
              `Using: ${suggestedUrl}`,
              ...(fingerprint ? [`TLS pin: ${fingerprint}`] : []),
              `If your gateway is loopback-only, choose SSH tunnel and keep ${buildDefaultGatewayUrl(cfg)}.`,
            ].join("\n"),
            "Direct remote",
          );
        }
      } else {
        const localPort = resolveGatewayPort(cfg, process.env);
        const remotePort = target.endpoint.port || DEFAULT_GATEWAY_PORT;
        suggestedUrl = buildDefaultGatewayUrl(cfg);
        await prompter.note(
          [
            "Start a tunnel before using the CLI:",
            `ssh -N -L ${localPort}:127.0.0.1:${remotePort} <user>@${host}${target.sshPort ? ` -p ${target.sshPort}` : ""}`,
            "Docs: https://docs.alisio.pt/gateway/remote",
          ].join("\n"),
          "SSH tunnel",
        );
      }
    }
  }

  const urlInput = await prompter.text({
    message: "Gateway WebSocket URL",
    initialValue: suggestedUrl,
    validate: (value) => validateGatewayWebSocketUrl(String(value)),
  });
  const url = ensureWsUrl(String(urlInput), cfg);
  const pinnedDiscoveryFingerprint =
    discoveryTlsFingerprint && url === trustedDiscoveryUrl ? discoveryTlsFingerprint : undefined;

  const authChoice = await prompter.select({
    message: "Gateway auth",
    options: [
      { value: "token", label: "Token (recommended)" },
      { value: "password", label: "Password" },
      { value: "off", label: "No auth" },
    ],
  });

  let token: SecretInput | undefined = cfg.gateway?.remote?.token;
  let password: SecretInput | undefined = cfg.gateway?.remote?.password;
  if (authChoice === "token") {
    const selectedMode = await resolveSecretInputModeForEnvSelection({
      prompter,
      explicitMode: options?.secretInputMode,
      copy: {
        modeMessage: "How do you want to provide this gateway token?",
        plaintextLabel: "Enter token now",
        plaintextHint: "Stores the token directly in Alisio config",
      },
    });
    if (selectedMode === "ref") {
      const resolved = await promptSecretRefForSetup({
        provider: "gateway-remote-token",
        config: cfg,
        prompter,
        preferredEnvVar: "ALISIO_GATEWAY_TOKEN",
        copy: {
          sourceMessage: "Where is this gateway token stored?",
          envVarPlaceholder: "ALISIO_GATEWAY_TOKEN",
        },
      });
      token = resolved.ref;
    } else {
      token = String(
        await prompter.text({
          message: "Gateway token",
          initialValue: typeof token === "string" ? token : undefined,
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
    }
    password = undefined;
  } else if (authChoice === "password") {
    const selectedMode = await resolveSecretInputModeForEnvSelection({
      prompter,
      explicitMode: options?.secretInputMode,
      copy: {
        modeMessage: "How do you want to provide this gateway password?",
        plaintextLabel: "Enter password now",
        plaintextHint: "Stores the password directly in Alisio config",
      },
    });
    if (selectedMode === "ref") {
      const resolved = await promptSecretRefForSetup({
        provider: "gateway-remote-password",
        config: cfg,
        prompter,
        preferredEnvVar: "ALISIO_GATEWAY_PASSWORD",
        copy: {
          sourceMessage: "Where is this gateway password stored?",
          envVarPlaceholder: "ALISIO_GATEWAY_PASSWORD",
        },
      });
      password = resolved.ref;
    } else {
      password = String(
        await prompter.text({
          message: "Gateway password",
          initialValue: typeof password === "string" ? password : undefined,
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
    }
    token = undefined;
  } else {
    token = undefined;
    password = undefined;
  }

  return {
    ...cfg,
    gateway: {
      ...cfg.gateway,
      mode: "remote",
      remote: {
        url,
        ...(token !== undefined ? { token } : {}),
        ...(password !== undefined ? { password } : {}),
        ...(pinnedDiscoveryFingerprint ? { tlsFingerprint: pinnedDiscoveryFingerprint } : {}),
      },
    },
  };
}
