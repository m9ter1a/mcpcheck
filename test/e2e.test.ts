import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect, parseTarget } from "../dist/client.js";
import { runProbes } from "../dist/probes.js";
import { runRules } from "../dist/rules/index.js";
import { score } from "../dist/score.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = (name: string) => join(root, "test", "fixtures", name);

async function audit(argv: string[], { probes = false } = {}) {
  const session = await connect(parseTarget(argv), 15000);
  try {
    if (probes && session.snapshot.connected) {
      await runProbes(session, { allowWrite: false, timeoutMs: 15000 });
    }
  } finally {
    await session.close();
  }
  const findings = runRules(session.snapshot);
  return score(session.snapshot, findings);
}

describe("stdio e2e", () => {
  it("grades the good fixture A", async () => {
    const r = await audit([fixture("good-server.js")]);
    expect(r.snapshot.connected).toBe(true);
    expect(r.grade).toBe("A");
  });

  it("grades the bad fixture F and detects stdout pollution", async () => {
    const r = await audit([fixture("bad-server.js")]);
    expect(r.snapshot.connected).toBe(true);
    expect(r.grade).toBe("F");
    expect(r.findings.map((f) => f.id)).toContain("stdout-pollution");
  });

  it("hard-fails a server that cannot start", async () => {
    const r = await audit([fixture("does-not-exist.js")]);
    expect(r.snapshot.connected).toBe(false);
    expect(r.overall).toBe(0);
  });
});

describe("http e2e", () => {
  let child: ChildProcess;
  const port = 3100 + Math.floor(Math.random() * 500);
  const url = `http://localhost:${port}/mcp`;

  beforeAll(async () => {
    child = spawn(process.execPath, [fixture("http-server.js")], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "ignore", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("http fixture did not start")), 10000);
      child.stderr!.on("data", (d) => {
        if (String(d).includes("listening")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("error", reject);
    });
  });

  afterAll(() => {
    child?.kill();
  });

  it("connects over HTTP and grades the fixture A", async () => {
    const r = await audit([url]);
    expect(r.snapshot.connected).toBe(true);
    expect(r.snapshot.transport).toBe("http");
    expect(r.snapshot.tools.length).toBe(2);
    expect(r.grade).toBe("A");
  });

  it("runs dynamic probes over HTTP", async () => {
    const r = await audit([url], { probes: true });
    expect(r.snapshot.probes.length).toBeGreaterThan(0);
    // The fixture accepts any arguments, so it should trip weak-validation.
    expect(r.findings.map((f) => f.id)).toContain("weak-validation");
  });
});
