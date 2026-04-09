import type { NodeCapabilityManifest } from "../gateway/protocol/index.js";

export async function resolveNodeHostCapabilities(params: {
  browserProxyEnabled: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<NodeCapabilityManifest[]> {
  void params.browserProxyEnabled;
  void params.env;

  return [
    {
      id: "exec.shell.v1",
      title: "Execucao remota",
      description: "Executa comandos aprovados neste computador ligado.",
      version: 1,
      risk: "high",
      streaming: false,
      interactive: false,
      supportsCancel: false,
      supportsResume: false,
      requiresCommands: ["system.run"],
      tags: ["shell", "automation"],
    },
    {
      id: "model.catalog.llamacpp.v1",
      title: "Catalogo de modelos locais",
      description: "Lista os modelos llama.cpp instalados neste computador ligado.",
      version: 1,
      risk: "low",
      streaming: false,
      interactive: false,
      supportsCancel: false,
      supportsResume: false,
      tags: ["llm", "local-model", "catalog", "llama.cpp"],
    },
    {
      id: "model.manage.llamacpp.v1",
      title: "Gestao de modelos locais",
      description: "Instala e remove modelos llama.cpp aprovados neste computador ligado.",
      version: 1,
      risk: "medium",
      streaming: true,
      interactive: false,
      supportsCancel: false,
      supportsResume: false,
      tags: ["llm", "local-model", "install", "llama.cpp"],
    },
    {
      id: "model.chat.llamacpp.v1",
      title: "Modelo local",
      description: "Executa chat directamente num modelo llama.cpp instalado neste computador.",
      version: 1,
      risk: "medium",
      streaming: true,
      interactive: true,
      supportsCancel: false,
      supportsResume: false,
      tags: ["llm", "local-model", "llama.cpp"],
    },
  ];
}
