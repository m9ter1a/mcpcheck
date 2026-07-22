import { McpError, EmptyResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Session } from "./client.js";
import type { ProbeResult, ToolInfo } from "./types.js";
import { withTimeout } from "./client.js";
import { jsonTokens } from "./tokens.js";

export interface ProbeOptions {
  allowWrite: boolean;
  timeoutMs: number;
}

// Secret / sensitive-path patterns we do not want leaking in error text.
const LEAK_PATTERNS: Array<[string, RegExp]> = [
  ["absolute Windows path", /[A-Za-z]:\\Users\\[^\s"']+/],
  ["absolute POSIX home path", /\/(?:home|Users)\/[^\s"']+/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["OpenAI-style key", /sk-[A-Za-z0-9]{20,}/],
  ["bearer token", /bearer\s+[A-Za-z0-9._-]{20,}/i],
  ["generic secret assignment", /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"]?[^\s'"]{6,}/i],
];

function findLeaks(text: string): string[] {
  const hits: string[] = [];
  for (const [label, re] of LEAK_PATTERNS) {
    if (re.test(text)) hits.push(label);
  }
  return hits;
}

function isEligible(t: ToolInfo, allowWrite: boolean): boolean {
  if (allowWrite) return true;
  // Safe default: only exercise tools that explicitly declare themselves read-only.
  return t.annotations?.readOnlyHint === true;
}

export async function runProbes(session: Session, opts: ProbeOptions): Promise<void> {
  const { snapshot } = session;
  if (!snapshot.connected) return;

  await probeUnknownMethod(session, opts);

  for (const tool of snapshot.tools) {
    if (!isEligible(tool, opts.allowWrite)) continue;
    snapshot.probes.push(await probeCall(session, tool, "empty-args", {}, opts));
    snapshot.probes.push(
      await probeCall(session, tool, "invalid-args", { __mcpcheck_invalid__: { nested: [1, 2, 3] } }, opts),
    );
  }
}

async function probeCall(
  session: Session,
  tool: ToolInfo,
  kind: "empty-args" | "invalid-args",
  args: Record<string, unknown>,
  opts: ProbeOptions,
): Promise<ProbeResult> {
  const { client } = session;
  const result: ProbeResult = { tool: tool.name, kind, responded: false };
  const started = Date.now();
  try {
    const res: any = await withTimeout(
      client.callTool({ name: tool.name, arguments: args }),
      opts.timeoutMs,
      `callTool(${tool.name})`,
    );
    result.latencyMs = Date.now() - started;
    result.responded = true;
    result.isError = res?.isError === true;
    result.responseTokens = jsonTokens(res?.content ?? res);
    const text = JSON.stringify(res ?? "");
    const leaks = findLeaks(text);
    if (leaks.length) result.leaks = leaks;
  } catch (err: any) {
    result.latencyMs = Date.now() - started;
    if (err instanceof McpError) {
      // A JSON-RPC error is an acceptable, well-structured failure.
      result.responded = true;
      result.protocolError = true;
      result.message = err.message;
      const leaks = findLeaks(err.message ?? "");
      if (leaks.length) result.leaks = leaks;
    } else {
      result.crashed = true;
      result.message = err?.message ?? String(err);
    }
  }
  return result;
}

async function probeUnknownMethod(session: Session, opts: ProbeOptions): Promise<void> {
  const { client, snapshot } = session;
  snapshot.unknownMethod = { ran: true };
  try {
    await withTimeout(
      client.request({ method: "mcpcheck/does-not-exist", params: {} } as any, EmptyResultSchema),
      opts.timeoutMs,
      "unknown-method",
    );
    // Resolving is odd — a server should not accept an unknown method.
    snapshot.unknownMethod.properError = false;
    snapshot.unknownMethod.detail = "The server returned a success result for an unsupported method.";
  } catch (err: any) {
    if (err instanceof McpError) {
      snapshot.unknownMethod.properError = true;
    } else {
      snapshot.unknownMethod.properError = false;
      snapshot.unknownMethod.detail = err?.message ?? String(err);
    }
  }
  // Confirm the connection is still usable afterwards.
  try {
    await withTimeout(client.ping(), opts.timeoutMs, "ping");
  } catch (err: any) {
    snapshot.unknownMethod.crashed = true;
    snapshot.unknownMethod.detail = `Connection unusable after the call: ${err?.message ?? err}`;
  }
}
