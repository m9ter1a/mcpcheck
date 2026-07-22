import { describe, it, expect } from "vitest";
import { runRules } from "../dist/rules/index.js";

// Minimal snapshot factory — only the fields the rules read.
function snap(overrides: Record<string, unknown> = {}) {
  return {
    target: "test",
    transport: "stdio",
    connected: true,
    capabilities: { tools: {} },
    tools: [],
    stdoutPollution: [],
    transportErrors: [],
    probes: [],
    ...overrides,
  } as any;
}

function tool(overrides: Record<string, unknown> = {}) {
  return {
    name: "do_thing",
    description: "Does a thing in a reasonably descriptive sentence for the agent to read.",
    inputSchema: { type: "object", properties: {}, required: [] },
    ...overrides,
  };
}

const ids = (findings: any[]) => findings.map((f) => f.id);

describe("protocol rules", () => {
  it("flags non-JSON output on stdout", () => {
    const f = runRules(snap({ stdoutPollution: ["Unexpected token ..."] }));
    expect(ids(f)).toContain("stdout-pollution");
  });

  it("gives a connect-failed error when not connected", () => {
    const f = runRules(snap({ connected: false, connectError: "boom" }));
    expect(ids(f)).toContain("connect-failed");
  });

  it("flags a declared tools capability with no tools", () => {
    const f = runRules(snap({ tools: [] }));
    expect(ids(f)).toContain("tools-capability-empty");
  });
});

describe("schema rules", () => {
  it("flags duplicate tool names", () => {
    const f = runRules(snap({ tools: [tool({ name: "search" }), tool({ name: "search" })] }));
    expect(ids(f)).toContain("duplicate-name");
  });

  it("flags an inputSchema that is not an object schema", () => {
    const f = runRules(snap({ tools: [tool({ inputSchema: { type: "string" } })] }));
    expect(ids(f)).toContain("input-schema-not-object");
  });

  it("flags an empty description", () => {
    const f = runRules(snap({ tools: [tool({ description: "" })] }));
    expect(ids(f)).toContain("missing-description");
  });

  it("does NOT flag consistent kebab-case names (regression guard)", () => {
    const f = runRules(
      snap({ tools: [tool({ name: "get-thing" }), tool({ name: "list-things" })] }),
    );
    expect(ids(f)).not.toContain("invalid-tool-name");
    expect(ids(f)).not.toContain("inconsistent-naming");
    expect(ids(f)).not.toContain("mixedcase-tool-name");
  });

  it("flags mixed snake_case and kebab-case as inconsistent", () => {
    const f = runRules(
      snap({ tools: [tool({ name: "get_thing" }), tool({ name: "list-things" })] }),
    );
    expect(ids(f)).toContain("inconsistent-naming");
  });

  it("flags capitals and unsafe characters in names", () => {
    const upper = runRules(snap({ tools: [tool({ name: "GetThing" })] }));
    expect(ids(upper)).toContain("mixedcase-tool-name");
    const unsafe = runRules(snap({ tools: [tool({ name: "get thing!" })] }));
    expect(ids(unsafe)).toContain("invalid-tool-name");
  });

  it("flags a mutating tool without safety annotations", () => {
    const f = runRules(snap({ tools: [tool({ name: "delete_records", description: "Delete records." })] }));
    expect(ids(f)).toContain("missing-danger-annotation");
  });
});

describe("context rules", () => {
  it("flags too many tools", () => {
    const many = Array.from({ length: 61 }, (_, i) => tool({ name: `tool_${i}` }));
    const f = runRules(snap({ tools: many }));
    expect(ids(f)).toContain("too-many-tools");
  });

  it("clusters near-duplicate tools into a single overlap finding", () => {
    const dupes = Array.from({ length: 5 }, (_, i) =>
      tool({ name: `legacy_action_${i}`, description: "Performs a legacy action kept for backwards compatibility." }),
    );
    const f = runRules(snap({ tools: dupes }));
    expect(ids(f).filter((id) => id === "overlapping-tools").length).toBe(1);
  });
});
