#!/usr/bin/env node
import { parseArgs } from "node:util";
import { connect, parseTarget } from "./client.js";
import { runProbes } from "./probes.js";
import { runRules } from "./rules/index.js";
import { score } from "./score.js";
import { renderTerminal, renderMarkdown, renderJson } from "./render.js";

const HELP = `mcpcheck — audit an MCP server for agent ergonomics.

Usage:
  mcpcheck <server.js | "cmd args" | https://url> [options]
  mcpcheck -- <command> [args...]        run an explicit command as the server

Options:
  --json               machine-readable JSON report
  --markdown           Markdown report + badge (for CI comments)
  --allow-write        also probe tools that are not marked readOnlyHint
  --no-probes          skip dynamic probing (static analysis only)
  --timeout <ms>       per-call timeout (default 10000)
  --min-score <n>      exit non-zero if the overall score is below n (default 0)
  -h, --help           show this help

Examples:
  mcpcheck ./server.js
  mcpcheck "python server.py --stdio"
  mcpcheck https://example.com/mcp --markdown
`;

async function main(): Promise<number> {
  const raw = process.argv.slice(2);

  // Support "-- <command...>" as an explicit passthrough command.
  let passthrough: string[] | null = null;
  const dd = raw.indexOf("--");
  let argvForParse = raw;
  if (dd !== -1) {
    passthrough = raw.slice(dd + 1);
    argvForParse = raw.slice(0, dd);
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argvForParse,
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        markdown: { type: "boolean", default: false },
        "allow-write": { type: "boolean", default: false },
        "no-probes": { type: "boolean", default: false },
        timeout: { type: "string" },
        "min-score": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
  } catch (err: any) {
    process.stderr.write(`Error: ${err.message}\n\n${HELP}`);
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.help || (positionals.length === 0 && !passthrough)) {
    process.stdout.write(HELP);
    return values.help ? 0 : 2;
  }

  const timeoutMs = values.timeout ? Number(values.timeout) : 10000;
  const minScore = values["min-score"] ? Number(values["min-score"]) : 0;

  let target;
  try {
    target = passthrough && passthrough.length > 0 ? parseTarget(passthrough) : parseTarget(positionals);
  } catch (err: any) {
    process.stderr.write(`Error: ${err.message}\n\n${HELP}`);
    return 2;
  }

  const session = await connect(target, timeoutMs);
  try {
    if (!values["no-probes"] && session.snapshot.connected) {
      await runProbes(session, { allowWrite: values["allow-write"], timeoutMs });
    }
  } finally {
    await session.close();
  }

  const findings = runRules(session.snapshot);
  const report = score(session.snapshot, findings);

  if (values.json) {
    process.stdout.write(renderJson(report) + "\n");
  } else if (values.markdown) {
    process.stdout.write(renderMarkdown(report) + "\n");
  } else {
    process.stdout.write(renderTerminal(report) + "\n");
  }

  // CI-friendly exit codes.
  if (!report.snapshot.connected) return 1;
  if (report.overall < minScore) return 1;
  const hasError = findings.some((f) => f.severity === "error");
  return hasError ? 1 : 0;
}

// The streamable-HTTP transport leaves a keep-alive socket in Node's global
// fetch dispatcher. Closing it lets the process exit naturally; a raw
// process.exit() would tear the socket down mid-close and trip a libuv
// assertion on Windows.
async function closeHttpKeepAlive(): Promise<void> {
  try {
    const dispatcher = (globalThis as any)[Symbol.for("undici.globalDispatcher.1")];
    if (dispatcher && typeof dispatcher.close === "function") await dispatcher.close();
  } catch {
    /* best effort */
  }
}

async function finish(code: number): Promise<void> {
  await closeHttpKeepAlive();
  process.exitCode = code;
  // Prefer a clean, natural exit once handles drain. Hard-exit only as a
  // last resort so a hung server can't wedge the process forever.
  const bail = setTimeout(() => process.exit(code), 4000);
  bail.unref();
}

main().then(finish, (err) => {
  process.stderr.write(`Unexpected error: ${err?.stack ?? err}\n`);
  return finish(2);
});
