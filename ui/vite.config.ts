import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { resolveGatewayPort } from "../src/config/paths.js";
import {
  CONTROL_UI_BOOTSTRAP_CONFIG_PATH,
  CONTROL_UI_DEVICE_IDENTITY_PATH,
  CONTROL_UI_DEVICE_SIGN_PATH,
} from "../src/gateway/control-ui-contract.js";
import { DEFAULT_LOCAL_GATEWAY_HOST } from "../src/shared/gateway-defaults.js";

const here = path.dirname(fileURLToPath(import.meta.url));

function normalizeBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed === "./") {
    return "./";
  }
  if (trimmed.endsWith("/")) {
    return trimmed;
  }
  return `${trimmed}/`;
}

function normalizeModuleId(id: string): string {
  return id.replaceAll("\\", "/");
}

function isProviderCatalogModule(id: string): boolean {
  const normalized = normalizeModuleId(id);
  return (
    normalized.includes("/node_modules/@mariozechner/pi-ai/dist/models.generated.js") ||
    normalized.includes("/node_modules/@mariozechner/pi-ai/dist/models.js") ||
    normalized.includes("/node_modules/@mariozechner/pi-ai/dist/utils/event-stream.js")
  );
}

function isMarkdownModule(id: string): boolean {
  const normalized = normalizeModuleId(id);
  return (
    normalized.includes("/node_modules/marked/") ||
    normalized.includes("/node_modules/dompurify/") ||
    normalized.endsWith("/ui/src/ui/markdown.ts") ||
    normalized.endsWith("/ui/src/ui/views/markdown-sidebar.ts") ||
    normalized.endsWith("/ui/src/ui/views/agents-panels-status-files.ts")
  );
}

function isAlisioFeatureModule(id: string): boolean {
  const normalized = normalizeModuleId(id);
  return (
    normalized.endsWith("/ui/src/ui/controllers/alisio.ts") ||
    normalized.endsWith("/ui/src/ui/views/account-profile-fields.ts") ||
    normalized.endsWith("/ui/src/ui/views/authentications.ts") ||
    normalized.endsWith("/ui/src/ui/views/capabilities.ts") ||
    normalized.endsWith("/ui/src/ui/views/connections.ts") ||
    normalized.endsWith("/ui/src/ui/views/connector-branding.ts") ||
    normalized.endsWith("/ui/src/ui/views/connector-state.ts") ||
    normalized.endsWith("/ui/src/ui/views/models.ts") ||
    normalized.endsWith("/ui/src/ui/views/organization.ts") ||
    normalized.endsWith("/ui/src/ui/views/setup.ts") ||
    normalized.endsWith("/ui/src/ui/views/sharing-shared.ts")
  );
}

export default defineConfig(() => {
  const envBase = process.env.ALISIO_CONTROL_UI_BASE_PATH?.trim();
  const devGatewayPort = String(resolveGatewayPort(undefined, process.env));
  const devGatewayOrigin = `http://${DEFAULT_LOCAL_GATEWAY_HOST}:${devGatewayPort}`;
  const base = envBase ? normalizeBase(envBase) : "./";
  return {
    base,
    publicDir: path.resolve(here, "public"),
    plugins: [
      {
        name: "alisio-dev-gateway-port",
        transformIndexHtml(html) {
          return html.replace(
            '"__ALISIO_CONTROL_UI_DEV_GATEWAY_PORT__"',
            JSON.stringify(devGatewayPort),
          );
        },
      },
    ],
    optimizeDeps: {
      include: ["lit/directives/repeat.js"],
    },
    build: {
      outDir: path.resolve(here, "../dist/control-ui"),
      emptyOutDir: true,
      sourcemap: true,
      // Keep CI/onboard logs clean; provider SDK chunks can still be sizeable.
      chunkSizeWarningLimit: 1024,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "event-stream",
                test: isProviderCatalogModule,
                priority: 30,
              },
              {
                name: "ui-markdown",
                test: isMarkdownModule,
                priority: 20,
              },
              {
                name: "ui-alisio",
                test: isAlisioFeatureModule,
                priority: 10,
              },
            ],
          },
        },
      },
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        "/__alisio/bootstrap": {
          target: devGatewayOrigin,
          changeOrigin: true,
        },
        [CONTROL_UI_BOOTSTRAP_CONFIG_PATH]: {
          target: devGatewayOrigin,
          changeOrigin: true,
        },
        [CONTROL_UI_DEVICE_IDENTITY_PATH]: {
          target: devGatewayOrigin,
          changeOrigin: true,
        },
        [CONTROL_UI_DEVICE_SIGN_PATH]: {
          target: devGatewayOrigin,
          changeOrigin: true,
        },
      },
    },
  };
});
