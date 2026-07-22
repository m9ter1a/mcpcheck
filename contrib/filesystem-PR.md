# PR: describe every tool parameter in server-filesystem

**Target:** `modelcontextprotocol/servers` → `src/filesystem/index.ts`
**Patch:** `contrib/filesystem-param-descriptions.patch` (18 insertions, 18 deletions)

## Title

`filesystem: add descriptions to all tool parameters`

## Body

Most tools in the filesystem server expose parameters (`path`, `content`,
`source`, `destination`, `pattern`, `edits`, `excludePatterns`) with no
`description`. An agent picking and filling these tools has only the parameter
name to go on, and "path" alone doesn't say it must live inside an allowed
directory.

This PR adds a one-line `.describe(...)` to every previously-undescribed
parameter across the registered tools. It's a metadata-only change:

- no behavior change; all **152 existing tests pass**
- descriptions are short and factual (e.g. path fields note the
  allowed-directory constraint)

### How I found it

Audited the server with [mcpcheck](https://github.com/<you>/mcpcheck), which
scores MCP servers on agent ergonomics. Parameter descriptions were the main
gap:

| | Before | After |
| --- | :---: | :---: |
| mcpcheck grade | A (92) | A (97) |
| tools with undescribed params | 12 | 0 |

(The one remaining note is that `list_directory` and `list_directory_with_sizes`
read as near-duplicates — left as-is, out of scope for this PR.)
