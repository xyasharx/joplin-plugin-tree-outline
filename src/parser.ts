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
      .replace(/[*_~`]/g, '')                 // Markdown styles
      .trim();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^(```|~~~)/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.*)$/);
    if (match) {
      const level = match[1].length;
      const rawText = match[2].trim();
      const text = cleanHeadingText(rawText);
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
