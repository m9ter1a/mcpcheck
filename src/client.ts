import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { z } from "zod";
import type { Snapshot, ToolInfo } from "./types.js";

// Deliberately permissive: the official client rejects a whole tools/list if a
// single tool has a non-conformant schema, which would blind us to exactly the
// servers most worth auditing. mcpcheck reads leniently, then critiques.
const LooseToolsResult = z.object({ tools: z.array(z.record(z.string(), z.unknown())) });

export interface ConnectTarget {
  transport: "stdio" | "http";
  raw: string;
  // stdio
  command?: string;
  args?: string[];
  // http
  url?: string;
}

export interface Session {
  client: Client;
  snapshot: Snapshot;
  close: () => Promise<void>;
}

/**
 * Turn CLI arguments into a connection target.
 *
 * Rules:
 *   - starts with http(s)://           -> streamable HTTP transport
 *   - a single *.js/*.mjs/*.cjs path   -> spawn the current node on it
 *   - a single *.py path               -> spawn `python`
 *   - anything else                    -> treat argv as [command, ...args]
 */
export function parseTarget(argv: string[]): ConnectTarget {
  if (argv.length === 0) {
    throw new Error("no target given");
  }
  const first = argv[0];
  if (/^https?:\/\//i.test(first)) {
    return { transport: "http", raw: first, url: first };
  }

  if (argv.length === 1) {
    const p = first;
    if (/\.(mjs|cjs|js)$/i.test(p)) {
      return { transport: "stdio", raw: p, command: process.execPath, args: [p] };
    }
    if (/\.py$/i.test(p)) {
      return { transport: "stdio", raw: p, command: "python", args: [p] };
    }
  }

  return { transport: "stdio", raw: argv.join(" "), command: argv[0], args: argv.slice(1) };
}

function normalizeTool(t: any): ToolInfo {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema,
    annotations: t.annotations,
    title: t.title,
  };
}

const STDOUT_POLLUTION_HINTS = [/json/i, /parse/i, /unexpected token/i, /not valid/i];

export async function connect(target: ConnectTarget, timeoutMs: number): Promise<Session> {
  const snapshot: Snapshot = {
    target: target.raw,
    transport: target.transport,
    connected: false,
    tools: [],
    stdoutPollution: [],
    transportErrors: [],
    probes: [],
  };

  const client = new Client({ name: "mcpcheck", version: "0.1.0" }, { capabilities: {} });

  let transport: Transport;
  if (target.transport === "http") {
    transport = new StreamableHTTPClientTransport(new URL(target.url!));
  } else {
    transport = new StdioClientTransport({
      command: target.command!,
      args: target.args ?? [],
      stderr: "pipe", // keep the server's own logging out of our parsing
    });
  }

  transport.onerror = (err: Error) => {
    const msg = err?.message ?? String(err);
    snapshot.transportErrors.push(msg);
    // A server that writes plain logs to stdout breaks the JSON-RPC framing;
    // the read buffer surfaces that as a JSON parse error. This is check A's
    // flagship signal.
    if (STDOUT_POLLUTION_HINTS.some((re) => re.test(msg))) {
      snapshot.stdoutPollution.push(msg);
    }
  };

  const close = async () => {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  };

  try {
    await withTimeout(client.connect(transport), timeoutMs, "connect");
    snapshot.connected = true;

    const v = client.getServerVersion();
    if (v) snapshot.serverInfo = { name: v.name, version: v.version };
    snapshot.capabilities = client.getServerCapabilities() as Record<string, unknown> | undefined;
    snapshot.instructions = client.getInstructions();

    if (snapshot.capabilities?.tools) {
      try {
        const res = await withTimeout(
          client.request({ method: "tools/list", params: {} } as any, LooseToolsResult),
          timeoutMs,
          "tools/list",
        );
        snapshot.tools = (res.tools ?? []).map(normalizeTool);
      } catch (err: any) {
        snapshot.toolsListError = err?.message ?? String(err);
      }
    }
  } catch (err: any) {
    snapshot.connectError = err?.message ?? String(err);
  }

  return { client, snapshot, close };
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
