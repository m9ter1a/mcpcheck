// Runs mcpcheck against a curated set of popular MCP servers and writes a
// Markdown results table. Static mode (--no-probes): deterministic, no external
// side effects, no real credentials needed. Servers that require an env var to
// start are given a dummy value so they boot far enough to serve tools/list.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const cli = join(repo, "dist", "cli.js");
const node = process.execPath;
const tmp = mkdtempSync(join(tmpdir(), "mcpcheck-bench-"));

const SERVERS = [
  { label: "server-everything", pkg: "@modelcontextprotocol/server-everything" },
  { label: "server-memory", pkg: "@modelcontextprotocol/server-memory" },
  { label: "server-sequential-thinking", pkg: "@modelcontextprotocol/server-sequential-thinking" },
  { label: "server-filesystem", pkg: "@modelcontextprotocol/server-filesystem", args: [tmp] },
  { label: "server-sqlite (npx)", pkg: "mcp-server-sqlite-npx", args: [join(tmp, "bench.db")] },
  { label: "server-everart", pkg: "@modelcontextprotocol/server-everart", env: { EVERART_API_KEY: "dummy" } },
  { label: "server-github", pkg: "@modelcontextprotocol/server-github", env: { GITHUB_PERSONAL_ACCESS_TOKEN: "dummy" } },
  { label: "server-brave-search", pkg: "@modelcontextprotocol/server-brave-search", env: { BRAVE_API_KEY: "dummy" } },
  { label: "server-slack", pkg: "@modelcontextprotocol/server-slack", env: { SLACK_BOT_TOKEN: "dummy", SLACK_TEAM_ID: "dummy" } },
  { label: "server-gitlab", pkg: "@modelcontextprotocol/server-gitlab", env: { GITLAB_PERSONAL_ACCESS_TOKEN: "dummy" } },
  { label: "server-google-maps", pkg: "@modelcontextprotocol/server-google-maps", env: { GOOGLE_MAPS_API_KEY: "dummy" } },
];

function entryFor(pkg) {
  const p = join(here, "node_modules", ...pkg.split("/"), "dist", "index.js");
  return existsSync(p) ? p : null;
}

function run(server) {
  const entry = entryFor(server.pkg);
  if (!entry) return { ...server, status: "not-installed" };

  const args = [cli, "--json", "--no-probes", "--timeout", "20000", "--", node, entry, ...(server.args ?? [])];
  const res = spawnSync(node, args, {
    env: { ...process.env, ...(server.env ?? {}) },
    encoding: "utf8",
    timeout: 45000,
  });

  let report = null;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    return { ...server, status: "no-output", stderr: (res.stderr || "").slice(0, 200) };
  }
  if (!report.connected) return { ...server, status: "did-not-start", report };
  return { ...server, status: "ok", report };
}

const results = SERVERS.map((s) => {
  process.stderr.write(`· ${s.label}\n`);
  return run(s);
});

function topIssues(report, n = 2) {
  const seen = new Set();
  const out = [];
  for (const f of report.findings ?? []) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f.title);
    if (out.length >= n) break;
  }
  return out.join("; ") || "—";
}

const ok = results.filter((r) => r.status === "ok").sort((a, b) => b.report.overall - a.report.overall);
const bad = results.filter((r) => r.status !== "ok");

const lines = [];
lines.push("# mcpcheck: popular MCP servers");
lines.push("");
lines.push(`Ran \`mcpcheck --no-probes\` (static ergonomics only) against ${SERVERS.length} servers.`);
lines.push("");
lines.push(
  "> Static mode is deterministic and makes no external API calls. Servers that need a real " +
    "credential (or a native build) to boot never complete the handshake and are listed separately.",
);
lines.push("");
lines.push("| Server | Grade | Score | Tools | tools/list ≈tokens | Top issues |");
lines.push("| --- | :---: | :---: | :---: | :---: | --- |");
for (const r of ok) {
  const rep = r.report;
  lines.push(
    `| ${r.label} | ${rep.grade} | ${rep.overall} | ${rep.toolCount} | ${rep.toolsListTokens} | ${topIssues(rep)} |`,
  );
}
lines.push("");
if (bad.length) {
  lines.push("### Did not produce a grade");
  lines.push("");
  lines.push("| Server | Reason |");
  lines.push("| --- | --- |");
  const REASON = {
    "not-installed": "package not installed",
    "no-output": "server failed to start / no MCP handshake",
    "did-not-start": "process exited during initialize (needs real credentials or a native build)",
  };
  for (const r of bad) lines.push(`| ${r.label} | ${REASON[r.status] ?? r.status} |`);
  lines.push("");
}

const md = lines.join("\n");
writeFileSync(join(here, "RESULTS.md"), md + "\n");
process.stdout.write("\n" + md + "\n");
