import uslug from '@joplin/fork-uslug';
import { MarkupLanguage } from 'api/types';
import type { HeadingNode, HeadingScript } from './webview/protocol';

export type { HeadingNode, HeadingScript };

const KNOWN_HTML_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'big', 'br', 'cite', 'code', 'data',
  'del', 'dfn', 'div', 'em', 'font', 'hr', 'i', 'img', 'ins', 'kbd',
  'mark', 'p', 'q', 'rb', 'rp', 'rt', 'rtc', 'ruby', 's', 'samp',
  'small', 'span', 'strike', 'strong', 'sub', 'sup', 'time', 'tt', 'u',
  'var', 'wbr',
]);

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const RTL_REGEX =
  /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export function isTextRtl(text: string): boolean {
  return RTL_REGEX.test(text);
}

/**
 * Detects the specific linguistic script of a heading.
 */
export function detectHeadingScript(text: string): HeadingScript {
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'jp';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'sc';
  if (/[\u0900-\u097F]/.test(text)) return 'devanagari';
  if (/[\u0590-\u05FF]/.test(text)) return 'hebrew';
  // Matches Arabic/Persian/Urdu ranges including Presentation Forms & Persian digits
  if (/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\u06F0-\u06F9]/.test(text)) {
    return 'persian';
  }
  return 'latin';
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const cp = parseInt(entity.slice(2), 16);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : match;
    }
    if (entity.startsWith('#')) {
      const cp = parseInt(entity.slice(1), 10);
      return Number.isFinite(cp) && cp >= 0 && cp <= 0x10ffff
        ? String.fromCodePoint(cp)
        : match;
    }
    const lower = entity.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_HTML_ENTITIES, lower)
      ? NAMED_HTML_ENTITIES[lower]
      : match;
  });
}

/**
 * Strips inline Markdown links `[label](url)` and images `![alt](url)`,
 * supporting balanced parentheses inside URLs (e.g. Wikipedia links) and
 * reference-style links `[label][ref]` / `![alt][ref]`.
 */
function stripMarkdownLinksAndImages(input: string): string {
  let result = '';
  let i = 0;

  while (i < input.length) {
    const isImage = input[i] === '!' && input[i + 1] === '[';
    const isLink = input[i] === '[';

    if (!isImage && !isLink) {
      result += input[i];
      i += 1;
      continue;
    }

    const labelStart = isImage ? i + 2 : i + 1;
    let bracketDepth = 1;
    let j = labelStart;
    while (j < input.length && bracketDepth > 0) {
      if (input[j] === '\\' && j + 1 < input.length) {
        j += 2;
        continue;
      }
      if (input[j] === '[') bracketDepth += 1;
      else if (input[j] === ']') bracketDepth -= 1;
      j += 1;
    }

    if (bracketDepth !== 0) {
      result += input[i];
      i += 1;
      continue;
    }

    const labelEnd = j - 1;
    const label = input.slice(labelStart, labelEnd);

    // Inline link/image: (...), allowing balanced nested parentheses
    if (input[j] === '(') {
      let parenDepth = 1;
      let k = j + 1;
      while (k < input.length && parenDepth > 0) {
        if (input[k] === '\\' && k + 1 < input.length) {
          k += 2;
          continue;
        }
        if (input[k] === '(') parenDepth += 1;
        else if (input[k] === ')') parenDepth -= 1;
        k += 1;
      }

      if (parenDepth === 0) {
        result += stripMarkdownLinksAndImages(label);
        i = k;
        continue;
      }
    }

    // Reference link/image: [label][ref]
    if (input[j] === '[') {
      const refClose = input.indexOf(']', j + 1);
      if (refClose !== -1) {
        result += stripMarkdownLinksAndImages(label);
        i = refClose + 1;
        continue;
      }
    }

    result += input[i];
    i += 1;
  }

  return result;
}

/**
 * Strips known inline HTML tags & comments while preserving type generics
 * (e.g. `Map<string, number>`, `Array<T>`) and math comparisons (`x < y && y > z`).
 */
function stripSafeHtmlTags(input: string): string {
  // Remove HTML comments first
  const withoutComments = input.replace(/<!--[\s\S]*?-->/g, '');

  return withoutComments.replace(
    /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)(\s+[^<>]*)?\s*(\/?)>/g,
    (match, closingSlash: string, tagName: string, attrs: string | undefined) => {
      const lower = tagName.toLowerCase();
      const hasHtmlAttr = Boolean(
        attrs && /\s[a-zA-Z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/.test(attrs),
      );

      // Preserve single uppercase generic type params like Option<U>, Box<B>, Node<P>
      // unless a matching closing tag exists.
      if (!closingSlash && !hasHtmlAttr && /^[A-Z]$/.test(tagName)) {
        const hasClosingTag = new RegExp(`</${tagName}\\s*>`, 'i').test(withoutComments);
        if (!hasClosingTag) {
          return match;
        }
      }

      if (!KNOWN_HTML_TAGS.has(lower) && !hasHtmlAttr) {
        // Likely a generic type parameter like <T> or <MyType>, not an HTML tag
        return match;
      }

      if (lower === 'br' && !closingSlash) {
        return ' ';
      }

      return '';
    },
  );
}

/**
 * Cleans inline Markdown & safe HTML markup from a heading while preserving literal
 * math operators (`=`, `<`, `>`), generics (`Map<string, number>`), snake_case
 * identifiers (`my_func_name`), and inline code contents.
 */
export function cleanHeadingText(raw: string): string {
  if (!raw) return '';

  const placeholders: string[] = [];
  const stash = (value: string): string => {
    const idx = placeholders.length;
    placeholders.push(value);
    return `\uE000${idx}\uE001`;
  };

  // 1. Protect inline code spans (`code` or ``code``) so inner punctuation is never altered
  let text = raw.replace(/(`+)([\s\S]*?)\1/g, (_m, _ticks: string, content: string) => {
    let inner = content;
    if (inner.length >= 2 && inner.startsWith(' ') && inner.endsWith(' ') && /[^ ]/.test(inner)) {
      inner = inner.slice(1, -1);
    }
    return stash(inner);
  });

  // 2. Protect backslash-escaped ASCII punctuation
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!~=|<>])/g, (_m, ch: string) => stash(ch));

  // 3. Strip Markdown images and links
  text = stripMarkdownLinksAndImages(text);

  // 4. Strip real HTML tags & comments (preserving generics & comparisons)
  text = stripSafeHtmlTags(text);

  // 5. Strip inline Markdown formatting markers safely
  text = text
    .replace(/==([^=\n]+)==/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/\+\+([^+\n]+)\+\+/g, '$1')
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, '$1')
    .replace(/(?<!\w)___([^_\n]+)___(?!\w)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(?<!\w)__([^_\n]+)__(?!\w)/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1');

  // 6. Restore inline code contents & escaped chars
  text = text.replace(/\uE000(\d+)\uE001/g, (_m, idxStr: string) => placeholders[Number(idxStr)] ?? '');

  // 7. Decode HTML entities and normalize whitespace
  text = decodeHtmlEntities(text).replace(/\s+/g, ' ').trim();

  return text;
}

function createSlugGenerator(): (headerText: string) => string {
  const slugs: Record<string, number> = Object.create(null);
  return (headerText: string): string => {
    const base = uslug(headerText);
    const num = slugs[base] ? slugs[base] : 1;
    slugs[base] = num + 1;
    return num > 1 ? `${base}-${num}` : base;
  };
}

function createStableKeyGenerator(): (slug: string, level: number, text: string) => string {
  const seenKeys: Record<string, number> = Object.create(null);
  return (slug: string, level: number, text: string): string => {
    const baseKey = slug || `h${level}:${text}`;
    const count = seenKeys[baseKey] ? seenKeys[baseKey] + 1 : 1;
    seenKeys[baseKey] = count;
    return count > 1 ? `${baseKey}#${count}` : baseKey;
  };
}

function buildHeadingTree(flatNodes: HeadingNode[]): HeadingNode[] {
  const rootNodes: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  for (const node of flatNodes) {
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      rootNodes.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }

  return rootNodes;
}

/**
 * Detects YAML frontmatter at the very start of the document, matching Joplin's
 * built-in `packages/renderer/MdToHtml/rules/frontmatter.ts` (`---` on line 0
 * closed by `---` or YAML document end `...`).
 * Returns the first line index after the frontmatter block, or 0 if none.
 */
function findFrontmatterEndLine(lines: string[]): number {
  if (lines.length < 2) return 0;
  const firstLine = lines[0].replace(/^\uFEFF/, '');
  if (!/^---\s*$/.test(firstLine)) return 0;

  for (let i = 1; i < lines.length; i++) {
    if (/^(?:---|\.\.\.)\s*$/.test(lines[i])) {
      return i + 1;
    }
  }
  return 0;
}

function isThematicBreak(line: string): boolean {
  return /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line);
}

function isNonParagraphBlockLine(line: string): boolean {
  if (isThematicBreak(line)) return true;
  if (/^\s{0,3}>/.test(line)) return true; // Blockquote
  if (/^\s{0,3}(?:[-*+]|\d{1,9}[.)])(?:\s+|$)/.test(line)) return true; // List item
  if (/^\s*\|/.test(line)) return true; // Markdown table row
  if (/^\s{0,3}<\/?(?:div|p|table|thead|tbody|tr|td|th|ul|ol|li|pre|hr|blockquote|section|article|header|footer|aside|details|summary|figure|figcaption|script|style|!--)\b/i.test(line)) {
    return true;
  }
  return false;
}

/**
 * Parses Markdown headings (ATX & Setext) into a nested tree with Joplin-compatible
 * `@joplin/fork-uslug` slugs, ignoring YAML frontmatter, fenced code blocks,
 * 4-space indented code blocks, blockquotes, and horizontal rules.
 */
export function parseHeadings(markdown: string): HeadingNode[] {
  if (!markdown) return [];

  const lines = markdown.split(/\r?\n/);
  const flatNodes: HeadingNode[] = [];
  const getJoplinSlug = createSlugGenerator();
  const getStableKey = createStableKeyGenerator();

  const startLine = findFrontmatterEndLine(lines);
  let activeFenceChar = '';
  let activeFenceLength = 0;
  let prevLineKind: 'blank' | 'paragraph' | 'indentedCode' | 'other' = 'blank';

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 1. Inside a fenced code block: only close on matching fence char with length >= openLength
    if (activeFenceChar) {
      const closeMatch = line.match(/^\s{0,3}(`{3,}|~{3,})\s*$/);
      if (
        closeMatch &&
        closeMatch[1][0] === activeFenceChar &&
        closeMatch[1].length >= activeFenceLength
      ) {
        activeFenceChar = '';
        activeFenceLength = 0;
        prevLineKind = 'other';
      }
      continue;
    }

    // 2. Blank line
    if (trimmed.length === 0) {
      prevLineKind = 'blank';
      continue;
    }

    // 3. CommonMark 4-space / tab indented code block (cannot interrupt a paragraph)
    if (/^(?: {4}|\t)/.test(line) && (prevLineKind === 'blank' || prevLineKind === 'indentedCode')) {
      prevLineKind = 'indentedCode';
      continue;
    }

    // 4. Opening fenced code block (``` or ~~~)
    const openFenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (openFenceMatch) {
      const fence = openFenceMatch[1];
      const infoString = openFenceMatch[2];
      // Per CommonMark, backtick fence info strings cannot contain backticks
      if (fence[0] === '~' || !infoString.includes('`')) {
        activeFenceChar = fence[0];
        activeFenceLength = fence.length;
        prevLineKind = 'other';
        continue;
      }
    }

    // 5. ATX headings (# to ######)
    const atxMatch = line.match(/^\s{0,3}(#{1,6})(?:\s+(.*?))?\s*$/);
    if (atxMatch) {
      const level = atxMatch[1].length;
      const content = atxMatch[2] ?? '';
      // Strip optional closing sequence of `#` preceded by whitespace (CommonMark §4.2)
      const rawText = content.replace(/(?:^|\s+)#+\s*$/, '').trim();
      const text = cleanHeadingText(rawText);
      if (text) {
        const slug = getJoplinSlug(text);
        flatNodes.push({
          id: `heading-${i}-${flatNodes.length}`,
          key: getStableKey(slug, level, text),
          level,
          text,
          rawText,
          line: i,
          slug,
          script: detectHeadingScript(text),
          children: [],
        });
      }
      prevLineKind = 'other';
      continue;
    }

    // 6. Setext heading underlines (=== or ---) — only valid directly after a plain paragraph line
    if (i > startLine && prevLineKind === 'paragraph') {
      const setextMatch = line.match(/^\s{0,3}(=+|-+)\s*$/);
      if (setextMatch) {
        const level = setextMatch[1][0] === '=' ? 1 : 2;
        const rawText = lines[i - 1].trim();
        const text = cleanHeadingText(rawText);
        if (text) {
          const slug = getJoplinSlug(text);
          flatNodes.push({
            id: `heading-${i - 1}-${flatNodes.length}`,
            key: getStableKey(slug, level, text),
            level,
            text,
            rawText,
            line: i - 1,
            slug,
            script: detectHeadingScript(text),
            children: [],
          });
        }
        prevLineKind = 'other';
        continue;
      }
    }

    // 7. Classify current line to govern Setext / indented code eligibility on the next line
    prevLineKind = isNonParagraphBlockLine(line) ? 'other' : 'paragraph';
  }

  return buildHeadingTree(flatNodes);
}

/**
 * Replaces non-content HTML blocks (<script>, <style>, <template>, comments) with
 * equal numbers of newline characters so line offsets remain accurate.
 */
function maskNonContentHtmlBlocks(html: string): string {
  return html.replace(
    /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>|<template\b[^>]*>[\s\S]*?<\/template>/gi,
    (match) => match.replace(/[^\n]/g, ' '),
  );
}

function countLineNumberAtOffset(source: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * Parses HTML note headings (`<h1>`–`<h6>`) into a nested tree, preserving any
 * explicit `id="..."` attribute for anchor navigation or falling back to a
 * Joplin-compatible `@joplin/fork-uslug` slug.
 */
export function parseHtmlHeadings(html: string): HeadingNode[] {
  if (!html) return [];

  const masked = maskNonContentHtmlBlocks(html);
  const flatNodes: HeadingNode[] = [];
  const getJoplinSlug = createSlugGenerator();
  const getStableKey = createStableKeyGenerator();

  const headingRe = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = headingRe.exec(masked)) !== null) {
    const level = Number(match[1]);
    const attrs = match[2] || '';
    const innerHtml = match[3] || '';

    const rawText = innerHtml
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, '');
    const text = decodeHtmlEntities(rawText).replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const idMatch = attrs.match(/(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    const explicitId = (idMatch?.[1] ?? idMatch?.[2] ?? idMatch?.[3] ?? '').trim();
    const hasExplicitId = explicitId.length > 0;
    const slug = hasExplicitId ? explicitId : getJoplinSlug(text);
    const line = countLineNumberAtOffset(masked, match.index);

    flatNodes.push({
      id: `heading-${line}-${flatNodes.length}`,
      key: getStableKey(slug, level, text),
      level,
      text,
      rawText: text,
      line,
      slug,
      hasExplicitId,
      script: detectHeadingScript(text),
      children: [],
    });
  }

  return buildHeadingTree(flatNodes);
}

/**
 * Unified heading parser dispatching between Joplin Markdown notes (`markup_language = 1`)
 * and Joplin HTML notes (`markup_language = 2`, e.g. Web Clipper / ENEX imports).
 */
export function parseNoteHeadings(body: string, markupLanguage?: number): HeadingNode[] {
  if (!body) return [];
  if (markupLanguage === MarkupLanguage.Html) {
    return parseHtmlHeadings(body);
  }
  return parseHeadings(body);
}

/**
 * Produces a deterministic structural fingerprint of a heading tree so edits
 * inside paragraphs that do not affect headings can skip unnecessary DOM rebuilds.
 */
export function computeHeadingSignature(nodes: HeadingNode[]): string {
  const parts: string[] = [];
  const walk = (list: HeadingNode[]) => {
    for (const node of list) {
      parts.push(
        `${node.level}|${node.line}|${node.key}|${node.slug}|${node.hasExplicitId ? 1 : 0}|${node.script}|${node.text}`,
      );
      if (node.children.length > 0) {
        parts.push('[');
        walk(node.children);
        parts.push(']');
      }
    }
  };
  walk(nodes);
  return parts.join('\n');
}
