import { describe, expect, it } from "vitest";
import { streamTiming } from "../src/semantics/stream-timing.js";
import type { OtlpSpan } from "../src/otlp/types.js";
const start = 1_800_000_000_000_000_000n;
const chunk = (index: number, ms: number, value?: unknown) => ({name:"neatlogs.stream.chunk",timeUnixNano:String(start+BigInt(ms*1e6)),attributes:[{key:"neatlogs.stream.chunk.index",value:{intValue:String(index)}},...(value === undefined?[]:[{key:"neatlogs.stream.chunk.value",value:{stringValue:JSON.stringify(value)}}])]});
const span = (events: OtlpSpan["events"] = []): OtlpSpan => ({traceId:"a".repeat(32),spanId:"b".repeat(16),parentSpanId:"",name:"stream",kind:1,startTimeUnixNano:String(start),endTimeUnixNano:String(start+927000000n),attributes:[],events,links:[],status:{code:1}});
describe("stream timing",()=>{
 it("distinguishes role, reasoning, tools and visible text, despite event order",()=>{
  const s=span([chunk(3,494,{choices:[{delta:{content:"Hello"}}]}),chunk(1,220,{choices:[{delta:{reasoning_content:"thinking"}}]}),chunk(0,190,{choices:[{delta:{role:"assistant",content:""}}]}),chunk(2,250,{choices:[{delta:{tool_calls:[{}]}}]})]);
  const before=JSON.stringify(s);expect(streamTiming(s)).toEqual({first_chunk_ms:190,first_text_ms:494});expect(JSON.stringify(s)).toBe(before);
 });
 it("keeps missing events and summary-only payloads unknown",()=>{expect(streamTiming(span())).toEqual({first_chunk_ms:null,first_text_ms:null});expect(streamTiming(span([chunk(0,190),chunk(1,494,"Hello")]))).toEqual({first_chunk_ms:190,first_text_ms:null});});
 it("does not infer the first observation across missing indices",()=>{expect(streamTiming(span([chunk(2,494,"Hello")]))).toEqual({first_chunk_ms:null,first_text_ms:null});});
 it("accepts standard seconds and true zero",()=>{const s=span();s.attributes=[{key:"gen_ai.response.time_to_first_chunk",value:{doubleValue:0.19}}];expect(streamTiming(s).first_chunk_ms).toBe(190);s.attributes[0].value={doubleValue:0};expect(streamTiming(s).first_chunk_ms).toBe(0);});
 it("rejects malformed, negative and out-of-span timestamps",()=>{const e=chunk(0,190,"x");e.timeUnixNano="bad";expect(streamTiming(span([e])).first_chunk_ms).toBeNull();e.timeUnixNano=String(start-1n);expect(streamTiming(span([e])).first_chunk_ms).toBeNull();expect(streamTiming(span([chunk(0,999,"x")])).first_chunk_ms).toBeNull();});
 it("handles unfinished calls and Responses text",()=>{const s=span([chunk(0,0,{type:"response.output_text.delta",delta:"x"})]);s.endTimeUnixNano="0";expect(streamTiming(s)).toEqual({first_chunk_ms:0,first_text_ms:0});});
 it("preserves fractional milliseconds and rejects nonfinite attributes",()=>{const s=span([chunk(0,0.125,"x")]);s.attributes=[{key:"gen_ai.response.time_to_first_chunk",value:{doubleValue:Infinity}}];expect(streamTiming(s).first_chunk_ms).toBe(0.125);});
 it("does not assert first text when events were dropped",()=>{const s=span([chunk(0,190,"x")]);s.droppedEventsCount=1;expect(streamTiming(s).first_text_ms).toBeNull();});
});
