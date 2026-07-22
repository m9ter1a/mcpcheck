# mcpcheck: popular MCP servers

Ran `mcpcheck --no-probes` (static ergonomics only) against 11 servers.

> Static mode is deterministic and makes no external API calls. Servers that need a real credential (or a native build) to boot never complete the handshake and are listed separately.

| Server | Grade | Score | Tools | tools/list ≈tokens | Top issues |
| --- | :---: | :---: | :---: | :---: | --- |
| server-sequential-thinking | A | 97 | 1 | 1132 | Bloated description |
| server-filesystem | A | 92 | 14 | 3205 | Overlapping tools; Parameters without descriptions |
| server-everything | B | 86 | 13 | 1784 | No outputSchema; No required fields declared |
| server-memory | B | 86 | 9 | 2692 | Overlapping tools; Parameters without descriptions |
| server-github | F | 56 | 26 | 3964 | Mutating tool without safety hints; 3 near-duplicate tools |

### Did not produce a grade

| Server | Reason |
| --- | --- |
| server-sqlite (npx) | process exited during initialize (needs real credentials or a native build) |
| server-everart | process exited during initialize (needs real credentials or a native build) |
| server-brave-search | process exited during initialize (needs real credentials or a native build) |
| server-slack | process exited during initialize (needs real credentials or a native build) |
| server-gitlab | process exited during initialize (needs real credentials or a native build) |
| server-google-maps | process exited during initialize (needs real credentials or a native build) |

