import uslug from 'uslug';

export interface HeadingNode {
  id: string;
  level: number;
  text: string;
  rawText: string;
  line: number;
  slug: string;
  script: string; // 'persian' | 'arabic' | 'hebrew' | 'sc' | 'jp' | 'devanagari' | 'latin'
  children: HeadingNode[];
}

export function isTextRtl(text: string): boolean {
  const rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u0780-\u07BF\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  return rtlRegex.test(text);
}

/**
 * Detects the specific linguistic script of a heading
 */
export function detectHeadingScript(text: string): string {
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return 'jp';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'sc';
  if (/[\u0900-\u097F]/.test(text)) return 'devanagari';
  if (/[\u0590-\u05FF]/.test(text)) return 'hebrew';
  if (/[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text)) {
    if (/[گچپژکگی\u200C]/.test(text)) return 'persian';
    return 'arabic';
  }
  return 'latin';
}

export function cleanHeadingText(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~`==]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

export function parseHeadings(markdown: string): HeadingNode[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const flatNodes: HeadingNode[] = [];
  let inCodeBlock = false;

  const slugs: { [key: string]: number } = {};
  const getJoplinSlug = (headerText: string): string => {
    const s = uslug(headerText);
    const num = slugs[s] ? slugs[s] : 1;
    const output = [s];
    if (num > 1) output.push(String(num));
    slugs[s] = num + 1;
    return output.join('-');
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // 1. ATX headings (#)
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
          slug: getJoplinSlug(text),
          script: detectHeadingScript(text),
          children: [],
        });
      }
      continue;
    }

    // 2. Setext headings (=== or ---)
    if (i > 0 && !lines[i - 1].trim().startsWith('#') && lines[i - 1].trim().length > 0) {
      let level = 0;
      if (/^={2,}\s*$/.test(trimmed)) level = 1;
      else if (/^-{2,}\s*$/.test(trimmed)) level = 2;

      if (level > 0) {
        const text = cleanHeadingText(lines[i - 1]);
        if (text) {
          flatNodes.push({
            id: `heading-${i - 1}-${flatNodes.length}`,
            level,
            text,
            rawText,
            line: i - 1,
            slug: getJoplinSlug(text),
            script: detectHeadingScript(text),
            children: [],
          });
        }
      }
    }
  }

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
