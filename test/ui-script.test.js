const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('Mini App inline JavaScript parses without syntax errors', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  const inline = scripts.map(match => match[1]).filter(source => source.trim()).at(-1);
  assert.ok(inline, 'expected an inline Mini App script');
  assert.doesNotThrow(() => new vm.Script(inline, { filename: 'public/index.html' }));
});

test('Mini App client hold timer matches the 35-second alert contract', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /const HOLD_MS=35000/);
  assert.match(html, /RESULT LAST 5S/);
  assert.match(html, /FINAL 5 SECONDS/);
  assert.doesNotMatch(html, /FINAL 3 SECONDS|ช่วง 3 วินาทีสุดท้าย/);
});
