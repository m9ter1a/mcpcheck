import type { Finding, Snapshot } from "../types.js";
import { protocolRules } from "./protocol.js";
import { schemaRules } from "./schema.js";
import { contextRules } from "./context.js";
import { probeRules } from "./probes.js";

// A rule is a pure function from the final snapshot to findings.
export type Rule = (s: Snapshot) => Finding[];

const RULES: Rule[] = [protocolRules, schemaRules, contextRules, probeRules];

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 } as const;

export function runRules(s: Snapshot): Finding[] {
  const findings = RULES.flatMap((rule) => rule(s));
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return findings;
}
