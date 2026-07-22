// A minimal, well-behaved MCP server over streamable HTTP, used to exercise
// mcpcheck's HTTP transport in tests. Stateful session pattern (the one the
// official servers use): a transport per session, keyed by the mcp-session-id
// header. Raw node:http, no express dependency. Listens on $PORT (default 3010).
import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3010;

const tools = [
  {
    name: "ping_host",
    description:
      "Check whether a network host is reachable and report the round-trip time in milliseconds.",
    inputSchema: {
      type: "object",
      properties: { host: { type: "string", description: "Hostname or IP address to ping." } },
      required: ["host"],
    },
    outputSchema: {
      type: "object",
      properties: { reachable: { type: "boolean" }, rttMs: { type: "number" } },
      required: ["reachable"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "lookup_dns",
    description:
      "Resolve a domain name to its A and AAAA records so the agent can inspect where it points.",
    inputSchema: {
      type: "object",
      properties: { domain: { type: "string", description: "Domain name to resolve, e.g. 'example.com'." } },
      required: ["domain"],
    },
    outputSchema: {
      type: "object",
      properties: { addresses: { type: "array", items: { type: "string" } } },
      required: ["addresses"],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
];

function buildMcpServer() {
  const server = new Server({ name: "http-fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, () => ({
    content: [{ type: "text", text: "ok" }],
  }));
  return server;
}

const transports = new Map();

const httpServer = createHttpServer(async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport && req.method === "POST") {
    // First request of a session (initialize): spin up a fresh transport.
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => transports.set(sid, transport),
    });
    transport.onclose = () => {
      if (transport.sessionId) transports.delete(transport.sessionId);
    };
    await buildMcpServer().connect(transport);
  }

  if (!transport) {
    res.statusCode = 400;
    res.end("Missing or unknown mcp-session-id");
    return;
  }

  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = undefined;
      }
      await transport.handleRequest(req, res, parsed);
    });
  } else {
    await transport.handleRequest(req, res);
  }
});

httpServer.listen(PORT, () => process.stderr.write(`http-fixture listening on ${PORT}\n`));
