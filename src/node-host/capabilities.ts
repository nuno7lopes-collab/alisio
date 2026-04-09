import type { NodeCapabilityManifest } from "../gateway/protocol/index.js";
import { resolveLmStudioCliPath } from "../infra/alisio-lmstudio.js";
import { inspectLocalModelRuntimes } from "../infra/alisio-local-model-runtime.js";

export async function resolveNodeHostCapabilities(params: {
  browserProxyEnabled: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<NodeCapabilityManifest[]> {
  const capabilities: NodeCapabilityManifest[] = [
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
  const inspections = await inspectLocalModelRuntimes({ env: params.env ?? process.env }).catch(
    () => [],
  );
  const runtimeKinds = new Set(inspections.map((inspection) => inspection.runtimeKind));

  if (runtimeKinds.has("ollama")) {
    capabilities.push({
      id: "model.catalog.ollama.v1",
      title: "Catalogo do Ollama",
      description: "Lista os modelos disponiveis no runtime Ollama deste computador ligado.",
      version: 1,
      risk: "low",
      streaming: false,
      interactive: false,
      supportsCancel: false,
      supportsResume: false,
      tags: ["llm", "local-model", "catalog", "ollama"],
    });
    capabilities.push({
      id: "model.manage.ollama.v1",
      title: "Gestao do Ollama",
      description: "Instala e remove modelos Ollama aprovados neste computador ligado.",
      version: 1,
      risk: "medium",
      streaming: true,
      interactive: false,
      supportsCancel: false,
      supportsResume: false,
      tags: ["llm", "local-model", "install", "ollama"],
    });
    capabilities.push({
      id: "model.chat.ollama.v1",
      title: "Modelo Ollama",
      description: "Executa chat no runtime Ollama deste computador ligado.",
      version: 1,
      risk: "medium",
      streaming: true,
      interactive: true,
      supportsCancel: false,
      supportsResume: false,
      tags: ["llm", "local-model", "ollama"],
    });
  }

  if (runtimeKinds.has("lmstudio")) {
    capabilities.push({
      id: "model.catalog.lmstudio.v1",
      title: "Catalogo do LM Studio",
      description: "Lista os modelos expostos pelo LM Studio neste computador ligado.",
      version: 1,
      risk: "low",
      streaming: false,
      interactive: false,
      supportsCancel: false,
      supportsResume: false,
      tags: ["llm", "local-model", "catalog", "lmstudio"],
    });
    capabilities.push({
      id: "model.chat.lmstudio.v1",
      title: "Modelo LM Studio",
      description: "Executa chat no servidor local do LM Studio deste computador ligado.",
      version: 1,
      risk: "medium",
      streaming: true,
      interactive: true,
      supportsCancel: false,
      supportsResume: false,
      tags: ["llm", "local-model", "lmstudio"],
    });
    if (resolveLmStudioCliPath(params.env ?? process.env)) {
      capabilities.push({
        id: "model.server.start.lmstudio.v1",
        title: "Arranque do LM Studio",
        description: "Liga o servidor local do LM Studio neste computador ligado.",
        version: 1,
        risk: "medium",
        streaming: false,
        interactive: false,
        supportsCancel: false,
        supportsResume: false,
        tags: ["llm", "local-model", "lmstudio", "server"],
      });
    }
  }

  if (runtimeKinds.has("openai-compatible")) {
    capabilities.push({
      id: "model.chat.openai.v1",
      title: "Modelo local",
      description:
        "Encaminha pedidos de chat para um servidor local compativel com OpenAI neste computador.",
      version: 1,
      risk: "medium",
      streaming: true,
      interactive: true,
      supportsCancel: false,
      supportsResume: false,
      tags: ["llm", "local-model", "openai-compatible"],
    });
    capabilities.push({
      id: "model.catalog.openai.v1",
      title: "Catalogo de modelos locais",
      description: "Lista os modelos locais disponiveis neste computador ligado.",
      version: 1,
      risk: "low",
      streaming: false,
      interactive: false,
      supportsCancel: false,
      supportsResume: false,
      tags: ["llm", "local-model", "catalog", "openai-compatible"],
    });
  }
  void params.browserProxyEnabled;
  return capabilities;
}
