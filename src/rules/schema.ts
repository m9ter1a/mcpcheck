import type { Finding, Snapshot, ToolInfo } from "../types.js";

// Tool names: both snake_case and kebab-case are valid and common (the official
// reference servers use kebab-case). We only flag genuinely machine-hostile
// names — spaces / stray characters, capitals — and, at the server level, a
// mix of conventions. We do NOT impose snake_case as the one true style.
const VALID_NAME = /^[a-zA-Z0-9_-]+$/;
const HAS_UPPER = /[A-Z]/;
const MULTI_SNAKE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;
const MULTI_KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const DANGER_WORDS = /\b(delete|remove|drop|destroy|write|update|create|send|kill|reset|purge|revoke)\b/i;
const DANGER_NAME = /(delete|remove|drop|destroy|write|update|create|send|kill|reset|purge|revoke)/i;

// Check B — schema hygiene: descriptions, input schemas, names, annotations.
export function schemaRules(s: Snapshot): Finding[] {
  const out: Finding[] = [];
  if (!s.connected || s.tools.length === 0) return out;

  const seen = new Map<string, number>();
  for (const t of s.tools) {
    seen.set(t.name, (seen.get(t.name) ?? 0) + 1);
  }
  for (const [name, count] of seen) {
    if (count > 1) {
      out.push({
        id: "duplicate-name",
        category: "schema",
        severity: "error",
        title: "Duplicate tool name",
        detail: `The name "${name}" is used by ${count} tools; the agent cannot address them apart.`,
        tool: name,
      });
    }
  }

  // Server-level: a consistent convention matters more than which one it is.
  const usesSnake = s.tools.some((t) => MULTI_SNAKE.test(t.name));
  const usesKebab = s.tools.some((t) => MULTI_KEBAB.test(t.name));
  if (usesSnake && usesKebab) {
    out.push({
      id: "inconsistent-naming",
      category: "schema",
      severity: "warn",
      title: "Inconsistent tool naming",
      detail:
        "Tool names mix snake_case and kebab-case. Pick one convention so the agent sees a consistent surface.",
    });
  }

  for (const t of s.tools) {
    out.push(...toolSchemaFindings(t));
  }

  return out;
}

function toolSchemaFindings(t: ToolInfo): Finding[] {
  const out: Finding[] = [];
  const desc = (t.description ?? "").trim();

  if (!desc) {
    out.push({
      id: "missing-description",
      category: "schema",
      severity: "warn",
      title: "Tool has no description",
      detail: "An agent picks tools mostly by their description; an empty one is nearly invisible.",
      tool: t.name,
    });
  }

  const schema = t.inputSchema as Record<string, unknown> | undefined;
  if (!schema || typeof schema !== "object") {
    out.push({
      id: "missing-input-schema",
      category: "schema",
      severity: "error",
      title: "Missing inputSchema",
      detail: "The tool has no valid inputSchema, so the agent has no idea how to call it.",
      tool: t.name,
    });
  } else {
    if (schema.type !== "object") {
      out.push({
        id: "input-schema-not-object",
        category: "schema",
        severity: "error",
        title: "inputSchema is not an object schema",
        detail: `inputSchema.type should be "object" but is ${JSON.stringify(schema.type)}.`,
        tool: t.name,
      });
    }
    const props = schema.properties as Record<string, unknown> | undefined;
    const hasProps = props && Object.keys(props).length > 0;
    if (hasProps) {
      const required = schema.required as unknown[] | undefined;
      if (!Array.isArray(required) || required.length === 0) {
        out.push({
          id: "no-required-fields",
          category: "schema",
          severity: "info",
          title: "No required fields declared",
          detail:
            "inputSchema defines properties but no `required` array; the agent cannot tell " +
            "which arguments are mandatory.",
          tool: t.name,
        });
      }
      // Individual parameters with no description.
      const undescribed = Object.entries(props!)
        .filter(([, v]) => !(v && typeof v === "object" && "description" in (v as object)))
        .map(([k]) => k);
      if (undescribed.length > 0) {
        out.push({
          id: "undescribed-params",
          category: "schema",
          severity: "info",
          title: "Parameters without descriptions",
          detail: `Parameters lack a description: ${undescribed.join(", ")}.`,
          tool: t.name,
        });
      }
    }
  }

  if (!VALID_NAME.test(t.name)) {
    out.push({
      id: "invalid-tool-name",
      category: "schema",
      severity: "warn",
      title: "Unsafe tool name",
      detail: `"${t.name}" contains spaces or characters outside [A-Za-z0-9_-]; many function-calling APIs reject such names.`,
      tool: t.name,
    });
  } else if (HAS_UPPER.test(t.name)) {
    out.push({
      id: "mixedcase-tool-name",
      category: "schema",
      severity: "warn",
      title: "Mixed-case tool name",
      detail: `"${t.name}" uses capital letters; lowercase snake_case or kebab-case addresses more predictably.`,
      tool: t.name,
    });
  }

  // Danger annotations: if the tool looks mutating but declares nothing, the
  // agent cannot tell it is unsafe.
  const a = t.annotations;
  const looksDangerous = DANGER_NAME.test(t.name) || DANGER_WORDS.test(desc);
  const hasSafetyHint = a && (a.readOnlyHint !== undefined || a.destructiveHint !== undefined);
  if (looksDangerous && !hasSafetyHint) {
    out.push({
      id: "missing-danger-annotation",
      category: "schema",
      severity: "warn",
      title: "Mutating tool without safety hints",
      detail:
        "The tool looks like it changes state but declares neither readOnlyHint nor " +
        "destructiveHint, so an agent cannot know it is dangerous.",
      tool: t.name,
    });
  } else if (!a) {
    out.push({
      id: "no-annotations",
      category: "schema",
      severity: "info",
      title: "No annotations",
      detail: "No annotations (readOnlyHint / destructiveHint / …) to guide safe use.",
      tool: t.name,
    });
  }

  if (!t.outputSchema) {
    out.push({
      id: "no-output-schema",
      category: "schema",
      severity: "info",
      title: "No outputSchema",
      detail: "Without an outputSchema the agent cannot anticipate the shape of the result.",
      tool: t.name,
    });
  }

  return out;
}
