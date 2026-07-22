# mcpcheck

**Audit any MCP server for agent ergonomics — one command, a 0–100 score, and a list of what breaks for the agent.**

```bash
npx @m9ter1a/mcpcheck ./server.js
```

> Installed globally (`npm i -g @m9ter1a/mcpcheck`), the command is simply `mcpcheck`. The examples below use that short form.

```
  mcpcheck  ./server.js
  good-weather v1.0.0  ·  stdio

  Grade A   100/100   2 tools

  Protocol  ██████████ 100
  Schema    ██████████ 100
  Context   ██████████ 100
  Probes    ██████████ 100

  0 errors  ·  0 warnings  ·  0 info
  No issues found. This server is agent-friendly.

  MCP Score: A (100)
```

## Why

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a manual GUI for poking at a server by hand. mcpcheck is the opposite: a **non-interactive audit** you can run in CI and get a grade from.

And it grades the thing that actually hurts an agent — not spec conformance (the SDKs already handle that), but **ergonomics**:

- bloated tool descriptions burn context on every single request
- 40+ tools wreck tool-selection accuracy
- a 20k-token tool response can blow up a whole session
- logs on stdout silently corrupt the stdio transport

mcpcheck connects as a **real MCP client** (stdio or streamable HTTP), introspects the server, runs static and dynamic checks, and prints a scored report.

## Usage

```bash
mcpcheck ./server.js                  # spawn `node ./server.js` over stdio
mcpcheck "python server.py --stdio"   # any command
mcpcheck -- python server.py --stdio  # explicit command passthrough
mcpcheck https://example.com/mcp      # streamable HTTP

mcpcheck ./server.js --json           # machine-readable report
mcpcheck ./server.js --markdown       # Markdown + badge, for CI comments
mcpcheck ./server.js --min-score 80   # exit non-zero below a threshold
mcpcheck ./server.js --no-probes      # static analysis only
mcpcheck ./server.js --allow-write    # also probe non-readOnly tools (see below)
```

Exit code is non-zero when the server fails to connect, has any `error`-level finding, or scores below `--min-score` — so it works as a CI gate out of the box.

## What it checks

**A · Protocol & handshake**
- initialize handshake completes
- `capabilities` match reality (declares `tools` but `tools/list` is empty/broken)
- unknown methods return a JSON-RPC error instead of crashing
- **non-JSON output on stdout** — the classic transport-corrupting bug

**B · Schema hygiene**
- missing tool / parameter descriptions
- invalid `inputSchema` (not `type: object`, no `required`)
- names: duplicates, unsafe characters, mixed snake_case/kebab-case conventions (either style is fine — just be consistent)
- missing safety annotations (`readOnlyHint`, `destructiveHint`) on mutating tools
- missing `outputSchema`

**C · Context budget** *(the differentiator)*
- total token cost of `tools/list` (flagged past ~5k)
- descriptions that are too terse or bloated
- too many tools (selection degrades past ~40)
- near-duplicate tools, clustered via character-trigram similarity — no embeddings, no API keys

**D · Dynamic probes**
- calls tools with empty / invalid arguments and checks for a **structured error** rather than a crash
- response size in tokens (missing pagination)
- per-call latency
- **secret / absolute-path leaks** in tool output

> Probes are safe by default: only tools that explicitly declare `readOnlyHint: true` are called. Use `--allow-write` to probe everything.

## Scoring

Each category is scored 0–100 (errors cost the most, then warnings, then info). The overall score is a weighted average mapped to a letter grade (A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F otherwise). Categories that don't apply to a server (e.g. no tools) are dropped and the weights renormalised.

By default the score includes the dynamic **Probes** category. Running with `--no-probes` drops it and scores on static analysis only, so the number will differ — expect the two modes to disagree on the same server.

## Badge

Every run prints a badge snippet for your README:

```
MCP Score: A (94)
```

## CI

```yaml
# .github/workflows/mcpcheck.yml
name: mcpcheck
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci && npm run build   # build your server first
      - run: npx @m9ter1a/mcpcheck ./dist/server.js --min-score 80
```

## Development

```bash
npm install
npm run build      # compile to dist/
npm test           # build + vitest (unit rules, scoring, stdio & HTTP e2e)
npm run bench      # score a set of popular MCP servers (writes bench/RESULTS.md)
```

CI runs the test suite on Linux, macOS, and Windows (Node 20 & 22) via
`.github/workflows/ci.yml`.

## Security & privacy

- **Runs locally, phones nobody.** mcpcheck makes no network calls except to the MCP server you point it at. No telemetry, no analytics — none of your (or your server's) data is sent anywhere else.
- **Its output can quote server responses.** The probe checks call read-only tools and may surface snippets of what a server returns, including any secrets it flags as leaking. Treat `--json` / `--markdown` output as potentially sensitive and review it before pasting into public CI logs or pull requests.
- **Probes are read-only by default.** Only tools marked `readOnlyHint: true` are called unless you pass `--allow-write`. Auditing a server also means running its code, so only point mcpcheck at servers you trust.

## Notes & limitations

- **Token counts are estimates** (~4 chars/token). They are meant to *flag* budget problems, not to bill you — and mcpcheck stays zero-config and zero-API-key as a result.
- mcpcheck reads `tools/list` **more leniently than the official client** on purpose: a single malformed tool won't blind the audit to the rest of the server.
- Built against **MCP TypeScript SDK 1.29** / protocol negotiated by that SDK. MCP moves fast; the supported version is pinned in `package.json`.

## License

MIT
