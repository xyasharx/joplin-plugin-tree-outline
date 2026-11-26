import { findSearchMatchRanges, normalizeForSearch } from '../searchUtils';
import type {
  HeadingNode,
  NoteSelectionKind,
  PluginToWebviewMessage,
  WebviewToPluginMessage,
} from './protocol';

interface JoplinWebviewApi {
  postMessage: (message: WebviewToPluginMessage) => Promise<any> | void;
  onMessage?: (handler: (message: PluginToWebviewMessage) => void) => void;
}

declare global {
  const webviewApi: JoplinWebviewApi | undefined;
  interface Window {
    webviewApi?: JoplinWebviewApi;
  }
}

const MAX_REMEMBERED_NOTES = 100;

const COLLAPSE_ALL_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="4 14 10 14 10 20"></polyline>' +
  '<polyline points="20 10 14 10 14 4"></polyline>' +
  '<line x1="14" y1="10" x2="21" y2="3"></line>' +
  '<line x1="3" y1="21" x2="10" y2="14"></line>' +
  '</svg>';

const EXPAND_ALL_ICON_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="15 3 21 3 21 9"></polyline>' +
  '<polyline points="9 21 3 21 3 15"></polyline>' +
  '<line x1="21" y1="3" x2="14" y2="10"></line>' +
  '<line x1="3" y1="21" x2="10" y2="14"></line>' +
  '</svg>';

const CHEVRON_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:12px;height:12px;min-width:12px;max-width:12px;display:block;"><polyline points="6 9 12 15 18 9"></polyline></svg>';

const api: JoplinWebviewApi | null =
  typeof webviewApi !== 'undefined' ? webviewApi : window.webviewApi ?? null;

let currentNoteId = '';
let currentSelectionKind: NoteSelectionKind = 'none';
let currentMarkupLanguage = 1;
let allHeadings: HeadingNode[] = [];
let activeHeadingKey: string | null = null;
let isAllCollapsed = false;
let lastAppliedVersion = -1;
let initialized = false;

/** Maps noteId -> Set of collapsed stable HeadingNode.key values. */
const collapsedByNote = new Map<string, Set<string>>();

/** Maps currently rendered node key -> HeadingNode for delegated click handling. */
const renderedNodesByKey = new Map<string, HeadingNode>();

function safeStorageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors in restricted WebViews.
  }
}

function getTreeContainer(): HTMLElement | null {
  return document.getElementById('outline-tree');
}

function getSearchInput(): HTMLInputElement | null {
  return document.getElementById('search-input') as HTMLInputElement | null;
}

function getSearchContainer(): HTMLElement | null {
  return document.getElementById('search-container');
}

function getSearchToggleBtn(): HTMLElement | null {
  return document.getElementById('search-toggle-btn');
}

function getSearchClearBtn(): HTMLElement | null {
  return document.getElementById('search-clear-btn');
}

function getCollapseAllBtn(): HTMLElement | null {
  return document.getElementById('collapse-all-btn');
}

function getWrapToggleBtn(): HTMLElement | null {
  return document.getElementById('wrap-toggle-btn');
}

function getOutlineContainer(): HTMLElement | null {
  return document.getElementById('outline-container');
}

function getCollapsedSet(noteId: string): Set<string> {
  if (!noteId) return new Set();
  let set = collapsedByNote.get(noteId);
  if (!set) {
    if (collapsedByNote.size >= MAX_REMEMBERED_NOTES) {
      const oldestKey = collapsedByNote.keys().next().value;
      if (oldestKey !== undefined) {
        collapsedByNote.delete(oldestKey);
      }
    }
    set = new Set<string>();
    collapsedByNote.set(noteId, set);
  }
  return set;
}

function collectCollapsibleKeys(nodes: HeadingNode[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      out.push(node.key);
      collectCollapsibleKeys(node.children, out);
    }
  }
  return out;
}

function collectAllKeys(nodes: HeadingNode[], out: Set<string> = new Set()): Set<string> {
  for (const node of nodes) {
    out.add(node.key);
    if (node.children && node.children.length > 0) {
      collectAllKeys(node.children, out);
    }
  }
  return out;
}

function countTotalHeadings(nodes: HeadingNode[]): number {
  let count = 0;
  for (const node of nodes) {
    count += 1;
    if (node.children && node.children.length > 0) {
      count += countTotalHeadings(node.children);
    }
  }
  return count;
}

function setDirection(isRtl: boolean): void {
  const dir = isRtl ? 'rtl' : 'ltr';
  document.body.setAttribute('dir', dir);
  const container = getOutlineContainer();
  if (container) {
    container.setAttribute('dir', dir);
  }
}

function updateSearchClearVisibility(query: string): void {
  const clearBtn = getSearchClearBtn();
  if (clearBtn) {
    clearBtn.style.display = query ? 'block' : 'none';
  }
}

function syncCollapseAllButtonState(): void {
  const btn = getCollapseAllBtn();
  const collapsibleKeys = collectCollapsibleKeys(allHeadings);
  const collapsedSet = getCollapsedSet(currentNoteId);

  isAllCollapsed =
    collapsibleKeys.length > 0 && collapsibleKeys.every((key) => collapsedSet.has(key));

  if (!btn) return;

  btn.classList.toggle('is-active', isAllCollapsed);
  btn.setAttribute('aria-pressed', isAllCollapsed ? 'true' : 'false');

  const label = isAllCollapsed ? 'Expand all sections' : 'Collapse all sections';
  btn.setAttribute('title', label);
  btn.setAttribute('aria-label', label);
  btn.innerHTML = isAllCollapsed ? EXPAND_ALL_ICON_SVG : COLLAPSE_ALL_ICON_SVG;
}

function setSearchOpen(open: boolean, { returnFocus = false } = {}): void {
  const searchContainer = getSearchContainer();
  const searchToggleBtn = getSearchToggleBtn();
  const searchInput = getSearchInput();
  if (!searchContainer) return;

  searchContainer.classList.toggle('is-visible', open);

  if (searchToggleBtn) {
    searchToggleBtn.classList.toggle('is-active', open);
    searchToggleBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    const label = open ? 'Close heading filter' : 'Filter headings';
    searchToggleBtn.setAttribute('title', label);
    searchToggleBtn.setAttribute('aria-label', label);
  }

  if (open) {
    searchInput?.focus();
  } else {
    const hadQuery = Boolean(searchInput && searchInput.value.length > 0);
    if (searchInput) {
      searchInput.value = '';
    }
    updateSearchClearVisibility('');
    if (hadQuery) {
      renderTree(allHeadings, '');
    }
    if (returnFocus) {
      searchToggleBtn?.focus();
    }
  }
}

function appendHighlightedText(container: HTMLElement, text: string, searchQuery: string): void {
  if (!searchQuery) {
    container.textContent = text;
    return;
  }

  const ranges = findSearchMatchRanges(text, searchQuery);
  if (ranges.length === 0) {
    container.textContent = text;
    return;
  }

  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      container.appendChild(document.createTextNode(text.slice(cursor, range.start)));
    }
    const mark = document.createElement('mark');
    mark.className = 'highlight-match';
    mark.textContent = text.slice(range.start, range.end);
    container.appendChild(mark);
    cursor = range.end;
  }

  if (cursor < text.length) {
    container.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

function createNodeElement(
  node: HeadingNode,
  searchQuery: string,
  collapsedSet: Set<string>,
): HTMLElement {
  renderedNodesByKey.set(node.key, node);

  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isCollapsed = hasChildren && !searchQuery && collapsedSet.has(node.key);

  const item = document.createElement('div');
  item.className = isCollapsed ? 'tree-item is-collapsed' : 'tree-item';
  item.id = node.id;
  item.setAttribute('role', 'treeitem');
  item.setAttribute('data-level', String(node.level));
  item.setAttribute('data-node-key', node.key);
  if (hasChildren) {
    item.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  }

  const self = document.createElement('div');
  self.className = 'tree-item-self';
  self.setAttribute('data-level', String(node.level));
  self.setAttribute('data-script', node.script || 'latin');
  self.setAttribute('data-node-key', node.key);

  if (activeHeadingKey !== null && activeHeadingKey === node.key) {
    self.classList.add('is-active');
    self.setAttribute('aria-current', 'location');
  }

  const icon = document.createElement('div');
  icon.className = hasChildren ? 'collapse-icon' : 'collapse-icon is-hidden';
  icon.setAttribute('data-node-key', node.key);
  icon.innerHTML = CHEVRON_SVG;

  const inner = document.createElement('bdi');
  inner.className = 'tree-item-inner';
  inner.title = `${node.text} (H${node.level})`;
  appendHighlightedText(inner, node.text, searchQuery);

  self.appendChild(icon);
  self.appendChild(inner);
  item.appendChild(self);

  if (hasChildren) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-item-children';
    childrenContainer.setAttribute('role', 'group');
    for (const child of node.children) {
      childrenContainer.appendChild(createNodeElement(child, searchQuery, collapsedSet));
    }
    item.appendChild(childrenContainer);
  }

  return item;
}

function renderStatusMessage(treeContainer: HTMLElement, text: string): void {
  const status = document.createElement('div');
  status.className = 'outline-status';
  status.textContent = text;
  if (typeof treeContainer.replaceChildren === 'function') {
    treeContainer.replaceChildren(status);
  } else {
    treeContainer.innerHTML = '';
    treeContainer.appendChild(status);
  }
}

function filterNodes(nodes: HeadingNode[], normalizedQuery: string): HeadingNode[] {
  const filtered: HeadingNode[] = [];
  for (const node of nodes) {
    const match = normalizeForSearch(node.text).includes(normalizedQuery);
    const childMatches = filterNodes(node.children || [], normalizedQuery);
    if (match || childMatches.length > 0) {
      filtered.push({
        ...node,
        children: childMatches,
      });
    }
  }
  return filtered;
}

function renderTree(
  headings: HeadingNode[],
  query = '',
  { preserveScroll = false } = {},
): void {
  const treeContainer = getTreeContainer();
  const searchInput = getSearchInput();
  if (!treeContainer) return;

  const prevScrollTop = preserveScroll ? treeContainer.scrollTop : 0;
  renderedNodesByKey.clear();

  const totalCount = countTotalHeadings(headings || []);
  if (searchInput && !query) {
    searchInput.placeholder =
      totalCount > 0 ? `Filter ${totalCount} headings...` : 'Filter headings...';
  }

  if (currentSelectionKind === 'none') {
    renderStatusMessage(treeContainer, 'Select a note to view outline');
    syncCollapseAllButtonState();
    return;
  }

  if (currentSelectionKind === 'multiple') {
    renderStatusMessage(treeContainer, 'Multiple notes selected');
    syncCollapseAllButtonState();
    return;
  }

  if (!headings || headings.length === 0) {
    renderStatusMessage(treeContainer, 'No headings found in this note');
    syncCollapseAllButtonState();
    return;
  }

  const normalizedQuery = normalizeForSearch(query);
  const nodesToRender = normalizedQuery ? filterNodes(headings, normalizedQuery) : headings;

  if (nodesToRender.length === 0) {
    renderStatusMessage(treeContainer, 'No matching headings found');
    return;
  }

  const collapsedSet = getCollapsedSet(currentNoteId);
  const fragment = document.createDocumentFragment();
  for (const node of nodesToRender) {
    fragment.appendChild(createNodeElement(node, query, collapsedSet));
  }

  if (typeof treeContainer.replaceChildren === 'function') {
    treeContainer.replaceChildren(fragment);
  } else {
    treeContainer.innerHTML = '';
    treeContainer.appendChild(fragment);
  }

  if (preserveScroll) {
    treeContainer.scrollTop = prevScrollTop;
  } else {
    treeContainer.scrollTop = 0;
  }

  syncCollapseAllButtonState();
}

function handleTreeClick(event: Event): void {
  const target = event.target as HTMLElement | null;
  if (!target) return;

  // 1. Collapse / expand chevron click
  const collapseIcon = target.closest('.collapse-icon') as HTMLElement | null;
  if (collapseIcon && !collapseIcon.classList.contains('is-hidden')) {
    event.stopPropagation();
    const treeItem = collapseIcon.closest('.tree-item') as HTMLElement | null;
    const nodeKey = collapseIcon.getAttribute('data-node-key');
    if (treeItem && nodeKey) {
      const nowCollapsed = treeItem.classList.toggle('is-collapsed');
      treeItem.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
      const collapsedSet = getCollapsedSet(currentNoteId);
      if (nowCollapsed) {
        collapsedSet.add(nodeKey);
      } else {
        collapsedSet.delete(nodeKey);
      }
      syncCollapseAllButtonState();
    }
    return;
  }

  // 2. Heading row click -> jump to heading
  const row = target.closest('.tree-item-self') as HTMLElement | null;
  if (!row) return;

  const nodeKey = row.getAttribute('data-node-key');
  if (!nodeKey) return;
  const node = renderedNodesByKey.get(nodeKey);
  if (!node) return;

  const actives = document.querySelectorAll('.tree-item-self.is-active');
  for (const activeEl of actives) {
    activeEl.classList.remove('is-active');
    activeEl.removeAttribute('aria-current');
  }
  row.classList.add('is-active');
  row.setAttribute('aria-current', 'location');
  activeHeadingKey = node.key;

  if (api?.postMessage) {
    void api.postMessage({
      type: 'jumpToHeading',
      line: node.line,
      slug: node.slug,
      text: node.text,
      level: node.level,
      hasExplicitId: node.hasExplicitId,
      markupLanguage: currentMarkupLanguage,
    });
  }
}

function applyOutlineUpdate(msg: PluginToWebviewMessage): void {
  if (!msg || msg.type !== 'outlineUpdate') return;
  if (typeof msg.version === 'number' && msg.version < lastAppliedVersion) {
    return;
  }
  lastAppliedVersion = typeof msg.version === 'number' ? msg.version : lastAppliedVersion;

  const noteChanged = Boolean(msg.noteChanged) || msg.noteId !== currentNoteId;
  currentNoteId = msg.noteId || '';
  currentSelectionKind = msg.selectionKind || (currentNoteId ? 'single' : 'none');
  currentMarkupLanguage = typeof msg.markupLanguage === 'number' ? msg.markupLanguage : 1;
  allHeadings = Array.isArray(msg.headings) ? msg.headings : [];

  const validKeys = collectAllKeys(allHeadings);

  if (noteChanged) {
    activeHeadingKey = null;
  } else {
    // Prune stale collapsed/active keys if headings were deleted in this note
    if (activeHeadingKey !== null && !validKeys.has(activeHeadingKey)) {
      activeHeadingKey = null;
    }
    const collapsedSet = getCollapsedSet(currentNoteId);
    for (const key of Array.from(collapsedSet)) {
      if (!validKeys.has(key)) {
        collapsedSet.delete(key);
      }
    }
  }

  setDirection(Boolean(msg.isRtl));

  const searchInput = getSearchInput();
  const activeQuery = searchInput ? searchInput.value.trim() : '';
  renderTree(allHeadings, activeQuery, { preserveScroll: !noteChanged });
}

function bindButtonActivation(el: HTMLElement | null, handler: () => void): void {
  if (!el) return;
  el.addEventListener('click', handler);
  el.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  });
}

function initEventHandlers(): void {
  if (initialized) return;
  initialized = true;

  const container = getOutlineContainer();
  const wrapToggleBtn = getWrapToggleBtn();
  const searchToggleBtn = getSearchToggleBtn();
  const searchContainer = getSearchContainer();
  const searchInput = getSearchInput();
  const searchClearBtn = getSearchClearBtn();
  const collapseAllBtn = getCollapseAllBtn();
  const treeContainer = getTreeContainer();

  // 1. Wrap preference (safe localStorage access)
  if (container) {
    const savedWrap = safeStorageGet('treeOutline_isWrapped');
    const isWrapped = savedWrap !== null ? savedWrap === 'true' : window.innerWidth <= 650;

    container.classList.toggle('is-wrapped', isWrapped);
    if (wrapToggleBtn) {
      wrapToggleBtn.classList.toggle('is-active', isWrapped);
      wrapToggleBtn.setAttribute('aria-pressed', isWrapped ? 'true' : 'false');
    }

    bindButtonActivation(wrapToggleBtn, () => {
      const currentlyWrapped = container.classList.toggle('is-wrapped');
      if (wrapToggleBtn) {
        wrapToggleBtn.classList.toggle('is-active', currentlyWrapped);
        wrapToggleBtn.setAttribute('aria-pressed', currentlyWrapped ? 'true' : 'false');
      }
      safeStorageSet('treeOutline_isWrapped', currentlyWrapped ? 'true' : 'false');
    });
  }

  // 2. Search toggle
  bindButtonActivation(searchToggleBtn, () => {
    const currentlyVisible = Boolean(searchContainer?.classList.contains('is-visible'));
    setSearchOpen(!currentlyVisible);
  });

  // 3. Live filter input + Escape key handler
  searchInput?.addEventListener('input', () => {
    const query = searchInput.value.trim();
    updateSearchClearVisibility(query);
    renderTree(allHeadings, query);
  });

  searchInput?.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();

    if (searchInput.value.length > 0) {
      searchInput.value = '';
      updateSearchClearVisibility('');
      renderTree(allHeadings, '');
    } else {
      setSearchOpen(false, { returnFocus: true });
    }
  });

  // 4. Clear search button
  bindButtonActivation(searchClearBtn, () => {
    if (searchInput) {
      searchInput.value = '';
    }
    updateSearchClearVisibility('');
    renderTree(allHeadings, '');
    searchInput?.focus();
  });

  // 5. Collapse / Expand all
  bindButtonActivation(collapseAllBtn, () => {
    const collapsibleKeys = collectCollapsibleKeys(allHeadings);
    if (collapsibleKeys.length === 0) return;

    const nextCollapsed = !isAllCollapsed;
    const collapsedSet = getCollapsedSet(currentNoteId);

    if (nextCollapsed) {
      for (const key of collapsibleKeys) {
        collapsedSet.add(key);
      }
    } else {
      collapsedSet.clear();
    }

    const treeItems = document.querySelectorAll('.tree-item');
    for (const item of treeItems) {
      if (item.querySelector('.tree-item-children')) {
        item.classList.toggle('is-collapsed', nextCollapsed);
        item.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
      }
    }

    syncCollapseAllButtonState();
  });

  // 6. Delegated click handler on tree container
  treeContainer?.addEventListener('click', handleTreeClick);

  // 7. Request a lightweight diff sync when panel regains visibility/focus
  //    (covers mobile re-entering a note without any background interval polling)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && api?.postMessage) {
      void api.postMessage({ type: 'requestSync', force: false });
    }
  });

  window.addEventListener('focus', () => {
    if (api?.postMessage) {
      void api.postMessage({ type: 'requestSync', force: false });
    }
  });

  // 8. Push listener from plugin host
  if (api?.onMessage) {
    api.onMessage((msg: PluginToWebviewMessage) => {
      applyOutlineUpdate(msg);
    });
  }

  // 9. Single initial ready handshake
  if (api?.postMessage) {
    void api.postMessage({ type: 'ready' });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEventHandlers, { once: true });
} else {
  initEventHandlers();
}
