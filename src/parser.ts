export interface HeadingNode {
  id: string;
  level: number;
  text: string;
  rawText: string;
  line: number;
  slug: string;
  children: HeadingNode[];
}

/**
 * Detects RTL scripts: Arabic, Persian, Hebrew, Urdu, Kurdish, Syriac, Thaana (Dhivehi)
 */
export function isTextRtl(text: string): boolean {
  const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  return rtlRegex.test(text);
}

/**
 * Universal Unicode-compliant Slugifier
 * Works flawlessly with English, Persian, Arabic, Chinese, Japanese, Russian, German, Greek, etc.
 */
export function unicodeSlugify(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    // Match any Unicode Letter (\p{L}) or Number (\p{N}) or whitespace or hyphen
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function cleanHeadingText(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url) -> link
    .replace(/[*_~`==]/g, '')                 // Markdown bold, italic, code, highlights
    .replace(/<[^>]*>/g, '')                  // Inline HTML tags
    .trim();
}

export function parseHeadings(markdown: string): HeadingNode[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const flatNodes: HeadingNode[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Toggle fenced code blocks (``` or ~~~)
    if (/^(```|~~~)/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // 1. ATX headings: 0-3 leading spaces, 1-6 hashes, space, text
    const atxMatch = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (atxMatch) {
      const level = atxMatch[1].length;
      const rawText = atxMatch[2].replace(/\s+#+\s*$/, '').trim();
      const text = cleanHeadingText(rawText);
      if (text) {
        flatNodes.push({
          id: `heading-${i}-${flatNodes.length}`,
          level,
          text,
          rawText,
          line: i,
          slug: unicodeSlugify(text),
          children: [],
        });
      }
      continue;
    }

    // 2. Setext headings: Line followed by === (H1) or --- (H2)
    if (i > 0 && !lines[i - 1].trim().startsWith('#') && lines[i - 1].trim().length > 0) {
      if (/^={2,}\s*$/.test(trimmed)) {
        const text = cleanHeadingText(lines[i - 1]);
        if (text) {
          flatNodes.push({
            id: `heading-${i - 1}-${flatNodes.length}`,
            level: 1,
            text,
            rawText: lines[i - 1].trim(),
            line: i - 1,
            slug: unicodeSlugify(text),
            children: [],
          });
        }
      } else if (/^-{2,}\s*$/.test(trimmed)) {
        const text = cleanHeadingText(lines[i - 1]);
        if (text) {
          flatNodes.push({
            id: `heading-${i - 1}-${flatNodes.length}`,
            level: 2,
            text,
            rawText: lines[i - 1].trim(),
            line: i - 1,
            slug: unicodeSlugify(text),
            children: [],
          });
        }
      }
    }
  }

  // Construct recursive tree
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
