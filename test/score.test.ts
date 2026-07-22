import { describe, it, expect } from "vitest";
import { score, grade } from "../dist/score.js";

function snap(overrides: Record<string, unknown> = {}) {
  return {
    target: "test",
    transport: "stdio",
    connected: true,
    capabilities: { tools: {} },
    tools: [{ name: "a", inputSchema: { type: "object" } }],
    stdoutPollution: [],
    transportErrors: [],
    probes: [],
    ...overrides,
  } as any;
}

const finding = (over: Record<string, unknown> = {}) => ({
  id: "x",
  category: "schema",
  severity: "info",
  title: "t",
  detail: "d",
  ...over,
});

describe("grade thresholds", () => {
  it("maps scores to letters", () => {
    expect(grade(95)).toBe("A");
    expect(grade(85)).toBe("B");
    expect(grade(75)).toBe("C");
    expect(grade(65)).toBe("D");
    expect(grade(40)).toBe("F");
  });
});

describe("score", () => {
  it("gives a perfect score with no findings", () => {
    const r = score(snap(), []);
    expect(r.overall).toBe(100);
    expect(r.grade).toBe("A");
  });

  it("hard-fails a server that never connected", () => {
    const r = score(snap({ connected: false }), []);
    expect(r.overall).toBe(0);
    expect(r.grade).toBe("F");
  });

  it("caps repeated occurrences of one rule (PER_RULE_CAP)", () => {
    // 20 identical info findings must not exceed the 5-occurrence cap: 5 * 3 = 15.
    const findings = Array.from({ length: 20 }, (_, i) => finding({ tool: `t${i}` }));
    const r = score(snap(), findings as any);
    const schema = r.categories.find((c) => c.category === "schema");
    expect(schema?.score).toBe(85); // 100 - 15, not 100 - 60
  });

  it("drops non-applicable categories from the weighting", () => {
    // No probes were run, so the probes category should be absent.
    const r = score(snap(), []);
    expect(r.categories.map((c) => c.category)).not.toContain("probes");
  });
});
