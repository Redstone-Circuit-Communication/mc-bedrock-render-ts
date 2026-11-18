#!/usr/bin/env node
/**
 * Reads the public surface of the Java renderer (@rsw/mc-java-render-ts) from its source and writes tests/fixtures/java-api.json:
 * the public members of SchematicRenderer / CameraManager / SchematicManager / SchematicObject and the events its managers emit.
 * The Bedrock renderer keeps the same interface (docs/UNIFIED_API.md); tests/unified-api.test.ts compares against this file.
 *
 *   node scripts/extract-java-api.mjs <path to mc-java-render-ts>     # e.g. ../mc-java-render-ts-main
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '../mc-java-render-ts-main');
const src = join(root, 'src/renderer');

function members(file, cls) {
  const s = readFileSync(join(src, file), 'utf8');
  const m = new RegExp(`export (?:abstract )?class ${cls}\\b`).exec(s);
  if (!m) throw new Error(`${cls} not found in ${file}`);
  let i = s.indexOf('{', s.indexOf(cls, m.index) + cls.length), depth = 0, k = i;
  for (; k < s.length; k++) { if (s[k] === '{') depth++; else if (s[k] === '}' && --depth === 0) break; }
  const out = {};
  for (const line of s.slice(i + 1, k).split('\n')) {
    const x = /^(?:\t| {2})(?!\t| {2})((?:public |readonly |static |async |get |set |private |protected |declare )*)([A-Za-z_]\w*)\s*(\(|[:?=<!])/.exec(line);
    if (!x || /private|protected/.test(x[1])) continue;
    if (['return', 'if', 'for', 'const', 'let', 'else', 'switch', 'case', 'throw', 'await', 'try', 'catch', 'this', 'super', 'new', 'constructor'].includes(x[2])) continue;
    out[x[2]] = /\bstatic\b/.test(x[1]) ? 'static' : x[3] === '(' || /^\s*(public )?(async )?(get |set )?\w+\(/.test(line) ? 'method' : 'property';
  }
  return out;
}
function walk(d) { return readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? (n === '__tests__' || n === 'test' ? [] : walk(join(d, n))) : [join(d, n)])); }
const events = new Set();
for (const f of walk(src).filter((p) => /\.ts$/.test(p) && !/\.test\.ts$/.test(p)))
  for (const m of readFileSync(f, 'utf8').matchAll(/eventEmitter\??\.emit\(\s*["'`]([\w:.-]+)["'`]/g)) events.add(m[1]);

const api = {
  generatedFrom: '@rsw/mc-java-render-ts ' + JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  classes: {
    SchematicRenderer: members('SchematicRenderer.ts', 'SchematicRenderer'),
    CameraManager: members('managers/CameraManager.ts', 'CameraManager'),
    SchematicManager: members('managers/SchematicManager.ts', 'SchematicManager'),
    SchematicObject: members('managers/SchematicObject.ts', 'SchematicObject'),
  },
  events: [...events].sort(),
};
writeFileSync(new URL('../tests/fixtures/java-api.json', import.meta.url), JSON.stringify(api, null, 1) + '\n');
console.log(Object.entries(api.classes).map(([k, v]) => `${k}: ${Object.keys(v).length}`).join(', '), '| events:', api.events.length);
