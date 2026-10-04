export interface HeadingNode {
  id: string;
  level: number;
  text: string;
  rawText: string;
  line: number;
  slug: string;
  children: HeadingNode[];
}

export function parseHeadings(markdown: string): HeadingNode[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const flatNodes: HeadingNode[] = [];
  let inCodeBlock = false;

  const slugify = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\w\u0590-\u05FF\u0600-\u06FF\uFB8A-\uFBFC\u0400-\u04FF -]/g, '')
      .replace(/\s+/g, '-');

  const cleanHeadingText = (raw: string) => {
    return raw
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [link](url) -> link
      .replace(/[*_~`]/g, '')                 // Markdown bold, italic, code
      .trim();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip fenced code blocks (``` or ~~~)
    if (/^(```|~~~)/.test(trimmed)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // 1. ATX headings: 0-3 leading spaces, 1-6 hashes, space, content
    const atxMatch = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (atxMatch) {
      const level = atxMatch[1].length;
      // Strip trailing closing hashes (e.g. "## Heading ##")
      const rawText = atxMatch[2].replace(/\s+#+\s*$/, '').trim();
      const text = cleanHeadingText(rawText);
      if (text) {
        flatNodes.push({
          id: `heading-${i}-${flatNodes.length}`,
          level,
          text,
          rawText,
          line: i,
          slug: slugify(text),
          children: [],
        });
      }
      continue;
    }

    // 2. Setext headings: Text followed by line of === (H1) or --- (H2)
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
            slug: slugify(text),
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
            slug: slugify(text),
            children: [],
          });
        }
      }
    }
  }

  // Build recursive tree
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
