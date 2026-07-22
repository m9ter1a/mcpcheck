// A deliberately terrible MCP server used to demonstrate mcpcheck. It breaks
// something in every category: stdout pollution, dirty schemas, a bloated tool
// list, and tools that leak secrets / dump huge responses.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Protocol violation: logging to stdout corrupts the JSON-RPC stream.
console.log("bad-server starting up...");

const BLOAT = (
  "This tool does a lot of things and you should read this entire paragraph carefully before " +
  "deciding whether to call it because it is very important and covers many many cases. "
).repeat(12); // ~250+ words of description bloat

const tools = [
  // Non-snake-case name, empty description, no required, no annotations, no output schema.
  {
    name: "SearchThings",
    description: "",
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
  },
  // Overlapping pair: "search" vs "find" with near-identical descriptions.
  {
    name: "search",
    description: "Search for items in the database by a keyword query string.",
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "find",
    description: "Find items in the database by a keyword query string.",
    inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    annotations: { readOnlyHint: true },
  },
  // Duplicate of "search".
  {
    name: "search",
    description: "Yet another search entry point that does roughly the same thing.",
    inputSchema: { type: "object", properties: { q: { type: "string" } } },
  },
  // Mutating tool with no safety annotation.
  {
    name: "delete_all_records",
    description: "",
    inputSchema: { type: "object", properties: {} },
  },
  // inputSchema is not an object schema.
  {
    name: "get-data",
    description: "Gets data.",
    inputSchema: { type: "string" },
  },
  // Massively bloated description.
  {
    name: "do_everything",
    description: BLOAT,
    inputSchema: { type: "object", properties: { x: { type: "string" } } },
  },
];

// Pad the tool list well past the point where agent tool-selection degrades.
for (let i = 0; i < 55; i++) {
  tools.push({
    name: `legacy_action_${i}`,
    description:
      "Performs a legacy action that has been kept around for backwards compatibility with older " +
      "integrations and should generally not be used by new callers but remains listed here anyway.",
    inputSchema: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
  });
}

const server = new Server({ name: "bad-kitchen-sink", version: "0.0.1" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, (req) => {
  const { name } = req.params;
  if (name === "search") {
    // Huge response that also leaks a secret and an absolute path.
    const dump = "row ".repeat(30000);
    return {
      content: [
        {
          type: "text",
          text:
            `Loaded config from C:\\Users\\admin\\secrets\\config.json\n` +
            `api_key: 'sk-1234567890abcdefghijSECRET'\n` +
            dump,
        },
      ],
    };
  }
  if (name === "find") {
    // Accepts anything, never validates — returns success even for junk input.
    return { content: [{ type: "text", text: "ok" }] };
  }
  return { content: [{ type: "text", text: "done" }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
