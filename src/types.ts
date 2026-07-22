// Core data model shared across the pipeline:
//   connect -> introspect (Snapshot) -> rules/probes (Finding[]) -> score -> render

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  title?: string;
}

export interface ProbeResult {
  tool: string;
  kind: "empty-args" | "invalid-args";
  /** We got a well-formed response of some kind (not a crash / transport death). */
  responded: boolean;
  /** Tool signalled a domain error the right way (result with isError: true). */
  isError?: boolean;
  /** Server answered with a JSON-RPC / MCP protocol error (also acceptable). */
  protocolError?: boolean;
  /** The process died or the transport broke — the bad outcome. */
  crashed?: boolean;
  latencyMs?: number;
  responseTokens?: number;
  /** Secrets / absolute paths spotted leaking in the response text. */
  leaks?: string[];
  message?: string;
}

export interface UnknownMethodProbe {
  ran: boolean;
  properError?: boolean; // rejected with a JSON-RPC error, not a crash
  crashed?: boolean;
  detail?: string;
}

export interface Snapshot {
  target: string;
  transport: "stdio" | "http";
  connected: boolean;
  connectError?: string;
  serverInfo?: { name: string; version: string };
  instructions?: string;
  capabilities?: Record<string, unknown>;
  tools: ToolInfo[];
  toolsListError?: string;
  /** Non-JSON-RPC lines the server wrote to stdout (protocol-breaking). */
  stdoutPollution: string[];
  transportErrors: string[];
  probes: ProbeResult[];
  unknownMethod?: UnknownMethodProbe;
}

export type Severity = "error" | "warn" | "info";
export type Category = "protocol" | "schema" | "context" | "probes";

export interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  detail: string;
  tool?: string;
}

export interface CategoryScore {
  category: Category;
  score: number; // 0..100
}

export interface Report {
  snapshot: Snapshot;
  findings: Finding[];
  categories: CategoryScore[];
  overall: number; // 0..100
  grade: string; // A..F
}
