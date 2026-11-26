import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const srcHtmlPath = path.join(repoRoot, 'src', 'webview', 'outline.html');
const distCssPath = path.join(repoRoot, 'dist', 'webview', 'outline.css');
const distWebviewPath = path.join(repoRoot, 'dist', 'webview', 'outline.js');

/**
 * Spec-faithful lightweight DOM harness supporting parentElement, children,
 * focus tracking, closest(), querySelector(), querySelectorAll(), and event bubbling.
 */
function createA11yWebviewHarness({ isRtl = false, isMobile = false } = {}) {
  const byId = new Map();
  let focusedElement = null;

  class ClassList {
    constructor() {
      this._set = new Set();
    }
    add(...names) {
      for (const n of names) if (n) this._set.add(n);
    }
    remove(...names) {
      for (const n of names) this._set.delete(n);
    }
    contains(name) {
      return this._set.has(name);
    }
    toggle(name, force) {
      if (typeof force === 'boolean') {
        if (force) this._set.add(name);
        else this._set.delete(name);
        return force;
      }
      if (this._set.has(name)) {
        this._set.delete(name);
        return false;
      }
      this._set.add(name);
      return true;
    }
    _syncFromString(str) {
      this._set.clear();
      for (const part of String(str).split(/\s+/)) {
        if (part) this._set.add(part);
      }
    }
    toString() {
      return Array.from(this._set).join(' ');
    }
  }

  class Node {
    constructor(nodeType, tagName = '') {
      this.nodeType = nodeType;
      this.tagName = tagName.toUpperCase();
      this.parentNode = null;
      this.childNodes = [];
    }
    appendChild(child) {
      if (child.nodeType === 11) {
        for (const c of [...child.childNodes]) {
          this.appendChild(c);
        }
        child.childNodes = [];
        return child;
      }
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }
    replaceChildren(...nodes) {
      this.childNodes = [];
      for (const n of nodes) this.appendChild(n);
    }
  }

  class Element extends Node {
    constructor(tagName, id = '') {
      super(1, tagName);
      this.attrs = new Map();
      this.classList = new ClassList();
      this.style = {};
      this.listeners = new Map();
      this.value = '';
      this.scrollTop = 0;
      this._innerHTML = '';
      if (id) {
        this.id = id;
      }
    }
    get id() {
      return this.attrs.get('id') || '';
    }
    set id(v) {
      this.attrs.set('id', String(v));
      byId.set(String(v), this);
    }
    get className() {
      return this.classList.toString();
    }
    set className(v) {
      this.classList._syncFromString(v);
    }
    get children() {
      return this.childNodes.filter((n) => n.nodeType === 1);
    }
    get parentElement() {
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    }
    get innerHTML() {
      return this._innerHTML;
    }
    set innerHTML(v) {
      this._innerHTML = String(v);
      this.childNodes = [];
    }
    setAttribute(k, v) {
      if (k === 'class') {
        this.className = v;
        return;
      }
      if (k === 'id') {
        this.id = v;
        return;
      }
      this.attrs.set(k, String(v));
    }
    getAttribute(k) {
      if (k === 'class') return this.className;
      return this.attrs.has(k) ? this.attrs.get(k) : null;
    }
    removeAttribute(k) {
      this.attrs.delete(k);
    }
    matches(selector) {
      if (selector.startsWith('.')) {
        return selector
          .slice(1)
          .split('.')
          .every((cls) => this.classList.contains(cls));
      }
      if (selector.startsWith('#')) {
        return this.id === selector.slice(1);
      }
      const attrMatch = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attrMatch) {
        const val = this.getAttribute(attrMatch[1]);
        return attrMatch[2] === undefined ? val !== null : val === attrMatch[2];
      }
      return this.tagName.toLowerCase() === selector.toLowerCase();
    }
    closest(selector) {
      let cur = this;
      while (cur) {
        if (cur.nodeType === 1 && cur.matches(selector)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }
    querySelectorAll(selector) {
      const results = [];
      const walk = (el) => {
        for (const child of el.children) {
          if (child.matches(selector)) results.push(child);
          walk(child);
        }
      };
      walk(this);
      return results;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }
    addEventListener(type, fn) {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    dispatchEvent(event) {
      const ev = {
        target: this,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this.propagationStopped = true;
        },
        ...event,
      };
      let cur = this;
      while (cur && !ev.propagationStopped) {
        for (const fn of cur.listeners?.get(ev.type) ?? []) {
          fn(ev);
        }
        cur = cur.parentNode;
      }
      return ev;
    }
    focus() {
      focusedElement = this;
    }
    scrollIntoView() {}
  }

  const body = new Element('body');
  const container = new Element('div', 'outline-container');
  const searchToggleBtn = new Element('button', 'search-toggle-btn');
  const wrapToggleBtn = new Element('button', 'wrap-toggle-btn');
  const collapseAllBtn = new Element('button', 'collapse-all-btn');
  const searchContainer = new Element('div', 'search-container');
  const searchInput = new Element('input', 'search-input');
  const searchClearBtn = new Element('button', 'search-clear-btn');
  const outlineTree = new Element('div', 'outline-tree');
  container.appendChild(outlineTree);
  body.appendChild(container);

  const posted = [];
  let onMessageHandler = null;

  const webviewApi = {
    postMessage(msg) {
      posted.push(JSON.parse(JSON.stringify(msg)));
    },
    onMessage(cb) {
      onMessageHandler = cb;
    },
  };

  const win = {
    innerWidth: 900,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    webviewApi,
    addEventListener() {},
  };

  const doc = {
    readyState: 'complete',
    visibilityState: 'visible',
    body,
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => {
      const n = new Node(3);
      n.textContent = text;
      return n;
    },
    createDocumentFragment: () => new Node(11),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener() {},
  };

  const code = fs.readFileSync(distWebviewPath, 'utf8');
  vm.runInNewContext(code, {
    window: win,
    document: doc,
    webviewApi,
    console,
    setTimeout,
    clearTimeout,
  });

  // Push a nested 3-level heading tree
  onMessageHandler({
    message: {
      type: 'outlineUpdate',
      version: 1,
      noteId: 'a11y-note',
      noteChanged: true,
      selectionKind: 'single',
      markupLanguage: 1,
      isRtl,
      isMobile,
      headings: [
        {
          id: 'h-1',
          key: 'root-1',
          level: 1,
          text: isRtl ? 'فصل اول' : 'Chapter 1',
          rawText: isRtl ? 'فصل اول' : 'Chapter 1',
          line: 0,
          slug: 'chapter-1',
          script: isRtl ? 'persian' : 'latin',
          children: [
            {
              id: 'h-1-1',
              key: 'child-1-1',
              level: 2,
              text: isRtl ? 'بخش الف' : 'Section 1.1',
              rawText: isRtl ? 'بخش الف' : 'Section 1.1',
              line: 3,
              slug: 'section-1-1',
              script: isRtl ? 'persian' : 'latin',
              children: [
                {
                  id: 'h-1-1-1',
                  key: 'leaf-1-1-1',
                  level: 3,
                  text: isRtl ? 'جزئیات' : 'Detail 1.1.1',
                  rawText: isRtl ? 'جزئیات' : 'Detail 1.1.1',
                  line: 6,
                  slug: 'detail-1-1-1',
                  script: isRtl ? 'persian' : 'latin',
                  children: [],
                },
              ],
            },
            {
              id: 'h-1-2',
              key: 'child-1-2',
              level: 2,
              text: isRtl ? 'بخش ب' : 'Section 1.2',
              rawText: isRtl ? 'بخش ب' : 'Section 1.2',
              line: 10,
              slug: 'section-1-2',
              script: isRtl ? 'persian' : 'latin',
              children: [],
            },
          ],
        },
        {
          id: 'h-2',
          key: 'root-2',
          level: 1,
          text: isRtl ? 'فصل دوم' : 'Chapter 2',
          rawText: isRtl ? 'فصل دوم' : 'Chapter 2',
          line: 15,
          slug: 'chapter-2',
          script: isRtl ? 'persian' : 'latin',
          children: [
            {
              id: 'h-2-1',
              key: 'child-2-1',
              level: 2,
              text: isRtl ? 'بخش ج' : 'Section 2.1',
              rawText: isRtl ? 'بخش ج' : 'Section 2.1',
              line: 18,
              slug: 'section-2-1',
              script: isRtl ? 'persian' : 'latin',
              children: [],
            },
          ],
        },
      ],
    },
  });

  return {
    container,
    outlineTree,
    posted,
    get focused() {
      return focusedElement;
    },
    itemByKey(key) {
      return outlineTree.querySelectorAll('.tree-item').find((el) => el.getAttribute('data-node-key') === key);
    },
    pressKey(key, onElement) {
      const target = onElement ?? focusedElement;
      assert.ok(target, `Expected a target element before pressing ${key}`);
      return target.dispatchEvent({ type: 'keydown', key });
    },
  };
}

describe('P2 #7: Joplin Theme Contrast, Modern CSS Tokens & Viewport/Typography Fixes', () => {
  it('uses --joplin-url-color for WCAG AA accent and native Joplin theme variables with zero hardcoded contrast bugs', () => {
    const css = fs.readFileSync(distCssPath, 'utf8');

    // WCAG AA accent token (matches both source and esbuild-minified CSS)
    assert.match(css, /--nav-accent:\s*var\(--joplin-url-color,\s*#155bda\)/i);
    assert.doesNotMatch(css, /--nav-accent:\s*var\(--joplin-selected-color/);

    // Native Joplin theme tokens present
    assert.ok(css.includes('--joplin-search-marker-background-color'));
    assert.ok(css.includes('--joplin-search-marker-color'));
    assert.ok(css.includes('--joplin-color-faded'));
    assert.ok(css.includes('--joplin-background-color3'));
    assert.ok(css.includes('--joplin-background-color-hover3'));
    assert.ok(css.includes('--joplin-font-family'));
    assert.ok(css.includes('--joplin-font-size'));

    // Modern CSS enhancements
    assert.match(css, /color-mix\(in srgb,/);
    assert.match(css, /height:\s*100dvh/);
    assert.ok(css.includes(':focus-visible'));
    assert.match(css, /@media\s*\(pointer:\s*coarse\)/);
    assert.ok(css.includes('.outline-container.is-mobile'));
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);

    // Regressions eliminated
    assert.ok(!css.includes('100vh'), 'Should use 100%/100dvh instead of 100vh');
    assert.doesNotMatch(css, /font-weight:\s*550/, 'Should use standard 500/600 font weights');
    assert.ok(!css.includes('#fff'), 'Should not hardcode #fff backgrounds');
    assert.ok(!css.includes('#888'), 'Should use --joplin-color-faded instead of #888');
    assert.doesNotMatch(css, /rgba\(\s*255,\s*214,\s*0,\s*0\.25\s*\)/, 'Should use native Joplin search marker tokens');
    assert.ok(
      !css.includes(':not([class*="override-"]) [dir="rtl"]'),
      'Broken descendant space before [dir="rtl"] must stay removed',
    );
  });

  it('allows user zoom in viewport meta tag and uses semantic <button type="button"> controls in outline.html', () => {
    const html = fs.readFileSync(srcHtmlPath, 'utf8');

    assert.ok(html.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0">'));
    assert.ok(!html.includes('user-scalable=no'));
    assert.ok(!html.includes('maximum-scale=1.0'));

    assert.ok(html.includes('<button type="button" class="clickable-icon nav-action-button" id="search-toggle-btn"'));
    assert.ok(html.includes('<button type="button" class="clickable-icon nav-action-button" id="wrap-toggle-btn"'));
    assert.ok(html.includes('<button type="button" class="clickable-icon nav-action-button" id="collapse-all-btn"'));
    assert.ok(html.includes('<button type="button" class="search-clear-btn" id="search-clear-btn"'));
    assert.ok(html.includes('role="toolbar"'));
    assert.ok(html.includes('role="tree"'));
    assert.ok(html.includes('role="status"'));
  });
});

describe('P2 #8: ARIA Tree Semantics, Roving Tabindex, LTR/RTL Keyboard Nav & Mobile Touch Class', () => {
  it('declares aria-level, aria-posinset, aria-setsize, aria-expanded (parents only), roving tabindex, and .is-mobile', () => {
    const h = createA11yWebviewHarness({ isRtl: false, isMobile: true });
    assert.equal(h.container.classList.contains('is-mobile'), true);

    const root1 = h.itemByKey('root-1');
    const child11 = h.itemByKey('child-1-1');
    const leaf111 = h.itemByKey('leaf-1-1-1');
    const root2 = h.itemByKey('root-2');

    assert.equal(root1.getAttribute('role'), 'treeitem');
    assert.equal(root1.getAttribute('aria-level'), '1');
    assert.equal(root1.getAttribute('aria-posinset'), '1');
    assert.equal(root1.getAttribute('aria-setsize'), '2');
    assert.equal(root1.getAttribute('aria-expanded'), 'true');

    assert.equal(child11.getAttribute('aria-level'), '2');
    assert.equal(child11.getAttribute('aria-expanded'), 'true');

    // End/leaf nodes MUST NOT carry aria-expanded per W3C WAI-ARIA APG
    assert.equal(leaf111.getAttribute('aria-level'), '3');
    assert.equal(leaf111.getAttribute('aria-expanded'), null);

    // Roving tabindex: exactly ONE item has tabindex="0"
    const allItems = h.outlineTree.querySelectorAll('.tree-item');
    const tabbable = allItems.filter((el) => el.getAttribute('tabindex') === '0');
    assert.equal(tabbable.length, 1);
    assert.equal(tabbable[0], root1);
    assert.equal(root2.getAttribute('tabindex'), '-1');
  });

  it('supports full LTR W3C APG keyboard navigation (ArrowDown/Up, ArrowRight/Left, Home/End, Enter/Space, *)', () => {
    const h = createA11yWebviewHarness({ isRtl: false, isMobile: false });
    assert.equal(h.container.classList.contains('is-mobile'), false);

    const root1 = h.itemByKey('root-1');
    root1.focus();

    // ArrowDown walks visible nodes in visual order
    h.pressKey('ArrowDown');
    assert.equal(h.focused.getAttribute('data-node-key'), 'child-1-1');
    assert.equal(h.focused.getAttribute('tabindex'), '0');
    assert.equal(root1.getAttribute('tabindex'), '-1');

    // ArrowLeft on expanded parent collapses it and keeps focus on it
    h.pressKey('ArrowLeft');
    assert.equal(h.itemByKey('child-1-1').classList.contains('is-collapsed'), true);
    assert.equal(h.itemByKey('child-1-1').getAttribute('aria-expanded'), 'false');
    assert.equal(h.focused.getAttribute('data-node-key'), 'child-1-1');

    // ArrowDown now skips collapsed leaf-1-1-1 and lands directly on child-1-2!
    h.pressKey('ArrowDown');
    assert.equal(h.focused.getAttribute('data-node-key'), 'child-1-2');

    // ArrowUp returns to child-1-1
    h.pressKey('ArrowUp');
    assert.equal(h.focused.getAttribute('data-node-key'), 'child-1-1');

    // ArrowRight on collapsed parent expands it (focus stays on parent)
    h.pressKey('ArrowRight');
    assert.equal(h.itemByKey('child-1-1').classList.contains('is-collapsed'), false);
    assert.equal(h.itemByKey('child-1-1').getAttribute('aria-expanded'), 'true');
    assert.equal(h.focused.getAttribute('data-node-key'), 'child-1-1');

    // Second ArrowRight on expanded parent moves focus to first child
    h.pressKey('ArrowRight');
    assert.equal(h.focused.getAttribute('data-node-key'), 'leaf-1-1-1');

    // ArrowLeft on leaf moves focus to its parent
    h.pressKey('ArrowLeft');
    assert.equal(h.focused.getAttribute('data-node-key'), 'child-1-1');

    // End moves focus to last visible treeitem; Home moves to first
    h.pressKey('End');
    assert.equal(h.focused.getAttribute('data-node-key'), 'child-2-1');
    h.pressKey('Home');
    assert.equal(h.focused.getAttribute('data-node-key'), 'root-1');

    // Enter activates focused heading -> aria-current="location" + jumpToHeading
    h.pressKey('Enter');
    assert.equal(root1.getAttribute('aria-current'), 'location');
    const jump1 = h.posted[h.posted.length - 1];
    assert.equal(jump1.type, 'jumpToHeading');
    assert.equal(jump1.slug, 'chapter-1');
    assert.equal(jump1.line, 0);

    // Space also activates focused heading after moving down
    h.pressKey('ArrowDown');
    h.pressKey(' ');
    assert.equal(root1.getAttribute('aria-current'), null);
    assert.equal(h.itemByKey('child-1-1').getAttribute('aria-current'), 'location');
    const jump2 = h.posted[h.posted.length - 1];
    assert.equal(jump2.type, 'jumpToHeading');
    assert.equal(jump2.slug, 'section-1-1');
    assert.equal(jump2.line, 3);

    // Collapse both roots, then press '*' on root-1 to expand all collapsed root siblings
    h.pressKey('Home');
    h.pressKey('ArrowLeft'); // collapses root-1
    h.pressKey('ArrowDown'); // moves to root-2
    h.pressKey('ArrowLeft'); // collapses root-2
    assert.equal(h.itemByKey('root-1').getAttribute('aria-expanded'), 'false');
    assert.equal(h.itemByKey('root-2').getAttribute('aria-expanded'), 'false');

    h.pressKey('*');
    assert.equal(h.itemByKey('root-1').getAttribute('aria-expanded'), 'true');
    assert.equal(h.itemByKey('root-2').getAttribute('aria-expanded'), 'true');
  });

  it('mirrors ArrowRight (collapse) and ArrowLeft (expand) accurately in RTL direction', () => {
    const h = createA11yWebviewHarness({ isRtl: true, isMobile: false });
    assert.equal(h.container.getAttribute('dir'), 'rtl');

    const root1 = h.itemByKey('root-1');
    root1.focus();

    // In RTL, ArrowRight collapses an expanded parent
    h.pressKey('ArrowRight');
    assert.equal(root1.classList.contains('is-collapsed'), true);
    assert.equal(root1.getAttribute('aria-expanded'), 'false');
    assert.equal(h.focused.getAttribute('data-node-key'), 'root-1');

    // In RTL, ArrowLeft expands a collapsed parent (focus stays)
    h.pressKey('ArrowLeft');
    assert.equal(root1.classList.contains('is-collapsed'), false);
    assert.equal(root1.getAttribute('aria-expanded'), 'true');
    assert.equal(h.focused.getAttribute('data-node-key'), 'root-1');

    // Second ArrowLeft on expanded parent moves to first child
    h.pressKey('ArrowLeft');
    assert.equal(h.focused.getAttribute('data-node-key'), 'child-1-1');

    // ArrowRight collapses child-1-1, then another ArrowRight returns to parent root-1
    h.pressKey('ArrowRight');
    assert.equal(h.itemByKey('child-1-1').getAttribute('aria-expanded'), 'false');
    h.pressKey('ArrowRight');
    assert.equal(h.focused.getAttribute('data-node-key'), 'root-1');
  });
});
