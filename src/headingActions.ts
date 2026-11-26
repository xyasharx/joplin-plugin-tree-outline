import type { JoplinApi } from 'api/types';
import type { CopyLinkFormat, HeadingNode } from './webview/protocol';

/**
 * Filters a heading tree to include only headings with `level <= maxDepth`.
 */
export function filterHeadingsByMaxDepth(
  headings: HeadingNode[],
  maxDepth: number,
): HeadingNode[] {
  const limit = Number.isFinite(maxDepth) ? Math.min(6, Math.max(1, Math.floor(maxDepth))) : 6;
  if (limit >= 6) return headings;

  const filterList = (nodes: HeadingNode[]): HeadingNode[] => {
    const out: HeadingNode[] = [];
    for (const node of nodes) {
      if (node.level <= limit) {
        out.push({
          ...node,
          children: filterList(node.children || []),
        });
      }
    }
    return out;
  };

  return filterList(headings);
}

/**
 * Flattens a heading tree in document top-to-bottom order.
 */
export function flattenHeadings(headings: HeadingNode[]): HeadingNode[] {
  const flat: HeadingNode[] = [];
  const walk = (nodes: HeadingNode[]): void => {
    for (const node of nodes) {
      flat.push(node);
      if (node.children && node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(headings);
  return flat;
}

/**
 * Resolves the active heading key for a 0-based editor cursor or scroll line.
 * Picks the last heading at or above `activeLine`, falling back to the first
 * heading when the cursor is before the note's first heading.
 */
export function resolveActiveHeadingKeyByLine(
  headings: HeadingNode[],
  activeLine: number,
  maxDepth = 6,
): string | null {
  const visible = flattenHeadings(filterHeadingsByMaxDepth(headings, maxDepth));
  if (visible.length === 0) return null;

  const targetLine = Number.isFinite(activeLine) ? Math.max(0, Math.floor(activeLine)) : 0;
  let matched: HeadingNode | null = null;

  for (const node of visible) {
    if (node.line <= targetLine) {
      matched = node;
    } else {
      break;
    }
  }

  return (matched ?? visible[0]).key;
}

/**
 * Resolves the active heading key from a rendered Markdown viewer scroll event
 * (using the rendered heading's DOM `id`/slug with ordinal index fallback).
 */
export function resolveActiveHeadingKeyBySlug(
  headings: HeadingNode[],
  slug: string,
  ordinalIndex?: number,
  maxDepth = 6,
): string | null {
  const allFlat = flattenHeadings(headings);
  const visibleFlat = flattenHeadings(filterHeadingsByMaxDepth(headings, maxDepth));
  if (visibleFlat.length === 0) return null;

  const visibleKeys = new Set(visibleFlat.map((h) => h.key));

  // 1. Direct slug match inside visible depth
  if (slug) {
    const exactVisible = visibleFlat.find((h) => h.slug === slug);
    if (exactVisible) return exactVisible.key;

    // If the active heading in the viewer is deeper than maxDepth, walk back to its
    // nearest preceding visible heading so scroll-spy stays accurate at the parent section!
    const exactAllIdx = allFlat.findIndex((h) => h.slug === slug);
    if (exactAllIdx !== -1) {
      for (let i = exactAllIdx; i >= 0; i--) {
        if (visibleKeys.has(allFlat[i].key)) {
          return allFlat[i].key;
        }
      }
      return visibleFlat[0].key;
    }
  }

  // 2. Ordinal heading index fallback (for headings without an explicit HTML id)
  if (typeof ordinalIndex === 'number' && Number.isFinite(ordinalIndex) && ordinalIndex >= 0) {
    const clampedIdx = Math.min(Math.floor(ordinalIndex), allFlat.length - 1);
    for (let i = clampedIdx; i >= 0; i--) {
      if (visibleKeys.has(allFlat[i].key)) {
        return allFlat[i].key;
      }
    }
    return visibleFlat[0].key;
  }

  return null;
}

/**
 * Escapes characters that break Markdown link labels (`[`, `]`, `\`).
 */
export function escapeMarkdownLinkLabel(text: string): string {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/**
 * Escapes characters that break Markdown inline link destinations `(`, `)`, and
 * whitespace while preserving Unicode slugs (Persian, Arabic, CJK, accented Latin).
 */
function sanitizeMarkdownLinkSlug(slug: string): string {
  return String(slug || '')
    .replace(/^#/, '')
    .trim()
    .replace(/\s+/g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

/**
 * Formats a Joplin internal Markdown heading link `[Title](:/noteId#slug)`
 * (or `[Title](#slug)` if `noteId` is absent).
 */
export function formatJoplinHeadingLink(noteId: string, text: string, slug: string): string {
  const safeLabel = escapeMarkdownLinkLabel(text) || slug || 'Heading';
  const cleanSlug = sanitizeMarkdownLinkSlug(slug);
  const cleanNoteId = String(noteId || '').trim();
  if (cleanNoteId && cleanSlug) {
    return `[${safeLabel}](:/${cleanNoteId}#${cleanSlug})`;
  }
  if (cleanNoteId) {
    return `[${safeLabel}](:/${cleanNoteId})`;
  }
  return `[${safeLabel}](#${cleanSlug})`;
}

/**
 * Formats a plain Markdown heading anchor `#slug`.
 */
export function formatPlainHeadingAnchor(slug: string): string {
  const cleanSlug = String(slug || '').replace(/^#/, '').trim();
  return cleanSlug ? `#${cleanSlug}` : '#';
}

/**
 * Computes hierarchical display numbers (`1.`, `1.1`, `1.2`, `2.`) for every node
 * in a heading tree, keyed by `node.key`.
 */
export function computeHierarchicalNumbers(headings: HeadingNode[]): Map<string, string> {
  const numbers = new Map<string, string>();
  const walk = (nodes: HeadingNode[], prefix: number[]): void => {
    for (let i = 0; i < nodes.length; i++) {
      const path = [...prefix, i + 1];
      const label = path.length === 1 ? `${path[0]}.` : path.join('.');
      numbers.set(nodes[i].key, label);
      if (nodes[i].children && nodes[i].children.length > 0) {
        walk(nodes[i].children, path);
      }
    }
  };
  walk(headings, []);
  return numbers;
}

/**
 * Builds a clean, properly indented Markdown Table of Contents from a heading tree.
 */
export function buildMarkdownToc(
  headings: HeadingNode[],
  {
    maxDepth = 6,
    numbered = false,
  }: { maxDepth?: number; numbered?: boolean } = {},
): string {
  const filtered = filterHeadingsByMaxDepth(headings, maxDepth);
  const flat = flattenHeadings(filtered);
  if (flat.length === 0) return '';

  const minLevel = flat.reduce((min, h) => Math.min(min, h.level), 6);
  const numberMap = numbered ? computeHierarchicalNumbers(filtered) : null;

  const lines = flat.map((node) => {
    const indent = '  '.repeat(Math.max(0, node.level - minLevel));
    const safeTitle = escapeMarkdownLinkLabel(node.text);
    const numPrefix = numberMap?.has(node.key) ? `${numberMap.get(node.key)} ` : '';
    const slug = sanitizeMarkdownLinkSlug(node.slug || '');
    return `${indent}- ${numPrefix}[${safeTitle}](#${slug})`;
  });

  return lines.join('\n');
}

export interface ActionResult {
  ok: boolean;
  message: string;
  kind: 'success' | 'info' | 'error';
  copiedText?: string;
}

/**
 * Copies either a Joplin internal Markdown heading link or a plain `#slug` anchor
 * using Joplin's native sandbox-safe `joplin.clipboard.writeText()` API.
 */
export async function copyHeadingLinkToClipboard(
  joplinApi: Pick<JoplinApi, 'clipboard'>,
  {
    noteId,
    format,
    slug,
    text,
  }: { noteId: string; format: CopyLinkFormat; slug: string; text: string },
): Promise<ActionResult> {
  const formatted =
    format === 'slug'
      ? formatPlainHeadingAnchor(slug)
      : formatJoplinHeadingLink(noteId, text, slug);

  if (typeof joplinApi.clipboard?.writeText !== 'function') {
    return {
      ok: false,
      kind: 'error',
      message: 'Clipboard API is unavailable in this Joplin version',
    };
  }

  try {
    await joplinApi.clipboard.writeText(formatted);
    return {
      ok: true,
      kind: 'success',
      message: format === 'slug' ? `Copied anchor ${formatted}` : 'Copied Joplin Markdown link',
      copiedText: formatted,
    };
  } catch {
    return {
      ok: false,
      kind: 'error',
      message: 'Failed to write link to clipboard',
    };
  }
}

/**
 * Inserts a generated Markdown Table of Contents into the active editor via
 * `insertText` (falling back to `replaceSelection`, or copying to clipboard if
 * the user is currently in Viewer-only mode).
 */
export async function insertMarkdownTocIntoNote(
  joplinApi: Pick<JoplinApi, 'commands' | 'clipboard'>,
  headings: HeadingNode[],
  options: { maxDepth?: number; numbered?: boolean } = {},
): Promise<ActionResult> {
  const toc = buildMarkdownToc(headings, options);
  if (!toc) {
    return {
      ok: false,
      kind: 'info',
      message: 'No headings available to generate a Table of Contents',
    };
  }

  const payload = `${toc}\n`;

  try {
    await joplinApi.commands.execute('insertText', payload);
    return {
      ok: true,
      kind: 'success',
      message: 'Inserted Markdown Table of Contents',
      copiedText: toc,
    };
  } catch {
    // Fallback to replaceSelection for older Joplin editors
  }

  try {
    await joplinApi.commands.execute('replaceSelection', payload);
    return {
      ok: true,
      kind: 'success',
      message: 'Inserted Markdown Table of Contents',
      copiedText: toc,
    };
  } catch {
    // Viewer-only mode or editor not focused — fall back cleanly to clipboard copy
  }

  if (typeof joplinApi.clipboard?.writeText === 'function') {
    try {
      await joplinApi.clipboard.writeText(toc);
      return {
        ok: true,
        kind: 'info',
        message: 'Copied Markdown TOC to clipboard (open editor to insert)',
        copiedText: toc,
      };
    } catch {
      // Fall through to error message
    }
  }

  return {
    ok: false,
    kind: 'error',
    message: 'Unable to insert TOC — switch to the editor and try again',
  };
}
