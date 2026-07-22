import type { Finding, Snapshot, ToolInfo } from "../types.js";
import { jsonTokens, wordCount } from "../tokens.js";

const BUDGET_WARN = 5000;
const BUDGET_ERROR = 10000;
const COUNT_WARN = 40;
const COUNT_ERROR = 60;
const TERSE_WORDS = 10;
const BLOAT_WORDS = 200;
const OVERLAP_THRESHOLD = 0.5;

// Check C — context budget. This is the differentiator: what the tool list
// costs the agent in tokens and clarity, not just spec conformance.
export function contextRules(s: Snapshot): Finding[] {
  const out: Finding[] = [];
  if (!s.connected || s.tools.length === 0) return out;

  const totalTokens = jsonTokens(s.tools);
  if (totalTokens > BUDGET_ERROR) {
    out.push({
      id: "budget-huge",
      category: "context",
      severity: "error",
      title: "tools/list is very expensive",
      detail: `The tool list costs roughly ${totalTokens} tokens on every request — that is a large, permanent context tax.`,
    });
  } else if (totalTokens > BUDGET_WARN) {
    out.push({
      id: "budget-large",
      category: "context",
      severity: "warn",
      title: "tools/list is expensive",
      detail: `The tool list costs roughly ${totalTokens} tokens on every request. Trim descriptions or split the server.`,
    });
  }

  if (s.tools.length > COUNT_ERROR) {
    out.push({
      id: "too-many-tools",
      category: "context",
      severity: "error",
      title: "Too many tools",
      detail: `${s.tools.length} tools — well past the ~40 where agents start picking the wrong one.`,
    });
  } else if (s.tools.length > COUNT_WARN) {
    out.push({
      id: "many-tools",
      category: "context",
      severity: "warn",
      title: "Large number of tools",
      detail: `${s.tools.length} tools; selection accuracy degrades as this grows. Consider grouping or gating.`,
    });
  }

  for (const t of s.tools) {
    const words = wordCount(t.description);
    if (words > 0 && words < TERSE_WORDS) {
      out.push({
        id: "terse-description",
        category: "context",
        severity: "info",
        title: "Very short description",
        detail: `"${t.name}" has a ${words}-word description; likely too thin for reliable selection.`,
        tool: t.name,
      });
    } else if (words > BLOAT_WORDS) {
      out.push({
        id: "bloated-description",
        category: "context",
        severity: "warn",
        title: "Bloated description",
        detail: `"${t.name}" has a ${words}-word description; long descriptions burn context on every request.`,
        tool: t.name,
      });
    }
  }

  out.push(...overlapFindings(s.tools));
  return out;
}

// Cheap semantic-overlap detection via character trigram Jaccard — no
// embeddings, no API keys. Flags tools that read as near-duplicates (the
// classic search/find confusion). Near-identical tools are grouped into a
// single cluster so a 50-tool server does not emit thousands of pair warnings.
function overlapFindings(tools: ToolInfo[]): Finding[] {
  const grams = tools.map((t) => trigrams(`${t.name} ${t.description ?? ""}`.toLowerCase()));
  const uf = new UnionFind(tools.length);
  for (let i = 0; i < tools.length; i++) {
    for (let j = i + 1; j < tools.length; j++) {
      if (jaccard(grams[i], grams[j]) >= OVERLAP_THRESHOLD) uf.union(i, j);
    }
  }

  const clusters = new Map<number, number[]>();
  for (let i = 0; i < tools.length; i++) {
    const root = uf.find(i);
    const arr = clusters.get(root) ?? [];
    arr.push(i);
    clusters.set(root, arr);
  }

  const out: Finding[] = [];
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const names = members.map((i) => tools[i].name);
    const shown = names.slice(0, 6).join(", ");
    const more = names.length > 6 ? ` (+${names.length - 6} more)` : "";
    out.push({
      id: "overlapping-tools",
      category: "context",
      severity: "warn",
      title:
        members.length === 2 ? "Overlapping tools" : `${members.length} near-duplicate tools`,
      detail:
        `These tools read as near-duplicates, so an agent may pick the wrong one: ${shown}${more}. ` +
        "Merge them or make their descriptions clearly distinct.",
    });
  }
  return out;
}

// Minimal union-find for grouping the overlap graph into clusters.
class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

function trigrams(text: string): Set<string> {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const set = new Set<string>();
  for (let i = 0; i < cleaned.length - 2; i++) {
    set.add(cleaned.slice(i, i + 3));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}
