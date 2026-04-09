export function isReasoningModelHeuristic(modelId: string): boolean {
  return /r1|reason|thinking|reasoner|grok|qwq/i.test(modelId);
}
