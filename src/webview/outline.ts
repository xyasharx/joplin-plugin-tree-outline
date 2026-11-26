import { findSearchMatchRanges, normalizeForSearch } from '../searchUtils';
import type {
  FontPreset,
  HeadingNode,
  NoteSelectionKind,
  OutlineUpdateMessage,
  PluginToWebviewMessage,
  PreferencesUpdateMessage,
  TextWrapMode,
  WebviewToPluginMessage,
} from './protocol';

type WebviewIncomingEvent =
  | PluginToWebviewMessage
  | { message?: PluginToWebviewMessage }
  | null
  | undefined;

interface JoplinWebviewApi {
  postMessage: (message: WebviewToPluginMessage) => Promise<any> | void;
  onMessage?: (handler: (event: WebviewIncomingEvent) => void) => void;
}

declare global {
  const webviewApi: JoplinWebviewApi | undefined;
  interface Window {
    webviewApi?: JoplinWebviewApi;
  }
}

const MAX_REMEMBERED_NOTES = 100;
const AUTO_WRAP_MAX_WIDTH = 650;
const CACHE_TEXT_WRAP_MODE_KEY = 'treeOutline_textWrapMode';
const LEGACY_WRAP_KEY = 'treeOutline_isWrapped';

const FONT_OVERRIDE_CLASSES: readonly string[] = [
  'override-inter',
  'override-roboto',
  'override-vazirmatn',
  'override-arabic',
  'override-hebrew',
  'override-cjk-sc',
  'override-cjk-jp',
  'override-devanagari',
  'override-lora',
  'override-mono',
  'override-system',
];

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
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"></polyline></svg>';

const api: JoplinWebviewApi | null =
  typeof webviewApi !== 'undefined' ? webviewApi : window.webviewApi ?? null;

let currentNoteId = '';
let currentSelectionKind: NoteSelectionKind = 'none';
let currentMarkupLanguage = 1;
let currentTextWrapMode: TextWrapMode = 'auto';
let allHeadings: HeadingNode[] = [];
let activeHeadingKey: string | null = null;
let focusedHeadingKey: string | null = null;
let isAllCollapsed = false;
let lastAppliedVersion = -1;
let initialized = false;

/** Maps noteId -> Set of collapsed stable HeadingNode.key values. */
const collapsedByNote = new Map<string, Set<string>>();

/** Maps currently rendered node key -> HeadingNode for delegated click & keyboard handling. */
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
    // Ignore storage errors in restricted/sandboxed WebViews.
  }
}

/**
 * Unwraps Joplin's webviewApi.onMessage event envelope ({ message: payload })
 * while also accepting direct payload objects cleanly.
 */
function unwrapWebviewMessage(raw: WebviewIncomingEvent): PluginToWebviewMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  if ('message' in raw && raw.message && typeof raw.message === 'object') {
    return raw.message;
  }
  return raw as PluginToWebviewMessage;
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

function readCachedTextWrapMode(): TextWrapMode {
  const cached = safeStorageGet(CACHE_TEXT_WRAP_MODE_KEY);
  if (cached === 'auto' || cached === 'wrapped' || cached === 'nowrap') {
    return cached;
  }
  const legacy = safeStorageGet(LEGACY_WRAP_KEY);
  if (legacy === 'true') return 'wrapped';
  if (legacy === 'false') return 'nowrap';
  return 'auto';
}

function resolveVisualWrap(mode: TextWrapMode): boolean {
  if (mode === 'wrapped') return true;
  if (mode === 'nowrap') return false;
  return window.innerWidth <= AUTO_WRAP_MAX_WIDTH;
}

function applyTextWrapMode(mode: TextWrapMode): void {
  currentTextWrapMode = mode;
  const container = getOutlineContainer();
  const wrapToggleBtn = getWrapToggleBtn();
  const isWrapped = resolveVisualWrap(mode);

  container?.classList.toggle('is-wrapped', isWrapped);

  if (wrapToggleBtn) {
    wrapToggleBtn.classList.toggle('is-active', isWrapped);
    wrapToggleBtn.setAttribute('aria-pressed', isWrapped ? 'true' : 'false');
    const label = isWrapped ? 'Switch to single-line headings' : 'Wrap long headings';
    wrapToggleBtn.setAttribute('title', label);
    wrapToggleBtn.setAttribute('aria-label', label);
  }
}

function applyFontPreset(preset: FontPreset): void {
  const container = getOutlineContainer();
  if (!container) return;

  for (const cls of FONT_OVERRIDE_CLASSES) {
    container.classList.remove(cls);
  }

  if (preset && preset !== 'auto') {
    const targetClass = `override-${preset}`;
    if (FONT_OVERRIDE_CLASSES.includes(targetClass)) {
      container.classList.add(targetClass);
    }
  }
}

function applyPreferencesUpdate(msg: PreferencesUpdateMessage): void {
  if (!msg.preferences || typeof msg.preferences !== 'object') return;
  const { textWrapMode, fontPreset } = msg.preferences;

  if (textWrapMode === 'auto' || textWrapMode === 'wrapped' || textWrapMode === 'nowrap') {
    applyTextWrapMode(textWrapMode);
    safeStorageSet(CACHE_TEXT_WRAP_MODE_KEY, textWrapMode);
  }

  if (typeof fontPreset === 'string') {
    applyFontPreset(fontPreset);
  }
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
    clearBtn.style.display = query ? 'inline-flex' : 'none';
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

/**
 * Returns all currently visible [role="treeitem"] elements in visual top-to-bottom order,
 * skipping subtrees nested inside collapsed parent nodes.
 */
function getVisibleTreeItems(): HTMLElement[] {
  const treeContainer = getTreeContainer();
  if (!treeContainer) return [];

  const visible: HTMLElement[] = [];

  const walk = (parentEl: HTMLElement): void => {
    const kids = parentEl.children;
    if (!kids) return;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i] as HTMLElement;
      if (child.getAttribute?.('role') === 'treeitem') {
        visible.push(child);
        if (!child.classList.contains('is-collapsed')) {
          const grandKids = child.children;
          if (grandKids) {
            for (let j = 0; j < grandKids.length; j++) {
              const maybeGroup = grandKids[j] as HTMLElement;
              if (maybeGroup.classList?.contains('tree-item-children')) {
                walk(maybeGroup);
              }
            }
          }
        }
      }
    }
  };

  walk(treeContainer);
  return visible;
}

function getAllTreeItems(): HTMLElement[] {
  const treeContainer = getTreeContainer();
  if (!treeContainer) return [];

  const all: HTMLElement[] = [];
  const walk = (el: HTMLElement): void => {
    const kids = el.children;
    if (!kids) return;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i] as HTMLElement;
      if (child.getAttribute?.('role') === 'treeitem') {
        all.push(child);
      }
      walk(child);
    }
  };

  walk(treeContainer);
  return all;
}

function setRovingFocus(
  targetItem: HTMLElement,
  { moveDomFocus = true }: { moveDomFocus?: boolean } = {},
): void {
  const allItems = getAllTreeItems();
  for (const item of allItems) {
    item.setAttribute('tabindex', item === targetItem ? '0' : '-1');
  }

  const key = targetItem.getAttribute('data-node-key');
  if (key) {
    focusedHeadingKey = key;
  }

  if (moveDomFocus) {
    targetItem.focus();
    if (typeof targetItem.scrollIntoView === 'function') {
      targetItem.scrollIntoView({ block: 'nearest' });
    }
  }
}

function syncRovingTabIndex(): void {
  const visible = getVisibleTreeItems();
  if (visible.length === 0) return;

  const preferred =
    visible.find((el) => focusedHeadingKey !== null && el.getAttribute('data-node-key') === focusedHeadingKey) ??
    visible.find((el) => activeHeadingKey !== null && el.getAttribute('data-node-key') === activeHeadingKey) ??
    visible[0];

  setRovingFocus(preferred, { moveDomFocus: false });
}

function getDirectChildrenGroup(treeItem: HTMLElement): HTMLElement | null {
  const kids = treeItem.children;
  if (!kids) return null;
  for (let i = 0; i < kids.length; i++) {
    const child = kids[i] as HTMLElement;
    if (child.classList?.contains('tree-item-children')) {
      return child;
    }
  }
  return null;
}

function getFirstDirectChildTreeItem(treeItem: HTMLElement): HTMLElement | null {
  const group = getDirectChildrenGroup(treeItem);
  if (!group?.children) return null;
  for (let i = 0; i < group.children.length; i++) {
    const child = group.children[i] as HTMLElement;
    if (child.getAttribute?.('role') === 'treeitem') {
      return child;
    }
  }
  return null;
}

function getParentTreeItem(treeItem: HTMLElement): HTMLElement | null {
  const parentGroup = treeItem.parentElement;
  if (!parentGroup || !parentGroup.classList?.contains('tree-item-children')) {
    return null;
  }
  const owner = parentGroup.parentElement;
  return owner && owner.getAttribute?.('role') === 'treeitem' ? owner : null;
}

function setBranchCollapsed(treeItem: HTMLElement, collapsed: boolean): void {
  const nodeKey = treeItem.getAttribute('data-node-key');
  if (!nodeKey || !getDirectChildrenGroup(treeItem)) return;

  treeItem.classList.toggle('is-collapsed', collapsed);
  treeItem.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

  const collapsedSet = getCollapsedSet(currentNoteId);
  if (collapsed) {
    collapsedSet.add(nodeKey);
  } else {
    collapsedSet.delete(nodeKey);
  }

  syncCollapseAllButtonState();

  // If collapsing hid the previously roved descendant, move roving tabindex onto this item
  const visible = getVisibleTreeItems();
  const stillVisible = visible.some(
    (el) => focusedHeadingKey !== null && el.getAttribute('data-node-key') === focusedHeadingKey,
  );
  if (!stillVisible) {
    setRovingFocus(treeItem, { moveDomFocus: false });
  }
}

function activateHeadingItem(treeItem: HTMLElement): void {
  const nodeKey = treeItem.getAttribute('data-node-key');
  if (!nodeKey) return;
  const node = renderedNodesByKey.get(nodeKey);
  if (!node) return;

  const prevActiveRows = document.querySelectorAll('.tree-item-self.is-active');
  for (const activeEl of prevActiveRows) {
    activeEl.classList.remove('is-active');
  }
  for (const item of getAllTreeItems()) {
    item.removeAttribute('aria-current');
  }

  const row = treeItem.querySelector('.tree-item-self') as HTMLElement | null;
  row?.classList.add('is-active');
  treeItem.setAttribute('aria-current', 'location');
  activeHeadingKey = node.key;
  setRovingFocus(treeItem, { moveDomFocus: false });

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

function createNodeElement(
  node: HeadingNode,
  searchQuery: string,
  collapsedSet: Set<string>,
  depth: number,
  posInSet: number,
  setSize: number,
): HTMLElement {
  renderedNodesByKey.set(node.key, node);

  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isCollapsed = hasChildren && !searchQuery && collapsedSet.has(node.key);
  const isActive = activeHeadingKey !== null && activeHeadingKey === node.key;

  const item = document.createElement('div');
  item.className = isCollapsed ? 'tree-item is-collapsed' : 'tree-item';
  item.id = node.id;
  item.setAttribute('role', 'treeitem');
  item.setAttribute('tabindex', '-1');
  item.setAttribute('aria-level', String(depth));
  item.setAttribute('aria-posinset', String(posInSet));
  item.setAttribute('aria-setsize', String(setSize));
  item.setAttribute('data-level', String(node.level));
  item.setAttribute('data-node-key', node.key);
  if (hasChildren) {
    item.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  }
  if (isActive) {
    item.setAttribute('aria-current', 'location');
  }

  const self = document.createElement('div');
  self.className = isActive ? 'tree-item-self is-active' : 'tree-item-self';
  self.setAttribute('data-level', String(node.level));
  self.setAttribute('data-script', node.script || 'latin');
  self.setAttribute('data-node-key', node.key);

  const icon = document.createElement('span');
  icon.className = hasChildren ? 'collapse-icon' : 'collapse-icon is-hidden';
  icon.setAttribute('aria-hidden', 'true');
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
    const childCount = node.children.length;
    for (let i = 0; i < childCount; i++) {
      childrenContainer.appendChild(
        createNodeElement(node.children[i], searchQuery, collapsedSet, depth + 1, i + 1, childCount),
      );
    }
    item.appendChild(childrenContainer);
  }

  return item;
}

function renderStatusMessage(treeContainer: HTMLElement, text: string): void {
  const status = document.createElement('div');
  status.className = 'outline-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
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
  const rootCount = nodesToRender.length;
  for (let i = 0; i < rootCount; i++) {
    fragment.appendChild(
      createNodeElement(nodesToRender[i], query, collapsedSet, 1, i + 1, rootCount),
    );
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

  syncRovingTabIndex();
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
    if (treeItem) {
      const nowCollapsed = !treeItem.classList.contains('is-collapsed');
      setBranchCollapsed(treeItem, nowCollapsed);
    }
    return;
  }

  // 2. Heading row click -> jump to heading
  const row = target.closest('.tree-item-self') as HTMLElement | null;
  if (!row) return;

  const treeItem = row.closest('.tree-item') as HTMLElement | null;
  if (!treeItem) return;

  activateHeadingItem(treeItem);
}

/**
 * Full W3C WAI-ARIA APG Tree View keyboard interaction with RTL direction support:
 * - ArrowDown / ArrowUp: next / previous visible treeitem
 * - ArrowRight (LTR) / ArrowLeft (RTL): expand collapsed parent, or move to first child
 * - ArrowLeft (LTR) / ArrowRight (RTL): collapse expanded parent, or move to parent
 * - Home / End: first / last visible treeitem
 * - Enter / Space: activate focused heading (jump + set aria-current="location")
 * - *: expand all collapsed siblings at the same level
 */
function handleTreeKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const treeItem = target?.closest('.tree-item') as HTMLElement | null;
  if (!treeItem) return;

  const visible = getVisibleTreeItems();
  const currentIndex = visible.indexOf(treeItem);
  if (currentIndex === -1) return;

  const isRtl = getOutlineContainer()?.getAttribute('dir') === 'rtl';
  const expandKey = isRtl ? 'ArrowLeft' : 'ArrowRight';
  const collapseKey = isRtl ? 'ArrowRight' : 'ArrowLeft';

  switch (event.key) {
    case 'ArrowDown': {
      event.preventDefault();
      if (currentIndex < visible.length - 1) {
        setRovingFocus(visible[currentIndex + 1]);
      }
      break;
    }
    case 'ArrowUp': {
      event.preventDefault();
      if (currentIndex > 0) {
        setRovingFocus(visible[currentIndex - 1]);
      }
      break;
    }
    case 'Home': {
      event.preventDefault();
      setRovingFocus(visible[0]);
      break;
    }
    case 'End': {
      event.preventDefault();
      setRovingFocus(visible[visible.length - 1]);
      break;
    }
    case expandKey: {
      event.preventDefault();
      const expanded = treeItem.getAttribute('aria-expanded');
      if (expanded === 'false') {
        setBranchCollapsed(treeItem, false);
      } else if (expanded === 'true') {
        const firstChild = getFirstDirectChildTreeItem(treeItem);
        if (firstChild) {
          setRovingFocus(firstChild);
        }
      }
      break;
    }
    case collapseKey: {
      event.preventDefault();
      const expanded = treeItem.getAttribute('aria-expanded');
      if (expanded === 'true') {
        setBranchCollapsed(treeItem, true);
      } else {
        const parentItem = getParentTreeItem(treeItem);
        if (parentItem) {
          setRovingFocus(parentItem);
        }
      }
      break;
    }
    case 'Enter':
    case ' ': {
      event.preventDefault();
      activateHeadingItem(treeItem);
      break;
    }
    case '*': {
      event.preventDefault();
      const parentContainer = treeItem.parentElement;
      if (parentContainer?.children) {
        for (let i = 0; i < parentContainer.children.length; i++) {
          const sibling = parentContainer.children[i] as HTMLElement;
          if (sibling.getAttribute?.('aria-expanded') === 'false') {
            setBranchCollapsed(sibling, false);
          }
        }
      }
      break;
    }
  }
}

function applyOutlineUpdate(msg: OutlineUpdateMessage): void {
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
    focusedHeadingKey = null;
  } else {
    // Prune stale collapsed/active/focused keys if headings were deleted in this note
    if (activeHeadingKey !== null && !validKeys.has(activeHeadingKey)) {
      activeHeadingKey = null;
    }
    if (focusedHeadingKey !== null && !validKeys.has(focusedHeadingKey)) {
      focusedHeadingKey = null;
    }
    const collapsedSet = getCollapsedSet(currentNoteId);
    for (const key of Array.from(collapsedSet)) {
      if (!validKeys.has(key)) {
        collapsedSet.delete(key);
      }
    }
  }

  getOutlineContainer()?.classList.toggle('is-mobile', Boolean(msg.isMobile));
  setDirection(Boolean(msg.isRtl));

  const searchInput = getSearchInput();
  const activeQuery = searchInput ? searchInput.value.trim() : '';
  renderTree(allHeadings, activeQuery, { preserveScroll: !noteChanged });
}

function handleIncomingMessage(rawEvent: WebviewIncomingEvent): void {
  const msg = unwrapWebviewMessage(rawEvent);
  if (!msg) return;

  if (msg.type === 'preferencesUpdate') {
    applyPreferencesUpdate(msg);
    return;
  }

  if (msg.type === 'outlineUpdate') {
    applyOutlineUpdate(msg);
  }
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

  // 1. Text wrap preference: seed optimistically from guarded cache until
  //    authoritative joplin.settings arrive via preferencesUpdate.
  applyTextWrapMode(readCachedTextWrapMode());

  wrapToggleBtn?.addEventListener('click', () => {
    const currentlyWrapped = Boolean(container?.classList.contains('is-wrapped'));
    const nextMode: TextWrapMode = currentlyWrapped ? 'nowrap' : 'wrapped';
    applyTextWrapMode(nextMode);
    safeStorageSet(CACHE_TEXT_WRAP_MODE_KEY, nextMode);
    if (api?.postMessage) {
      void api.postMessage({
        type: 'updatePreferences',
        textWrapMode: nextMode,
      });
    }
  });

  window.addEventListener('resize', () => {
    if (currentTextWrapMode === 'auto') {
      applyTextWrapMode('auto');
    }
  });

  // 2. Search toggle
  searchToggleBtn?.addEventListener('click', () => {
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
  searchClearBtn?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
    }
    updateSearchClearVisibility('');
    renderTree(allHeadings, '');
    searchInput?.focus();
  });

  // 5. Collapse / Expand all
  collapseAllBtn?.addEventListener('click', () => {
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

    for (const item of getAllTreeItems()) {
      if (getDirectChildrenGroup(item)) {
        item.classList.toggle('is-collapsed', nextCollapsed);
        item.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
      }
    }

    syncRovingTabIndex();
    syncCollapseAllButtonState();
  });

  // 6. Delegated click & W3C APG keyboard navigation on tree container
  treeContainer?.addEventListener('click', handleTreeClick);
  treeContainer?.addEventListener('keydown', handleTreeKeyDown);

  // 7. Request a lightweight diff sync when panel regains visibility/focus
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

  // 8. Push listener from plugin host (registered BEFORE sending 'ready')
  if (api?.onMessage) {
    api.onMessage(handleIncomingMessage);
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
