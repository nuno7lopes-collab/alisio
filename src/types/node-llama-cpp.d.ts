declare module "node-llama-cpp" {
  export enum LlamaLogLevel {
    error = 0,
  }

  export type ChatHistoryItem =
    | {
        type: "system";
        text: string;
      }
    | {
        type: "user";
        text: string;
      }
    | {
        type: "model";
        response: string[];
      };

  export type LlamaEmbedding = { vector: Float32Array | number[] };

  export type LlamaEmbeddingContext = {
    getEmbeddingFor: (text: string) => Promise<LlamaEmbedding>;
  };

  export type LlamaContext = {
    getSequence: () => unknown;
    dispose: () => Promise<void>;
  };

  export type LlamaModel = {
    createContext: () => Promise<LlamaContext>;
    createEmbeddingContext: () => Promise<LlamaEmbeddingContext>;
  };

  export type Llama = {
    loadModel: (params: {
      modelPath: string;
      gpuLayers?: "auto" | "max" | number;
      defaultContextFlashAttention?: boolean;
    }) => Promise<LlamaModel>;
  };

  export class LlamaChatSession {
    constructor(params: {
      contextSequence: unknown;
      systemPrompt?: string;
      autoDisposeSequence?: boolean;
    });
    prompt(
      prompt: string,
      options?: {
        onTextChunk?: (text: string) => void;
        signal?: AbortSignal;
        stopOnAbortSignal?: boolean;
        maxTokens?: number;
        temperature?: number;
      },
    ): Promise<string>;
    setChatHistory(chatHistory: ChatHistoryItem[]): void;
  }

  export function getLlama(params: { logLevel: LlamaLogLevel }): Promise<Llama>;
  export function resolveModelFile(
    modelPath: string,
    options?:
      | string
      | {
          directory?: string;
          cli?: boolean;
          onProgress?: (status: { totalSize: number; downloadedSize: number }) => void;
        },
  ): Promise<string>;
}
