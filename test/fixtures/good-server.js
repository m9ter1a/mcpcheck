// A well-behaved MCP server: clean names, real descriptions, input + output
// schemas, safety annotations, structured errors, and — crucially — no stray
// output on stdout. mcpcheck should grade this highly.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "good-weather", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

const tools = [
  {
    name: "get_current_weather",
    description:
      "Return the current temperature, wind speed and short conditions summary for a given city. Use this when the user asks what the weather is like right now.",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name, e.g. 'Berlin' or 'San Francisco'." },
        units: { type: "string", enum: ["metric", "imperial"], description: "Unit system for the numbers." },
      },
      required: ["city"],
    },
    outputSchema: {
      type: "object",
      properties: {
        temperature: { type: "number" },
        conditions: { type: "string" },
      },
      required: ["temperature", "conditions"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "get_forecast",
    description:
      "Return a multi-day weather forecast for a city, one entry per day, including high and low temperatures. Use this for questions about upcoming days rather than the current moment.",
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name to forecast for." },
        days: { type: "integer", description: "How many days ahead to forecast, from 1 to 7." },
      },
      required: ["city", "days"],
    },
    outputSchema: {
      type: "object",
      properties: { days: { type: "array", items: { type: "object" } } },
      required: ["days"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, (req) => {
  const { name, arguments: args } = req.params;
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
  }
  // Validate required args and fail the structured way (isError), not by throwing.
  const missing = (tool.inputSchema.required ?? []).filter((k) => args?.[k] === undefined);
  if (missing.length > 0) {
    return {
      isError: true,
      content: [{ type: "text", text: `Missing required argument(s): ${missing.join(", ")}` }],
    };
  }
  return {
    content: [{ type: "text", text: `Weather for ${args.city}: 21°C, clear.` }],
    structuredContent: { temperature: 21, conditions: "clear" },
  };
});

// Logs go to stderr, never stdout.
process.stderr.write("good-weather server ready\n");

const transport = new StdioServerTransport();
await server.connect(transport);
