import { afterEach, expect, it, vi } from "vitest";
import { Engine } from "../src/engine/engine.js";
import { loadTrace } from "../src/engine/trace.js";
import { YesNoQuestion } from "../src/checks/types.js";
import { batch, hex, makeRoots, span, until, type TestRoots } from "./helpers.js";

let tb: TestRoots | undefined;
afterEach(async () => { vi.restoreAllMocks(); await tb?.close(); tb = undefined; });

async function setup() {
  tb = await makeRoots({ noEngine: true });
  const roots = tb.roots;
  const traceId = hex(16), spanId = hex(8);
  roots.store.ingest([batch([span({ traceId, spanId, name: "agent", kind: "workflow" })])]);
  const engine = new Engine(roots, roots.llm, roots.decisions, roots.checks, roots.steering);
  const run = engine["liveRun"](traceId)!;
  const check = YesNoQuestion.parse({ id: "overlap-test", kind: "yes_no", ask: "Did the agent fail?", scope: "trace" });
  vi.spyOn(roots.decisions, "decide").mockResolvedValue({
    answers: { [check.id]: { name: check.id, type: "yes_no", probability: 0.99, distribution: { yes: 0.99, no: 0.01 } } },
    backend: "test", model: "fixture", latencyMs: 0,
  });
  vi.spyOn(roots.llm, "isAvailable").mockResolvedValue(true);
  const release: (() => void)[] = [];
  vi.spyOn(roots.llm, "chat").mockImplementation(async () => {
    await new Promise<void>(resolve => release.push(resolve));
    return { json: { quote: "the tool failed", shows_problem: true } } as Awaited<ReturnType<typeof roots.llm.chat>>;
  });
  const evaluate = () => engine["decideAndApply"](run, check, {}, "the tool failed", [spanId], loadTrace(roots.store, traceId), null);
  return { roots, engine, run, traceId, check, release, evaluate };
}

it("rechecks deduplication after two second-opinion calls overlap", async () => {
  const t = await setup();
  const first = t.evaluate(), second = t.evaluate();
  await until(() => t.release.length === 2);
  t.release.splice(0).forEach(resolve => resolve());
  await Promise.all([first, second]);
  expect(t.roots.store.findingsForTrace(t.traceId).filter(f => f.check_id === t.check.id)).toHaveLength(1);
});

it.each(["deleted", "superseded"] as const)("does not persist in-flight findings for a %s run", async (action) => {
  const t = await setup();
  const pending = t.evaluate();
  await until(() => t.release.length === 1);
  if (action === "deleted") t.roots.store.deleteRun(t.traceId);
  else {
    // recheck's generation boundary: the same stored run now has a different LiveRun.
    t.engine["live"].delete(t.traceId);
    t.engine["liveRun"](t.traceId);
  }
  t.release.splice(0).forEach(resolve => resolve());
  await pending;
  expect(t.roots.store.findingsForTrace(t.traceId)).toEqual([]);
});
