// Asset reference sanity. The game loads a handful of authored PNGs by path;
// a rename or a typo shows up in the browser as a silently blank layer, so the
// paths are checked against the filesystem here instead.
//
// This only verifies that referenced files EXIST. Nothing about the artwork
// itself is tested — that stays manual, visual QA.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Comments routinely contain example paths and commented-out config, which are
// not references the game actually loads. Strip them before scanning. `://` is
// protected so a URL in a string is not mistaken for a line comment.
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === '/' && line[i + 1] === '/' && line[i - 1] !== ':') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

// Pull every `assets/...` path out of a source file, whether it sits in a plain
// string or a template literal. Paths built with ${} are reported as the static
// prefix so the directory can be checked instead of a filename that only exists
// at runtime.
function assetRefs(source) {
  const refs = [];
  const re = /['"`](assets\/[^'"`]*)['"`]/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const raw = m[1];
    const dynamic = raw.includes('${');
    refs.push({ raw, dynamic, path: dynamic ? raw.slice(0, raw.indexOf('${')) : raw });
  }
  return refs;
}

const files = jsFiles(SRC);

test('the source tree is where it is expected to be', () => {
  assert.ok(files.length > 0, 'no source files found to scan');
});

test('every asset the game loads by name exists on disk', () => {
  const missing = [];
  for (const file of files) {
    const source = stripComments(readFile(file));
    for (const ref of assetRefs(source)) {
      if (ref.dynamic) continue;
      if (!existsSync(join(ROOT, ref.path))) {
        missing.push(`${file.slice(ROOT.length + 1)} -> ${ref.path}`);
      }
    }
  }
  assert.deepEqual(missing, [], `missing asset files:\n  ${missing.join('\n  ')}`);
});

test('every asset folder built up at runtime exists and has files in it', () => {
  const empty = [];
  for (const file of files) {
    const source = stripComments(readFile(file));
    for (const ref of assetRefs(source)) {
      if (!ref.dynamic) continue;
      const dir = join(ROOT, ref.path.endsWith('/') ? ref.path : dirname(ref.path));
      if (!existsSync(dir) || !statSync(dir).isDirectory() || readdirSync(dir).length === 0) {
        empty.push(`${file.slice(ROOT.length + 1)} -> ${ref.path}`);
      }
    }
  }
  assert.deepEqual(empty, [], `missing or empty asset folders:\n  ${empty.join('\n  ')}`);
});

test('the page entry point and stylesheet are present', () => {
  assert.ok(existsSync(join(ROOT, 'index.html')));
  assert.ok(existsSync(join(ROOT, 'src/main.js')));
  const html = readFile(join(ROOT, 'index.html'));
  for (const [, href] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (href.startsWith('http')) continue;
    assert.ok(existsSync(join(ROOT, href)), `index.html references missing file "${href}"`);
  }
});

function readFile(p) {
  return readFileSync(p, 'utf8');
}
