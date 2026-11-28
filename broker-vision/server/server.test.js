import test from "node:test";
import assert from "node:assert/strict";

test("vision API package exposes health and guarded frame ingestion", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./server.js", import.meta.url), "utf8");
  assert.match(source, /app\.get\("\/health"/);
  assert.match(source, /app\.post\("\/api\/vision\/frame", auth/);
  assert.match(source, /INSUFFICIENT_VISUAL_DATA/);
  assert.match(source, /frames\.length>MAX_FRAMES/);
});