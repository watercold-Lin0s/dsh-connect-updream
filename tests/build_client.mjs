#!/usr/bin/env node
/**
 * Assemble src/client.js from src/ui.css + the component sources.
 *
 * The browser half is a single file that the DSH client loader evaluates, but
 * the stylesheet belongs in a real .css file: lint-able, diff-able, and safe
 * from the template-literal hazard that silently truncated the previous build.
 *
 * Layout this script maintains inside src/client.js:
 *
 *   1. module header, ROUTE table, HTTP helpers, COPY, pickCopy   (hand-written)
 *   2. const CSS = ` ...src/ui.css... `                            (generated)
 *   3. StyleSheet, icons, small controls, settings page, pill      (src/ui/*.js)
 *   4. plugin entry: apply, CreditHostGate, exports                (hand-written)
 *
 * Region 3's sources live in src/ui/*.js and are concatenated verbatim; the
 * header and the tail are preserved from the current file, so re-running this
 * is idempotent and does not disturb hand edits in those regions.
 *
 * Run: node tests/build_client.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = join(ROOT, 'src', 'client.js');
const CSS_FILE = join(ROOT, 'src', 'ui.css');
const PARTS_DIR = join(ROOT, 'src', 'ui');

const HEADER_END = /^\s*function pickCopy\(/;
const ENTRY_START = /\/\*\s*Plugin entry/;

function splitRegion(source) {
  const lines = source.split('\n');

  const pickCopyAt = lines.findIndex((line) => HEADER_END.test(line));
  if (pickCopyAt < 0) throw new Error('client.js: pickCopy() not found — the header region is missing');
  let headerEnd = pickCopyAt + 2; // signature, return, closing brace
  while (headerEnd < lines.length && !lines[headerEnd].includes('}')) headerEnd += 1;

  const entryAt = lines.findIndex((line) => ENTRY_START.test(line));
  if (entryAt < 0) throw new Error('client.js: "Plugin entry" marker not found — the tail region is missing');
  let entryStart = entryAt;
  while (entryStart > headerEnd && lines[entryStart - 1].trim().startsWith('/* ----')) entryStart -= 1;

  return {
    header: lines.slice(0, headerEnd + 1).join('\n').replace(/\s+$/, ''),
    tail: lines.slice(entryStart).join('\n').replace(/\s+$/, ''),
  };
}

const source = readFileSync(TARGET, 'utf8');
const { header, tail } = splitRegion(source);

const css = readFileSync(CSS_FILE, 'utf8').replace(/\s+$/, '');
if (css.includes('`')) {
  throw new Error('src/ui.css contains a backtick, which would terminate the CSS template literal');
}

const parts = readdirSync(PARTS_DIR)
  .filter((name) => name.endsWith('.js'))
  .sort()
  .map((name) => readFileSync(join(PARTS_DIR, name), 'utf8').replace(/\s+$/, ''));

if (parts.length === 0) throw new Error('src/ui/ has no component parts');

const out = [
  header,
  '',
  '    /* ------------------------------------------------------------------ */',
  '    /* Styles                                                              */',
  '    /* ------------------------------------------------------------------ */',
  '',
  '    /*',
  '     * The stylesheet is authored in src/ui.css and embedded here verbatim by',
  '     * tests/build_client.mjs. It stays a real .css file so it can be read,',
  '     * diffed and linted as CSS — as the inside of a template literal, a single',
  '     * stray backtick silently truncates the file, which is what happened to',
  '     * the previous build.',
  '     *',
  '     * Every colour is one of the 16 tokens the shell registers, with NO',
  '     * hardcoded fallback: a renamed token then breaks loudly in both themes',
  '     * instead of quietly pinning one theme\u2019s colour onto the other.',
  '     */',
  '    const CSS = `',
  css,
  '`;',
  '',
  '    /** Theme-token stylesheet, rendered inside the component tree so unmount removes it. */',
  '    function StyleSheet() {',
  "      return h('style', { 'data-dsh-connect-updream': '' }, CSS);",
  '    }',
  '',
  ...parts.flatMap((part) => [part, '']),
  tail,
  '',
].join('\n');

writeFileSync(TARGET, out);
console.log(`src/client.js: ${out.split('\n').length} lines, ${(out.length / 1024).toFixed(1)} KB`);
console.log(`  css  ${css.split('\n').length} lines from src/ui.css`);
console.log(`  parts ${parts.length} from src/ui/: ${readdirSync(PARTS_DIR).sort().join(', ')}`);
