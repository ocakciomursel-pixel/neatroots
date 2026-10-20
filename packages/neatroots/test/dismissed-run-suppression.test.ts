import { afterEach, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { batch, hex, makeRoots, span, toolSpan, until, type TestRoots } from "./helpers.js";

let tb: TestRoots | undefined;
afterEach(async () => { await tb?.close(); tb = undefined; });

it("keeps a dismissed rule suppressed across new batches and rechecks, but not new runs", async () => {
  tb = await makeRoots();
  tb.roots.steering.setMode("test-agent", "advisory");
  const trace = hex(16), root = hex(8);
  const start = (traceId: string, spanId: string) => {
    const agent = span({ traceId, spanId, name: "agent", kind: "workflow" });
    agent.endTimeUnixNano = "0";
    tb!.roots.ingest([batch([agent])]);
  };
  const more = (traceId: string, parent: string, count: number) => {
    for (let i = 0; i < count; i++) tb!.roots.ingest([batch([toolSpan(traceId, parent, "lookup_order", '{"order_id":"4512"}', "ok")])]);
  };
  start(trace, root); more(trace, root, 3);
  const finding = await until(() => tb!.roots.store.findingsForTrace(trace).find(f => f.check_id === "repeated-tool-call"));
  const app = createApp(tb.roots);
  const response = await app.request(`http://localhost:4100/api/findings/${finding.id}`, {
    method: "POST", headers: { host: `localhost:${tb.roots.config.port}`, "content-type": "application/json" }, body: JSON.stringify({ status: "dismissed" }),
  });
  expect(response.status).toBe(200);
  const notesBefore = tb.roots.store.notesForTrace(trace).length;
  more(trace, root, 1);
  await tb.roots.engine!.waitIdle(trace, 5000);
  await tb.roots.engine!.recheck(trace);
  const sameCheck = tb.roots.store.findingsForTrace(trace).filter(f => f.check_id === "repeated-tool-call");
  expect(sameCheck.map(f => ({ id: f.id, status: f.status }))).toEqual([{ id: finding.id, status: "dismissed" }]);
  expect(tb.roots.store.openFindingFor(trace, "repeated-tool-call")).toBeUndefined();
  expect(tb.roots.store.notesForTrace(trace)).toHaveLength(notesBefore);
  const nextTrace = hex(16), nextRoot = hex(8);
  start(nextTrace, nextRoot); more(nextTrace, nextRoot, 3);
  const next = await until(() => tb!.roots.store.openFindingFor(nextTrace, "repeated-tool-call"));
  expect(next.status).toBe("raised");
});
