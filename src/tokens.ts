// Rough token estimation. We deliberately avoid pulling in a full tokenizer
// (heavy dependency, per-model) — the ~4-chars-per-token rule of thumb is close
// enough to flag context-budget problems, and mcpcheck stays zero-config.
// This intentionally over- rather than under-counts JSON punctuation.

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function jsonTokens(value: unknown): number {
  try {
    return estimateTokens(JSON.stringify(value ?? ""));
  } catch {
    return 0;
  }
}

export function wordCount(text: string | undefined): number {
  if (!text) return 0;
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}
