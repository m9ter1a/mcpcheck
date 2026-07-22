import pc from "picocolors";
import type { Category, CategoryScore, Finding, Report, Severity } from "./types.js";
import { jsonTokens } from "./tokens.js";

const CATEGORY_LABEL: Record<Category, string> = {
  protocol: "Protocol",
  schema: "Schema",
  context: "Context",
  probes: "Probes",
};

const SEV_LABEL: Record<Severity, string> = { error: "ERR ", warn: "WARN", info: "INFO" };

function gradeColor(grade: string): (s: string) => string {
  if (grade === "A" || grade === "B") return pc.green;
  if (grade === "C" || grade === "D") return pc.yellow;
  return pc.red;
}

function sevColor(sev: Severity): (s: string) => string {
  return sev === "error" ? pc.red : sev === "warn" ? pc.yellow : pc.dim;
}

export function badge(report: Report): string {
  return `MCP Score: ${report.grade} (${report.overall})`;
}

function bar(scoreValue: number): string {
  const filled = Math.round(scoreValue / 10);
  const color = scoreValue >= 80 ? pc.green : scoreValue >= 60 ? pc.yellow : pc.red;
  return color("█".repeat(filled)) + pc.dim("░".repeat(10 - filled));
}

export function renderTerminal(report: Report): string {
  const { snapshot, findings, categories, overall, grade } = report;
  const lines: string[] = [];
  const gc = gradeColor(grade);

  lines.push("");
  lines.push(pc.bold(`  mcpcheck  ${pc.dim(snapshot.target)}`));
  if (snapshot.serverInfo) {
    lines.push(pc.dim(`  ${snapshot.serverInfo.name} v${snapshot.serverInfo.version}  ·  ${snapshot.transport}`));
  }
  lines.push("");
  lines.push(`  ${gc(pc.bold(`Grade ${grade}`))}   ${gc(pc.bold(String(overall)))}${pc.dim("/100")}   ${pc.dim(
    `${snapshot.tools.length} tools`,
  )}`);
  lines.push("");

  for (const c of categories) {
    lines.push(`  ${CATEGORY_LABEL[c.category].padEnd(9)} ${bar(c.score)} ${String(c.score).padStart(3)}`);
  }
  lines.push("");

  const counts = countBySeverity(findings);
  lines.push(
    `  ${pc.red(`${counts.error} errors`)}  ·  ${pc.yellow(`${counts.warn} warnings`)}  ·  ${pc.dim(
      `${counts.info} info`,
    )}`,
  );
  lines.push("");

  if (findings.length === 0) {
    lines.push(pc.green("  No issues found. This server is agent-friendly."));
    lines.push("");
  } else {
    // Collapse findings that share a rule id (e.g. "no outputSchema" across 60
    // tools) into one line, so the report stays readable on messy servers.
    for (const group of groupById(findings)) {
      const f = group[0];
      const sc = sevColor(f.severity);
      // Only collapse genuinely per-tool findings (same id, one per tool).
      // Findings without a tool each carry distinct meaning — print them all.
      const collapsible = group.length > 1 && group.every((g) => g.tool);
      if (!collapsible) {
        for (const g of group) {
          const tool = g.tool ? pc.dim(` [${g.tool}]`) : "";
          lines.push(`  ${sc(SEV_LABEL[g.severity])}  ${pc.bold(g.title)}${tool}`);
          lines.push(`        ${pc.dim(g.detail)}`);
        }
      } else {
        const tools = group.map((g) => g.tool).filter(Boolean) as string[];
        const shown = tools.slice(0, 8).join(", ");
        const more = tools.length > 8 ? ` +${tools.length - 8} more` : "";
        lines.push(`  ${sc(SEV_LABEL[f.severity])}  ${pc.bold(f.title)} ${pc.dim(`×${group.length}`)}`);
        lines.push(`        ${pc.dim(f.detail)}`);
        if (shown) lines.push(`        ${pc.dim(`Affected: ${shown}${more}`)}`);
      }
    }
    lines.push("");
  }

  lines.push(pc.dim("  Badge for your README:"));
  lines.push(`  ${gc(badge(report))}`);
  lines.push("");
  return lines.join("\n");
}

export function renderMarkdown(report: Report): string {
  const { snapshot, findings, categories } = report;
  const lines: string[] = [];
  lines.push(`### \`${badge(report)}\` — ${snapshot.target}`);
  lines.push("");
  lines.push("| Category | Score |");
  lines.push("| --- | --- |");
  for (const c of categories) {
    lines.push(`| ${CATEGORY_LABEL[c.category]} | ${c.score}/100 |`);
  }
  lines.push("");
  if (findings.length === 0) {
    lines.push("No issues found. ✅");
  } else {
    lines.push("| Severity | Issue | Tool | Detail |");
    lines.push("| --- | --- | --- | --- |");
    for (const f of findings) {
      lines.push(
        `| ${f.severity} | ${f.title} | ${f.tool ?? ""} | ${f.detail.replace(/\|/g, "\\|")} |`,
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

export function renderJson(report: Report): string {
  return JSON.stringify(
    {
      target: report.snapshot.target,
      transport: report.snapshot.transport,
      connected: report.snapshot.connected,
      server: report.snapshot.serverInfo,
      grade: report.grade,
      overall: report.overall,
      badge: badge(report),
      categories: report.categories,
      toolCount: report.snapshot.tools.length,
      toolsListTokens: jsonTokens(report.snapshot.tools),
      findings: report.findings,
    },
    null,
    2,
  );
}

// Group findings by rule id, preserving the (severity-sorted) order of first
// appearance.
function groupById(findings: Finding[]): Finding[][] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = groups.get(f.id) ?? [];
    arr.push(f);
    groups.set(f.id, arr);
  }
  return [...groups.values()];
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}
