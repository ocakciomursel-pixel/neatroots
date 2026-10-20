import { kvToPlain, type OtlpSpan } from "../otlp/types.js";

function nano(value: string): bigint | undefined {
  return /^\d+$/.test(value) ? BigInt(value) : undefined;
}

function visibleText(value: unknown): boolean {
  if (typeof value === "string") {
    try { return visibleText(JSON.parse(value)); } catch { return value.length > 0; }
  }
  if (!value || typeof value !== "object") return false;
  const chunk = value as Record<string, unknown>;
  if (chunk.type === "response.output_text.delta") return typeof chunk.delta === "string" && chunk.delta.length > 0;
  if (!Array.isArray(chunk.choices)) return false;
  return chunk.choices.some((choice: unknown) => {
    if (!choice || typeof choice !== "object") return false;
    const delta = (choice as { delta?: { content?: unknown } }).delta;
    return typeof delta?.content === "string" && delta.content.length > 0;
  });
}

/** Derived only: stored telemetry stays lossless. Unknown observations are never zero. */
export function streamTiming(span: OtlpSpan): { first_chunk_ms: number | null; first_text_ms: number | null } {
  const result = { first_chunk_ms: null as number | null, first_text_ms: null as number | null };
  const start = nano(span.startTimeUnixNano);
  const end = nano(span.endTimeUnixNano);
  if (start === undefined) return result;
  const elapsed = (time: string) => {
    const ns = nano(time);
    if (ns === undefined || ns < start || (end !== undefined && end > 0n && ns > end)) return null;
    const ms = Number(ns - start) / 1e6;
    return Number.isFinite(ms) ? ms : null;
  };
  const attrs = kvToPlain(span.attributes);
  const seconds = attrs["gen_ai.response.time_to_first_chunk"];
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 && Number.isFinite(seconds * 1000)) {
    result.first_chunk_ms = seconds * 1000;
  }
  const chunks = span.events.filter(e => e.name === "neatlogs.stream.chunk").map(e => ({
    ms: elapsed(e.timeUnixNano), attrs: kvToPlain(e.attributes),
  })).filter((e): e is typeof e & { ms: number } => e.ms !== null).sort((a, b) => a.ms - b.ms);
  const first = chunks.find(e => e.attrs["neatlogs.stream.chunk.index"] === 0);
  if (first && result.first_chunk_ms === null) result.first_chunk_ms = first.ms;
  // A gap or missing payload may have contained the first visible text; don't guess past it.
  let expected = 0;
  if ((span.droppedEventsCount ?? 0) > 0) return result;
  for (const event of chunks) {
    if (event.attrs["neatlogs.stream.chunk.index"] !== expected++) break;
    const value = event.attrs["neatlogs.stream.chunk.value"];
    if (value === undefined || value === null) break;
    if (visibleText(value)) { result.first_text_ms = event.ms; break; }
  }
  return result;
}
