const ASCII_RE = /[a-z0-9_]+/g;
const CJK_RE = /[\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u1100-\u11ff]/;

export function normalizeTextKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokenizeText(value: string): Set<string> {
  const lower = value.toLowerCase();
  const asciiTokens = lower.match(ASCII_RE) ?? [];
  const chars = Array.from(lower);
  const cjk: Array<{ value: string; index: number }> = [];

  for (let index = 0; index < chars.length; index += 1) {
    if (CJK_RE.test(chars[index])) {
      cjk.push({ value: chars[index], index });
    }
  }

  const bigrams: string[] = [];
  for (let index = 0; index < cjk.length - 1; index += 1) {
    if (cjk[index + 1].index === cjk[index].index + 1) {
      bigrams.push(cjk[index].value + cjk[index + 1].value);
    }
  }

  return new Set([...asciiTokens, ...cjk.map((entry) => entry.value), ...bigrams]);
}

export function textSimilarity(left: string, right: string): number {
  const leftTokens = tokenizeText(left);
  const rightTokens = tokenizeText(right);
  if (leftTokens.size === 0 && rightTokens.size === 0) {
    return 1;
  }
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;
  const smaller = leftTokens.size <= rightTokens.size ? leftTokens : rightTokens;
  const larger = leftTokens.size <= rightTokens.size ? rightTokens : leftTokens;
  for (const token of smaller) {
    if (larger.has(token)) {
      intersection += 1;
    }
  }

  const union = leftTokens.size + rightTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function countInstructionalSteps(value: string): number {
  return value
    .split(/\r?\n/)
    .filter((line) => /^(?:\s*(?:\d+[.)]|[-*])\s+\S+|\s*step\s+\d+[:.)\s])/i.test(line)).length;
}
