import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
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
    alias: {
      api: path.join(repoRoot, 'api'),
    },
  });
  const mod = { exports: {} };
  const fn = new Function('require', 'module', 'exports', result.outputFiles[0].text);
  fn(nodeRequire, mod, mod.exports);
  return mod.exports;
}

const parser = loadTsModule('src/parser.ts');
const {
  parseHeadings,
  parseHtmlHeadings,
  parseNoteHeadings,
  cleanHeadingText,
  computeHeadingSignature,
  isTextRtl,
  detectHeadingScript,
} = parser;

function flatten(nodes, out = []) {
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) flatten(n.children, out);
  }
  return out;
}

describe('Markdown & HTML heading parser (P0 #3)', () => {
  it('skips YAML frontmatter without parsing tags or comments as headings', () => {
    const md = [
      '---',
      'title: Project Spec',
      '# yaml comment should be ignored',
      'tags: architecture',
      '---',
      '',
      '# Real Title',
      '',
      '## Section One',
    ].join('\n');

    const flat = flatten(parseHeadings(md));
    assert.equal(flat.length, 2);
    assert.equal(flat[0].text, 'Real Title');
    assert.equal(flat[0].level, 1);
    assert.equal(flat[0].line, 6);
    assert.equal(flat[1].text, 'Section One');
    assert.equal(flat[1].level, 2);
    assert.equal(flat[1].line, 8);
  });

  it('handles UTF-8 BOM frontmatter and does not treat unclosed --- as frontmatter', () => {
    const withBom = '\uFEFF---\nauthor: Alice\n...\n# Heading After Dot Close\n';
    const flatBom = flatten(parseHeadings(withBom));
    assert.equal(flatBom.length, 1);
    assert.equal(flatBom[0].text, 'Heading After Dot Close');

    const unclosed = '---\n# Heading When No Closing Frontmatter\n';
    const flatUnclosed = flatten(parseHeadings(unclosed));
    assert.equal(flatUnclosed.length, 1);
    assert.equal(flatUnclosed[0].text, 'Heading When No Closing Frontmatter');
  });

  it('tracks fenced code block delimiter character and length accurately', () => {
    const md = [
      '# Top',
      '````markdown',
      '# Inside 4-backtick block',
      '~~~',
      '## Still inside 4-backtick block',
      '```',
      '### Still inside (only 3 backticks)',
      '````',
      '## After 4-backtick block',
      '~~~bash',
      '# Inside tilde fence',
      '```',
      '## Still inside tilde fence',
      '~~~~',
      '### After tilde fence',
    ].join('\n');

    const flat = flatten(parseHeadings(md));
    assert.deepEqual(
      flat.map((h) => [h.level, h.text]),
      [
        [1, 'Top'],
        [2, 'After 4-backtick block'],
        [3, 'After tilde fence'],
      ],
    );
  });

  it('ignores 4-space and tab indented code blocks', () => {
    const md = [
      '# Real Heading',
      '',
      '    # Indented 4 spaces heading',
      '    Indented text',
      '    ---',
      '',
      '\t## Tab-indented heading',
      '',
      '## Real Second Heading',
    ].join('\n');

    const flat = flatten(parseHeadings(md));
    assert.deepEqual(
      flat.map((h) => [h.level, h.text]),
      [
        [1, 'Real Heading'],
        [2, 'Real Second Heading'],
      ],
    );
  });

  it('distinguishes genuine Setext headings from HRs after lists, blockquotes, tables, and blanks', () => {
    const md = [
      'Real Setext H1',
      '===',
      '',
      'Real Setext H2',
      '---',
      '',
      '- List item',
      '---',
      '',
      '> Blockquote line',
      '---',
      '',
      '| Col A | Col B |',
      '---',
      '',
      '---',
      '',
      '***',
      '---',
    ].join('\n');

    const flat = flatten(parseHeadings(md));
    assert.deepEqual(
      flat.map((h) => [h.level, h.text, h.line]),
      [
        [1, 'Real Setext H1', 0],
        [2, 'Real Setext H2', 3],
      ],
    );
  });

  it('preserves =, generics, comparisons, snake_case, and code spans while stripping Markdown/HTML', () => {
    assert.equal(cleanHeadingText('a = b + c'), 'a = b + c');
    assert.equal(cleanHeadingText('a == b'), 'a == b');
    assert.equal(cleanHeadingText('==Highlighted== and a = b'), 'Highlighted and a = b');
    assert.equal(cleanHeadingText('Map<string, number>'), 'Map<string, number>');
    assert.equal(cleanHeadingText('Array<T> and Option<U>'), 'Array<T> and Option<U>');
    assert.equal(cleanHeadingText('x < y && y > z'), 'x < y && y > z');
    assert.equal(cleanHeadingText('my_snake_case_func'), 'my_snake_case_func');
    assert.equal(cleanHeadingText('**Bold** and *Italic* and _Em_ and ~~Del~~'), 'Bold and Italic and Em and Del');
    assert.equal(cleanHeadingText('![Logo](https://example.com/a.png) Intro'), 'Logo Intro');
    assert.equal(
      cleanHeadingText('[Wiki](https://en.wikipedia.org/wiki/Foo_(bar)) Guide'),
      'Wiki Guide',
    );
    assert.equal(cleanHeadingText('`a == b` and `Map<K, V>` and `my_var`'), 'a == b and Map<K, V> and my_var');
    assert.equal(cleanHeadingText('Hello <span class="badge">World</span>!'), 'Hello World!');
    assert.equal(cleanHeadingText('Press <kbd>Ctrl</kbd>+<kbd>K</kbd>'), 'Press Ctrl+K');
    assert.equal(cleanHeadingText('Q&amp;A &lt;2026&gt;'), 'Q&A <2026>');
  });

  it('generates Joplin-compatible @joplin/fork-uslug slugs including emojis and duplicate suffixes', () => {
    const md = [
      '# 🚀 Launch Plan',
      '## Notes',
      '## Notes',
      '## Notes',
      '## Café & Résumé',
    ].join('\n');

    const flat = flatten(parseHeadings(md));
    assert.equal(flat[0].slug, 'rocket-launch-plan');
    assert.equal(flat[1].slug, 'notes');
    assert.equal(flat[2].slug, 'notes-2');
    assert.equal(flat[3].slug, 'notes-3');
    assert.equal(flat[4].slug, 'café-résumé');

    // Keys stay unique even for duplicates
    assert.equal(new Set(flat.map((h) => h.key)).size, flat.length);
  });

  it('parses HTML notes (markup_language === 2), preserves explicit IDs, and ignores scripts/styles/comments', () => {
    const html = [
      '<!-- <h1>Commented Out</h1> -->',
      '<style>/* <h2>Inside Style</h2> */</style>',
      '<script>const s = "<h3>Inside Script</h3>";</script>',
      '<article>',
      '  <h1 id="custom-intro">Welcome to <span>Joplin</span></h1>',
      '  <p>Paragraph text</p>',
      '  <h2>Features &amp; API</h2>',
      '  <h3 id=\'sub-sec\'>Line 1<br/>Line 2</h3>',
      '  <h2>Features &amp; API</h2>',
      '</article>',
    ].join('\n');

    const tree = parseNoteHeadings(html, 2);
    const flat = flatten(tree);

    assert.equal(flat.length, 4);
    assert.equal(flat[0].text, 'Welcome to Joplin');
    assert.equal(flat[0].level, 1);
    assert.equal(flat[0].slug, 'custom-intro');
    assert.equal(flat[0].hasExplicitId, true);
    assert.equal(flat[0].line, 4);

    assert.equal(flat[1].text, 'Features & API');
    assert.equal(flat[1].level, 2);
    assert.equal(flat[1].slug, 'features-api');
    assert.equal(flat[1].hasExplicitId, false);

    assert.equal(flat[2].text, 'Line 1 Line 2');
    assert.equal(flat[2].level, 3);
    assert.equal(flat[2].slug, 'sub-sec');
    assert.equal(flat[2].hasExplicitId, true);

    assert.equal(flat[3].text, 'Features & API');
    assert.equal(flat[3].slug, 'features-api-2');
    assert.equal(flat[3].hasExplicitId, false);
  });

  it('computes identical heading signatures for paragraph-only edits and different signatures for same-length heading edits', () => {
    const before = '# Draft\n\nParagraph text here.\n\n## Intro\nBody.\n';
    const paragraphEdit = '# Draft\n\nEdited paragraph with totally different content!\n\n## Intro\nMore text.\n';
    const sameLengthHeadingEdit = '# Final\n\nParagraph text here.\n\n## Intro\nBody.\n';

    assert.equal(
      computeHeadingSignature(parseHeadings(before)),
      computeHeadingSignature(parseHeadings(paragraphEdit)),
    );
    assert.notEqual(
      computeHeadingSignature(parseHeadings(before)),
      computeHeadingSignature(parseHeadings(sameLengthHeadingEdit)),
    );
  });

  it('detects RTL and linguistic scripts accurately', () => {
    assert.equal(isTextRtl('سلام دنیا'), true);
    assert.equal(isTextRtl('Hello World'), false);
    assert.equal(detectHeadingScript('معماری سیستم'), 'persian');
    assert.equal(detectHeadingScript('שלום עולם'), 'hebrew');
    assert.equal(detectHeadingScript('日本語の見出し'), 'jp');
    assert.equal(detectHeadingScript('中文标题'), 'sc');
    assert.equal(detectHeadingScript('हिन्दी शीर्षक'), 'devanagari');
    assert.equal(detectHeadingScript('Architecture'), 'latin');
  });
});
