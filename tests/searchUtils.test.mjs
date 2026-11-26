import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const nodeRequire = createRequire(import.meta.url);

function loadTsModule(relPath) {
  const result = esbuild.buildSync({
    entryPoints: [path.join(repoRoot, relPath)],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'es2020',
  });
  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', result.outputFiles[0].text);
  fn(nodeRequire, mod, mod.exports);
  return mod.exports;
}

const { normalizeForSearch, findSearchMatchRanges } = loadTsModule('src/searchUtils.ts');

describe('Search normalization & highlight offset mapping (P0 #4)', () => {
  it('maps exact original slice for Persian headings containing ZWNJ (می‌خواهم)', () => {
    const heading = 'من می‌خواهم معماری سیستم را بررسی کنم';
    const ranges = findSearchMatchRanges(heading, 'میخواهم');
    assert.equal(ranges.length, 1);
    assert.equal(heading.slice(ranges[0].start, ranges[0].end), 'می\u200Cخواهم');

    // Partial match crossing ZWNJ boundary
    const crossRanges = findSearchMatchRanges(heading, 'یخوا');
    assert.equal(crossRanges.length, 1);
    assert.equal(heading.slice(crossRanges[0].start, crossRanges[0].end), 'ی\u200Cخوا');
  });

  it('maps exact original slice for Arabic/Persian harakat and variant letters (ك/ي/ة)', () => {
    const heading = 'كِتَابُ المَعْلُومَاتِ العربية';
    const ranges = findSearchMatchRanges(heading, 'کتاب');
    assert.equal(ranges.length, 1);
    // Must include trailing haraka attached to the final matched character without corrupting offsets
    assert.equal(heading.slice(ranges[0].start, ranges[0].end), 'كِتَابُ');

    const arabicTail = findSearchMatchRanges(heading, 'العربیه');
    assert.equal(arabicTail.length, 1);
    assert.equal(heading.slice(arabicTail[0].start, arabicTail[0].end), 'العربية');
  });

  it('maps exact original slice for precomposed and decomposed accented Latin characters', () => {
    const precomposed = 'Café & Résumé — Überblick';
    const cafeRanges = findSearchMatchRanges(precomposed, 'cafe');
    assert.equal(cafeRanges.length, 1);
    assert.equal(precomposed.slice(cafeRanges[0].start, cafeRanges[0].end), 'Café');

    const resumeRanges = findSearchMatchRanges(precomposed, 'resume');
    assert.equal(resumeRanges.length, 1);
    assert.equal(precomposed.slice(resumeRanges[0].start, resumeRanges[0].end), 'Résumé');

    // Decomposed NFD string: e + combining acute accent (\u0301)
    const decomposed = 'Cafe\u0301 Guide';
    const decompRanges = findSearchMatchRanges(decomposed, 'cafe');
    assert.equal(decompRanges.length, 1);
    assert.equal(decomposed.slice(decompRanges[0].start, decompRanges[0].end), 'Cafe\u0301');
  });

  it('does not suffer offset drift from leading spaces or emoji surrogate pairs', () => {
    const withSpaces = '   Café Latte';
    const ranges = findSearchMatchRanges(withSpaces, 'cafe');
    assert.equal(ranges.length, 1);
    assert.equal(withSpaces.slice(ranges[0].start, ranges[0].end), 'Café');

    const withEmoji = '🚀 Launch Plan';
    const emojiRanges = findSearchMatchRanges(withEmoji, 'launch');
    assert.equal(emojiRanges.length, 1);
    assert.equal(withEmoji.slice(emojiRanges[0].start, emojiRanges[0].end), 'Launch');
  });

  it('finds all non-overlapping matches in a heading', () => {
    const heading = 'API v1 vs API v2';
    const ranges = findSearchMatchRanges(heading, 'api');
    assert.equal(ranges.length, 2);
    assert.deepEqual(
      ranges.map((r) => heading.slice(r.start, r.end)),
      ['API', 'API'],
    );
  });

  it('normalizes consistently and returns empty ranges on empty query', () => {
    assert.equal(normalizeForSearch('  می‌خواهم  '), 'میخواهم');
    assert.deepEqual(findSearchMatchRanges('Heading', ''), []);
    assert.deepEqual(findSearchMatchRanges('Heading', '   '), []);
    assert.deepEqual(findSearchMatchRanges('', 'test'), []);
  });
});
