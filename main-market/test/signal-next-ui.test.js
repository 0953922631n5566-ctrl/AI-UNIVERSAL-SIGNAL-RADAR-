import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = await readFile(path.join(here, "../public/signal-next.html"), "utf8");
const server = await readFile(path.join(here, "../server.js"), "utf8");

test("next-generation Mini App has a separately addressable route and API", () => {
  assert.match(server, /app\.get\("\/signal-next"/);
  assert.match(server, /app\.get\("\/api\/telegram\/signal-next"/);
  assert.match(html, /\/api\/telegram\/signal-next/);
});

test("signal-only Mini App does not render a chart", () => {
  assert.doesNotMatch(html, /<canvas\b/i);
  assert.match(html, /id="orb"/);
  assert.match(html, /id="candle"/);
  assert.match(html, /id="expiry"/);
});

test("embedded Mini App JavaScript parses", () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim()).filter(Boolean);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0]));
});
