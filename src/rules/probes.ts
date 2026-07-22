import type { Finding, ProbeResult, Snapshot } from "../types.js";

const RESP_WARN = 10000;
const RESP_ERROR = 25000;
const SLOW_MS = 5000;

// Check D — findings derived from the dynamic probe results.
export function probeRules(s: Snapshot): Finding[] {
  const out: Finding[] = [];
  if (!s.connected) return out;

  for (const p of s.probes) {
    if (p.crashed) {
      out.push({
        id: "probe-crash",
        category: "probes",
        severity: "error",
        title: "Tool breaks on bad input",
        detail: `Calling "${p.tool}" with ${p.kind} did not return a structured error — the call broke: ${
          p.message ?? "unknown error"
        }.`,
        tool: p.tool,
      });
    }

    if (p.leaks && p.leaks.length) {
      out.push({
        id: "probe-leak",
        category: "probes",
        severity: "error",
        title: "Sensitive data in tool output",
        detail: `"${p.tool}" leaked ${p.leaks.join(", ")} in its response; agents forward such text into context.`,
        tool: p.tool,
      });
    }

    if (p.kind === "invalid-args" && p.responded && !p.isError && !p.protocolError) {
      out.push({
        id: "weak-validation",
        category: "probes",
        severity: "info",
        title: "Accepts invalid arguments",
        detail: `"${p.tool}" accepted clearly invalid arguments without signalling an error.`,
        tool: p.tool,
      });
    }

    if (p.responseTokens !== undefined) {
      if (p.responseTokens > RESP_ERROR) {
        out.push({
          id: "response-huge",
          category: "probes",
          severity: "error",
          title: "Enormous tool response",
          detail: `"${p.tool}" returned roughly ${p.responseTokens} tokens; a few such calls can exhaust an agent's context.`,
          tool: p.tool,
        });
      } else if (p.responseTokens > RESP_WARN) {
        out.push({
          id: "response-large",
          category: "probes",
          severity: "warn",
          title: "Large tool response",
          detail: `"${p.tool}" returned roughly ${p.responseTokens} tokens; consider pagination or summarising.`,
          tool: p.tool,
        });
      }
    }

    if (p.latencyMs !== undefined && p.latencyMs > SLOW_MS) {
      out.push({
        id: "slow-tool",
        category: "probes",
        severity: "info",
        title: "Slow tool",
        detail: `"${p.tool}" took ${p.latencyMs}ms to respond.`,
        tool: p.tool,
      });
    }
  }

  return dedupe(out);
}

// The two probes per tool can raise the same finding twice; collapse them.
function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = `${f.id}:${f.tool ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
