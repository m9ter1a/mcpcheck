import type { Finding, Snapshot } from "../types.js";

// Check A — protocol & handshake hygiene.
export function protocolRules(s: Snapshot): Finding[] {
  const out: Finding[] = [];

  if (!s.connected) {
    out.push({
      id: "connect-failed",
      category: "protocol",
      severity: "error",
      title: "Handshake failed",
      detail: s.connectError
        ? `Could not initialize the server: ${s.connectError}`
        : "Could not complete the MCP initialize handshake.",
    });
    return out; // nothing else is meaningful if we never connected
  }

  // Flagship check: logs on stdout break JSON-RPC framing over stdio.
  if (s.stdoutPollution.length > 0) {
    out.push({
      id: "stdout-pollution",
      category: "protocol",
      severity: "error",
      title: "Non-JSON output on stdout",
      detail:
        "The server wrote non-JSON-RPC data to stdout, which corrupts the stdio " +
        `transport for the agent. First offending line: ${truncate(s.stdoutPollution[0], 160)}. ` +
        "Send all logs to stderr instead.",
    });
  }

  const declaresTools = !!s.capabilities?.tools;
  if (s.toolsListError) {
    out.push({
      id: "tools-list-error",
      category: "protocol",
      severity: "error",
      title: "tools/list failed",
      detail: `The server declares tools but tools/list errored: ${s.toolsListError}`,
    });
  } else if (declaresTools && s.tools.length === 0) {
    out.push({
      id: "tools-capability-empty",
      category: "protocol",
      severity: "warn",
      title: "Declares tools but exposes none",
      detail: "capabilities.tools is advertised, yet tools/list returned an empty list.",
    });
  } else if (!declaresTools && s.tools.length > 0) {
    out.push({
      id: "tools-capability-missing",
      category: "protocol",
      severity: "warn",
      title: "Tools without a tools capability",
      detail: "tools/list returns tools, but the server did not advertise the tools capability.",
    });
  }

  if (s.unknownMethod?.ran) {
    if (s.unknownMethod.crashed) {
      out.push({
        id: "unknown-method-crash",
        category: "protocol",
        severity: "error",
        title: "Unknown method is not handled",
        detail:
          "Calling an unsupported method crashed the connection instead of returning a " +
          `JSON-RPC error. ${s.unknownMethod.detail ?? ""}`.trim(),
      });
    } else if (!s.unknownMethod.properError) {
      out.push({
        id: "unknown-method-weak",
        category: "protocol",
        severity: "warn",
        title: "Unknown method: unexpected response",
        detail:
          "An unsupported method did not return a standard JSON-RPC 'method not found' error. " +
          `${s.unknownMethod.detail ?? ""}`.trim(),
      });
    }
  }

  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
