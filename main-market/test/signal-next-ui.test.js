import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";
const here=path.dirname(fileURLToPath(import.meta.url));
const html=await readFile(path.join(here,"../public/candle-lab.html"),"utf8");
const server=await readFile(path.join(here,"../server.js"),"utf8");
test("primary and alias Mini App routes serve the EUR/USD interface and status API",()=>{
 assert.match(server,/app\.get\("\/signal-next".*candle-lab\.html/s);assert.match(server,/app\.get\("\/api\/telegram\/ema5\/status"/);
 assert.match(html,/\/api\/telegram\/ema5\/status/);
});
test("Mini App displays EUR/USD signal, next-candle timing and mini chart",()=>{
 assert.match(html,/id="chart"/);assert.match(html,/id="phase"/);assert.match(html,/id="timer"/);
 assert.match(html,/ENTER NOW/);assert.match(html,/id="history"/);
});
test("embedded Mini App JavaScript parses",()=>{
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(x=>x[1].trim()).filter(Boolean);
 assert.equal(scripts.length,1);assert.doesNotThrow(()=>new vm.Script(scripts[0]));
});
