import type { Category, CategoryScore, Finding, Report, Severity, Snapshot } from "./types.js";

const PENALTY: Record<Severity, number> = { error: 25, warn: 10, info: 3 };

// A single systemic issue repeated across many tools (e.g. "no outputSchema" on
// 12 tools) is one problem, not twelve. Cap how many occurrences of the same
// rule id count toward the score so volume alone can't zero a category.
const PER_RULE_CAP = 5;

// Relative importance of each category in the overall score. Categories that
// do not apply to a given server (e.g. no tools) are dropped and the remaining
// weights are renormalised.
const WEIGHT: Record<Category, number> = {
  protocol: 0.3,
  schema: 0.25,
  context: 0.25,
  probes: 0.2,
};

const ALL_CATEGORIES: Category[] = ["protocol", "schema", "context", "probes"];

function scoreCategory(findings: Finding[]): number {
  const countById = new Map<string, number>();
  let penalty = 0;
  for (const f of findings) {
    const seen = countById.get(f.id) ?? 0;
    if (seen >= PER_RULE_CAP) continue; // stop counting further repeats of the same rule
    countById.set(f.id, seen + 1);
    penalty += PENALTY[f.severity];
  }
  return Math.max(0, 100 - penalty);
}

function applies(cat: Category, s: Snapshot): boolean {
  switch (cat) {
    case "protocol":
      return true;
    case "schema":
    case "context":
      return s.connected && s.tools.length > 0;
    case "probes":
      return s.probes.length > 0;
  }
}

export function grade(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

export function score(snapshot: Snapshot, findings: Finding[]): Report {
  const categories: CategoryScore[] = [];
  for (const cat of ALL_CATEGORIES) {
    if (!applies(cat, snapshot)) continue;
    categories.push({ category: cat, score: scoreCategory(findings.filter((f) => f.category === cat)) });
  }

  let overall: number;
  if (!snapshot.connected) {
    // A server the agent cannot even connect to is a hard fail, regardless of
    // how few findings we managed to collect.
    overall = 0;
  } else {
    const totalWeight = categories.reduce((sum, c) => sum + WEIGHT[c.category], 0) || 1;
    const weighted = categories.reduce((sum, c) => sum + c.score * WEIGHT[c.category], 0);
    overall = Math.round(weighted / totalWeight);
  }

  return { snapshot, findings, categories, overall, grade: grade(overall) };
}
