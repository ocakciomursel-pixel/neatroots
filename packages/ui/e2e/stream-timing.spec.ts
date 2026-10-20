import crypto from "node:crypto";
import { expect, test } from "@playwright/test";
import { api, state, watchErrors } from "./util";
for (const theme of ["light", "dark"] as const) for (const width of [390,1440]) {
 test(`stream timing ${theme} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:960});await page.emulateMedia({colorScheme:theme,reducedMotion:"reduce"});
  const errors=watchErrors(page);const traceId=crypto.randomBytes(16).toString("hex");const spanId=crypto.randomBytes(8).toString("hex");const start=BigInt(Date.now()-2000)*1000000n;
  const attr=(key:string,value:string)=>({key,value:{stringValue:value}});
  const events=[{ms:190,value:{choices:[{delta:{role:"assistant",content:""}}]}},{ms:494,value:{choices:[{delta:{content:"Hello"}}]}}].map((x,i)=>({name:"neatlogs.stream.chunk",timeUnixNano:String(start+BigInt(x.ms)*1000000n),attributes:[{key:"neatlogs.stream.chunk.index",value:{intValue:String(i)}},attr("neatlogs.stream.chunk.value",JSON.stringify(x.value))]}));
  await api("/v1/traces",{method:"POST",body:JSON.stringify({resourceSpans:[{resource:{attributes:[attr("service.name","stream-timing-e2e")]},scopeSpans:[{scope:{name:"e2e"},spans:[{traceId,spanId,name:"streaming-fixture",kind:1,startTimeUnixNano:String(start),endTimeUnixNano:String(start+927000000n),attributes:[attr("neatlogs.span.kind","llm")],events,status:{code:1}}]}]}]})});
  await page.goto(`${state().url}/#/runs/${traceId}`);await expect(page.getByRole("heading",{name:"streaming-fixture",exact:true})).toBeVisible();await page.getByTestId("run-views").getByRole("tab",{name:"Trace"}).click();await page.getByRole("treeitem",{name:/streaming-fixture/}).click();
  const sheet=page.getByRole("dialog");await expect(sheet.getByText("First chunk: 190 ms")).toBeVisible();await expect(sheet.getByText("First text: 494 ms")).toBeVisible();await expect(sheet).toContainText("927 ms");
  await expect.poll(async()=>{const r=await sheet.boundingBox();return !!r && r.x>=-1 && r.x+r.width<=width+1;}).toBe(true);expect(await sheet.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({animations:"disabled",path:info.outputPath(`timing-${theme}-${width}.png`)});
 });
}


