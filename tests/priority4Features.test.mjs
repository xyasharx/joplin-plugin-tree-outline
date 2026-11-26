import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { VALID_JOPLIN_CATEGORIES } from '../scripts/check-version-parity.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distIndexPath = path.join(repoRoot, 'dist', 'index.js');
const distWebviewPath = path.join(repoRoot, 'dist', 'webview', 'outline.js');
const distCm6Path = path.join(repoRoot, 'dist', 'contentScripts', 'codeMirrorScroller.js');
const distViewerPluginPath = path.join(repoRoot, 'dist', 'contentScripts', 'viewerScrollSpyPlugin.js');
const distViewerRuntimePath = path.join(repoRoot, 'dist', 'contentScripts', 'viewerScrollSpyRuntime.js');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFullPriority4Host({
  persistedSettings = {},
  selectedNote = {
    id: 'note-p4',
    title: 'Priority 4 Spec',
    body: [
      '# Introduction',
      'Intro paragraph.',
      '## Architecture [Core]',
      'Arch paragraph.',
      '### Scroll Spy',
      'Spy paragraph.',
      '#### Deep Detail',
      'Deep paragraph.',
      '# Deployment',
      'Deploy paragraph.',
    ].join('\n'),
    markup_language: 1,
  },
  selectedNoteIds = null,
  insertTextFails = false,
  replaceSelectionFails = false,
} = {}) {
  let currentNote = selectedNote;
  let currentIds = selectedNoteIds;

  const registeredSettings = new Map();
  const settingValues = new Map(Object.entries(persistedSettings));
  const settingsChangeListeners = [];
  const contentScriptHandlers = new Map();
  const registeredCommands = new Map();
  const executedCommands = [];
  const clipboardWrites = [];
  const postedMessages = [];
  let panelMessageHandler = null;
  let selectionHandler = null;
  let registeredPlugin = null;

  const joplin = {
    plugins: {
      register(plugin) {
        registeredPlugin = plugin;
      },
    },
    versionInfo: async () => ({ platform: 'desktop', version: '3.4.0' }),
    clipboard: {
      async writeText(text) {
        clipboardWrites.push(text);
      },
    },
    contentScripts: {
      async register() {},
      async onMessage(id, cb) {
        contentScriptHandlers.set(id, cb);
      },
    },
    settings: {
      async registerSection() {},
      async registerSettings(defs) {
        for (const [key, def] of Object.entries(defs)) {
          registeredSettings.set(key, def);
          if (!settingValues.has(key)) settingValues.set(key, def.value);
        }
      },
      async values(keys) {
        const out = {};
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          out[key] = settingValues.get(key);
        }
        return out;
      },
      async value(key) {
        return settingValues.get(key);
      },
      async setValue(key, val) {
        settingValues.set(key, val);
      },
      async globalValues(keys) {
        return keys.map((k) => (k === 'editor.codeView' ? true : ['editor', 'viewer']));
      },
      async globalValue(key) {
        return key === 'editor.codeView' ? true : ['editor', 'viewer'];
      },
      async onChange(cb) {
        settingsChangeListeners.push(cb);
      },
    },
    commands: {
      async register(cmd) {
        registeredCommands.set(cmd.name, cmd);
      },
      async execute(name, ...args) {
        executedCommands.push({ name, args });
        if (name === 'insertText' && insertTextFails) {
          throw new Error('Editor not focused');
        }
        if (name === 'replaceSelection' && replaceSelectionFails) {
          throw new Error('Viewer-only mode');
        }
        if (registeredCommands.has(name)) {
          return registeredCommands.get(name).execute(...args);
        }
        return true;
      },
    },
    views: {
      panels: {
        create: async (id) => `panel:${id}`,
        setHtml: async () => {},
        addScript: async () => {},
        show: async () => {},
        hide: async () => {},
        visible: async () => true,
        onMessage: async (_h, cb) => {
          panelMessageHandler = cb;
        },
        postMessage: (_h, msg) => {
          postedMessages.push(JSON.parse(JSON.stringify(msg)));
        },
      },
      menuItems: { create: async () => {} },
      toolbarButtons: { create: async () => {} },
    },
    workspace: {
      selectedNote: async () => currentNote,
      selectedNoteIds: async () => {
        if (currentIds !== null) return currentIds;
        return currentNote ? [currentNote.id] : [];
      },
      onNoteSelectionChange: async (cb) => {
        selectionHandler = cb;
      },
      onNoteChange: async () => {},
      onSyncComplete: async () => {},
    },
    data: { get: async () => null },
  };

  const code = fs.readFileSync(distIndexPath, 'utf8');
  const sandbox = { joplin, console, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  vm.runInContext(code, vm.createContext(sandbox), { filename: 'dist/index.js' });

  return {
    registeredSettings,
    settingValues,
    registeredCommands,
    executedCommands,
    clipboardWrites,
    postedMessages,
    async start() {
      await registeredPlugin.onStart();
    },
    async sendFromWebview(msg) {
      return panelMessageHandler(msg);
    },
    async sendFromContentScript(id, msg) {
      const fn = contentScriptHandlers.get(id);
      assert.ok(fn, `Expected onMessage listener for content script "${id}"`);
      return fn(msg);
    },
    async changeSettings(updates) {
      for (const [k, v] of Object.entries(updates)) {
        settingValues.set(k, v);
      }
      for (const cb of settingsChangeListeners) {
        await cb({ keys: Object.keys(updates) });
      }
    },
    async selectNotes(ids, note = null) {
      currentIds = ids;
      currentNote = note;
      await selectionHandler?.();
      await sleep(20);
    },
  };
}

function createPriority4WebviewHarness() {
  const byId = new Map();
  let focusedEl = null;
  const scrollCalls = [];

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
    _sync(str) {
      this._set.clear();
      for (const part of String(str).split(/\s+/)) if (part) this._set.add(part);
    }
    toString() {
      return Array.from(this._set).join(' ');
    }
  }

  class MiniNode {
    constructor(nodeType, tagName = '') {
      this.nodeType = nodeType;
      this.tagName = tagName.toUpperCase();
      this.parentNode = null;
      this.childNodes = [];
      this._text = '';
    }
    get textContent() {
      if (this.nodeType === 3) return this._text;
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(v) {
      if (this.nodeType === 3) {
        this._text = String(v ?? '');
      } else {
        this.childNodes = [];
        const s = String(v ?? '');
        if (s) {
          const t = new MiniNode(3);
          t._text = s;
          t.parentNode = this;
          this.childNodes.push(t);
        }
      }
    }
    appendChild(child) {
      if (child.nodeType === 11) {
        for (const c of [...child.childNodes]) this.appendChild(c);
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

  class MiniElement extends MiniNode {
    constructor(tagName, id = '') {
      super(1, tagName);
      this.attrs = new Map();
      this.classList = new ClassList();
      this.listeners = new Map();
      this.customProps = new Map();
      this.style = {
        setProperty: (k, v) => this.customProps.set(k, String(v)),
        removeProperty: (k) => this.customProps.delete(k),
      };
      this.value = '';
      this.scrollTop = 0;
      this.hidden = false;
      if (id) this.id = id;
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
      this.classList._sync(v);
    }
    get children() {
      return this.childNodes.filter((n) => n.nodeType === 1);
    }
    get parentElement() {
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
    }
    set innerHTML(v) {
      this._innerHTML = String(v);
      this.childNodes = [];
    }
    get innerHTML() {
      return this._innerHTML || '';
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
      if (k === 'hidden') this.hidden = true;
      this.attrs.set(k, String(v));
    }
    getAttribute(k) {
      if (k === 'class') return this.className;
      return this.attrs.has(k) ? this.attrs.get(k) : null;
    }
    removeAttribute(k) {
      if (k === 'hidden') this.hidden = false;
      this.attrs.delete(k);
    }
    matches(sel) {
      if (sel.startsWith('#')) return this.id === sel.slice(1);
      if (sel.startsWith('.')) return sel.slice(1).split('.').every((c) => this.classList.contains(c));
      return this.tagName.toLowerCase() === sel.toLowerCase();
    }
    closest(sel) {
      let cur = this;
      while (cur) {
        if (cur.nodeType === 1 && cur.matches(sel)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }
    querySelectorAll(sel) {
      const res = [];
      const walk = (el) => {
        for (const ch of el.children) {
          if (ch.matches(sel)) res.push(ch);
          walk(ch);
        }
      };
      walk(this);
      return res;
    }
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] ?? null;
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
        for (const fn of cur.listeners?.get(ev.type) ?? []) fn(ev);
        cur = cur.parentNode;
      }
      return ev;
    }
    focus() {
      focusedEl = this;
    }
    scrollIntoView(opts) {
      scrollCalls.push({ key: this.getAttribute('data-node-key'), opts });
    }
  }

  const body = new MiniElement('body');
  const container = new MiniElement('div', 'outline-container');
  const searchToggleBtn = new MiniElement('button', 'search-toggle-btn');
  const wrapToggleBtn = new MiniElement('button', 'wrap-toggle-btn');
  const collapseAllBtn = new MiniElement('button', 'collapse-all-btn');
  const insertTocBtn = new MiniElement('button', 'insert-toc-btn');
  const searchContainer = new MiniElement('div', 'search-container');
  const searchInput = new MiniElement('input', 'search-input');
  const searchClearBtn = new MiniElement('button', 'search-clear-btn');
  const outlineTree = new MiniElement('div', 'outline-tree');
  const contextMenu = new MiniElement('div', 'outline-context-menu');
  contextMenu.setAttribute('hidden', '');

  const copyMdItem = new MiniElement('button');
  copyMdItem.className = 'context-menu-item';
  copyMdItem.setAttribute('data-action', 'copy-markdown');
  const copySlugItem = new MiniElement('button');
  copySlugItem.className = 'context-menu-item';
  copySlugItem.setAttribute('data-action', 'copy-slug');
  const insertTocItem = new MiniElement('button');
  insertTocItem.className = 'context-menu-item';
  insertTocItem.setAttribute('data-action', 'insert-toc');
  contextMenu.appendChild(copyMdItem);
  contextMenu.appendChild(copySlugItem);
  contextMenu.appendChild(insertTocItem);

  const toast = new MiniElement('div', 'outline-toast');
  toast.setAttribute('hidden', '');

  container.appendChild(outlineTree);
  container.appendChild(contextMenu);
  container.appendChild(toast);
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

  const docListeners = new Map();
  const doc = {
    readyState: 'complete',
    visibilityState: 'visible',
    body,
    get activeElement() {
      return focusedEl;
    },
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => new MiniElement(tag),
    createTextNode: (t) => {
      const n = new MiniNode(3);
      n._text = String(t);
      return n;
    },
    createDocumentFragment: () => new MiniNode(11),
    querySelectorAll: (sel) => body.querySelectorAll(sel),
    addEventListener(type, fn) {
      const list = docListeners.get(type) ?? [];
      list.push(fn);
      docListeners.set(type, list);
    },
  };

  const win = {
    innerWidth: 360,
    innerHeight: 600,
    localStorage: { getItem: () => null, setItem: () => {} },
    webviewApi,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
  };

  const code = fs.readFileSync(distWebviewPath, 'utf8');
  vm.runInContext(code, vm.createContext({ window: win, document: doc, webviewApi, console, setTimeout, clearTimeout }));

  return {
    container,
    outlineTree,
    insertTocBtn,
    contextMenu,
    copyMdItem,
    copySlugItem,
    insertTocItem,
    toast,
    posted,
    scrollCalls,
    sendFromHost(payload) {
      onMessageHandler({ message: payload });
    },
    itemByKey(key) {
      return outlineTree.querySelectorAll('.tree-item').find((el) => el.getAttribute('data-node-key') === key);
    },
  };
}

describe('P4 #1: Active Heading Scroll-Spy (CM6 ViewPlugin + Markdown Viewer Runtime + Coordinator)', () => {
  it('registers CM6 ViewPlugin & scroll handler in codeMirrorScroller.js and throttles cursor/scroll updates', async () => {
    const code = fs.readFileSync(distCm6Path, 'utf8');
    const exportsObj = {};
    const moduleObj = { exports: exportsObj };
    const postedToHost = [];
    const addedExtensions = [];
    let viewPluginInstance = null;
    let scrollDomHandler = null;

    const mockViewMod = {
      EditorView: {
        scrollIntoView: (pos, opts) => ({ pos, opts }),
        domEventHandlers: (handlers) => {
          scrollDomHandler = handlers.scroll;
          return { kind: 'domEventHandlers' };
        },
      },
      ViewPlugin: {
        fromClass: (Cls) => {
          return { kind: 'viewPlugin', Cls };
        },
      },
    };
    const mockStateMod = {
      EditorSelection: { cursor: (pos) => ({ anchor: pos }) },
    };

    const cmRequire = (id) => {
      if (id === '@codemirror/view') return mockViewMod;
      if (id === '@codemirror/state') return mockStateMod;
      throw new Error(`Unexpected require: ${id}`);
    };

    vm.runInContext(
      code,
      vm.createContext({
        exports: exportsObj,
        module: moduleObj,
        require: cmRequire,
        setTimeout,
        clearTimeout,
      }),
    );

    const mod = moduleObj.exports.default({
      pluginId: 'tree',
      contentScriptId: 'treeOutlineCodeMirrorScroller',
      postMessage: async (msg) => {
        postedToHost.push(msg);
      },
    });

    const mockDoc = {
      length: 200,
      lines: 20,
      line: (n) => ({ number: n, from: (n - 1) * 10 }),
      lineAt: (pos) => ({ number: Math.floor(pos / 10) + 1 }),
    };
    const mockView = {
      state: { doc: mockDoc, selection: { main: { head: 22 } } }, // 0-based line 2
      scrollDOM: { scrollTop: 90 },
      lineBlockAtHeight: (h) => ({ from: Math.min(190, Math.floor(h)) }),
      dispatch() {},
    };

    mod.plugin({
      cm6: {},
      editor: mockView,
      registerCommand() {},
      addExtension(exts) {
        addedExtensions.push(...(Array.isArray(exts) ? exts : [exts]));
      },
    });

    const vpExt = addedExtensions.find((e) => e.kind === 'viewPlugin');
    assert.ok(vpExt, 'CM6 script must register ViewPlugin for scroll-spy');
    assert.equal(typeof scrollDomHandler, 'function', 'CM6 script must register scroll DOM handler');

    // Initial cursor report (line 2)
    viewPluginInstance = new vpExt.Cls(mockView);
    await sleep(180);
    assert.equal(postedToHost.length, 1);
    assert.equal(postedToHost[0].type, 'editorActiveLine');
    assert.equal(postedToHost[0].line, 2);

    // Move cursor to line 6 -> selectionSet update emits line 6
    mockView.state.selection.main.head = 65;
    viewPluginInstance.update({ selectionSet: true, viewportChanged: false, view: mockView });
    await sleep(180);
    assert.equal(postedToHost[postedToHost.length - 1].line, 6);
    assert.equal(postedToHost[postedToHost.length - 1].source, 'selection');

    // Pure scroll event (scrollTop = 100 -> lineBlockAtHeight(124) -> line 12)
    mockView.scrollDOM.scrollTop = 100;
    scrollDomHandler({}, mockView);
    await sleep(180);
    assert.equal(postedToHost[postedToHost.length - 1].line, 12);
    assert.equal(postedToHost[postedToHost.length - 1].source, 'scroll');

    // Note switch in reused CM6 EditorView (docChanged) at same cursor line (line 6 -> line 6)
    mockView.state.selection.main.head = 125; // line 12 (same as lastSentLine === 12!)
    const countBeforeSwitch = postedToHost.length;
    viewPluginInstance.update({ docChanged: true, selectionSet: false, viewportChanged: false, view: mockView });
    await sleep(180);
    assert.equal(
      postedToHost.length,
      countBeforeSwitch + 1,
      'docChanged must reset lastSentLine so note switch at identical line number still reports active line',
    );
    assert.equal(postedToHost[postedToHost.length - 1].line, 12);

    viewPluginInstance.destroy();
  });

  it('loads viewerScrollSpyPlugin + viewerScrollSpyRuntime safely and skips TinyMCE when webviewApi is absent', async () => {
    // 1. Verify MarkdownItPlugin declares viewerScrollSpyRuntime.js asset
    const pluginCode = fs.readFileSync(distViewerPluginPath, 'utf8');
    const exportsObj = {};
    const moduleObj = { exports: exportsObj };
    vm.runInContext(pluginCode, vm.createContext({ exports: exportsObj, module: moduleObj }));
    const loaded = moduleObj.exports.default({ contentScriptId: 'treeOutlineViewerScrollSpy' });
    assert.deepEqual(JSON.parse(JSON.stringify(loaded.assets())), [
      { name: 'viewerScrollSpyRuntime.js' },
    ]);

    // 2. Verify runtime safely no-ops when webviewApi is absent (TinyMCE Rich Text Editor)
    const runtimeCode = fs.readFileSync(distViewerRuntimePath, 'utf8');
    vm.runInContext(
      runtimeCode,
      vm.createContext({
        window: { addEventListener() {} },
        document: { readyState: 'complete', body: { id: 'tinymce' }, addEventListener() {} },
        setTimeout,
        clearTimeout,
      }),
    );

    // 3. Verify runtime tracks rendered headings in Markdown viewer and posts active heading slug
    const viewerPosted = [];
    const winListeners = new Map();
    const headings = [
      { id: 'intro', getAttribute: () => 'intro', getBoundingClientRect: () => ({ top: -120 }) },
      { id: 'arch', getAttribute: () => 'arch', getBoundingClientRect: () => ({ top: 40 }) },
      { id: 'deploy', getAttribute: () => 'deploy', getBoundingClientRect: () => ({ top: 420 }) },
    ];
    const sandbox = {
      webviewApi: {
        postMessage: (id, msg) => viewerPosted.push({ id, msg }),
      },
      window: {
        addEventListener(t, fn) {
          winListeners.set(t, fn);
        },
      },
      document: {
        readyState: 'complete',
        body: { id: 'viewer' },
        getElementById: () => ({ querySelectorAll: () => headings }),
        addEventListener() {},
      },
      setTimeout,
      clearTimeout,
    };
    sandbox.globalThis = sandbox;
    vm.runInContext(runtimeCode, vm.createContext(sandbox));
    await sleep(180);

    assert.equal(viewerPosted.length, 1);
    assert.equal(viewerPosted[0].id, 'treeOutlineViewerScrollSpy');
    assert.equal(viewerPosted[0].msg.type, 'viewerActiveHeading');
    assert.equal(viewerPosted[0].msg.slug, 'arch');
    assert.equal(viewerPosted[0].msg.index, 1);
  });

  it('coordinates scroll-spy in plugin host, respects followActiveHeading, and highlights/scrolls in webview', async () => {
    const host = createFullPriority4Host();
    await host.start();
    await host.sendFromWebview({ type: 'ready' });
    host.postedMessages.length = 0;

    // Editor moves to line 5 (inside "### Scroll Spy" at line 4)
    await host.sendFromContentScript('treeOutlineCodeMirrorScroller', {
      type: 'editorActiveLine',
      line: 5,
      source: 'selection',
    });
    const activeMsg = host.postedMessages.find((m) => m.type === 'activeHeadingUpdate');
    assert.ok(activeMsg, 'Host must push activeHeadingUpdate');
    assert.equal(activeMsg.noteId, 'note-p4');
    assert.equal(activeMsg.headingKey, 'scroll-spy');

    // Viewer scroll event for deeper heading when maxHeadingDepth = 2 maps cleanly to parent "architecture-core"
    await host.changeSettings({ maxHeadingDepth: 2 });
    host.postedMessages.length = 0;
    await host.sendFromContentScript('treeOutlineViewerScrollSpy', {
      type: 'viewerActiveHeading',
      slug: 'deep-detail',
      index: 3,
    });
    const clampedMsg = host.postedMessages.find((m) => m.type === 'activeHeadingUpdate');
    assert.equal(clampedMsg?.headingKey, 'architecture-core');

    // Disabling followActiveHeading silences scroll-spy updates completely
    await host.changeSettings({ followActiveHeading: false });
    host.postedMessages.length = 0;
    await host.sendFromContentScript('treeOutlineCodeMirrorScroller', {
      type: 'editorActiveLine',
      line: 9,
      source: 'scroll',
    });
    assert.equal(host.postedMessages.length, 0);

    // Clicking a heading suppresses immediate scroll-spy bounce back AND updates tracked key
    // so scrolling back to the previously tracked heading after suppression expires is NOT dropped!
    await host.changeSettings({ followActiveHeading: true, maxHeadingDepth: 6 });
    host.postedMessages.length = 0;
    await host.sendFromContentScript('treeOutlineCodeMirrorScroller', {
      type: 'editorActiveLine',
      line: 0,
      source: 'selection',
    });
    assert.equal(
      host.postedMessages[host.postedMessages.length - 1]?.headingKey,
      'introduction',
    );

    host.postedMessages.length = 0;
    await host.sendFromWebview({
      type: 'jumpToHeading',
      key: 'deployment',
      line: 8,
      slug: 'deployment',
      text: 'Deployment',
      level: 1,
    });
    await host.sendFromContentScript('treeOutlineCodeMirrorScroller', {
      type: 'editorActiveLine',
      line: 0,
      source: 'scroll',
    });
    assert.equal(
      host.postedMessages.filter((m) => m.type === 'activeHeadingUpdate').length,
      0,
      'Immediate scroll events after jump click must be suppressed to avoid flicker',
    );

    await sleep(640);
    await host.sendFromContentScript('treeOutlineCodeMirrorScroller', {
      type: 'editorActiveLine',
      line: 0,
      source: 'scroll',
    });
    assert.equal(
      host.postedMessages.find((m) => m.type === 'activeHeadingUpdate')?.headingKey,
      'introduction',
      'Scrolling back to previous heading after manual jump suppression must re-highlight it',
    );
  });
});

describe('P4 #2, #3, #4: Native Settings Panel, Heading Link/TOC Actions & Distinguished Empty States', () => {
  it('registers all Priority 4 native settings with constraints and sanitizes customFontFamily & fontSize', async () => {
    const host = createFullPriority4Host({
      persistedSettings: {
        maxHeadingDepth: 3,
        defaultCollapseLevel: 3,
        showHeadingNumbers: true,
        showLevelBadges: true,
        followActiveHeading: true,
        customFontFamily: '"IBM Plex Sans"; } body { display: none',
        fontSize: 5, // below minimum 10 -> clamps safely to 10
      },
    });
    await host.start();

    for (const key of [
      'maxHeadingDepth',
      'defaultCollapseLevel',
      'followActiveHeading',
      'showHeadingNumbers',
      'showLevelBadges',
      'textWrapMode',
      'fontPreset',
      'customFontFamily',
      'fontSize',
      'autoDismissOnMobile',
    ]) {
      const def = host.registeredSettings.get(key);
      assert.ok(def, `Setting "${key}" must be registered`);
      assert.equal(def.section, 'treeOutline');
      assert.equal(def.storage, 2); // SettingStorage.File
    }

    assert.equal(host.registeredSettings.get('maxHeadingDepth').minimum, 1);
    assert.equal(host.registeredSettings.get('maxHeadingDepth').maximum, 6);

    host.postedMessages.length = 0;
    await host.sendFromWebview({ type: 'ready' });
    const prefMsg = host.postedMessages.find((m) => m.type === 'preferencesUpdate');
    assert.equal(prefMsg.preferences.maxHeadingDepth, 3);
    assert.equal(prefMsg.preferences.defaultCollapseLevel, 3);
    assert.equal(prefMsg.preferences.showHeadingNumbers, true);
    assert.equal(prefMsg.preferences.showLevelBadges, true);
    assert.equal(prefMsg.preferences.fontSize, 10, 'Non-zero fontSize < 10 must clamp safely to 10px');
    assert.ok(
      !prefMsg.preferences.customFontFamily.includes(';') &&
        !prefMsg.preferences.customFontFamily.includes('{'),
      'customFontFamily must strip CSS injection characters',
    );
  });

  it('copies Joplin Markdown links, plain #slug anchors, and inserts Markdown TOC (with clipboard fallback)', async () => {
    const host = createFullPriority4Host({
      persistedSettings: { maxHeadingDepth: 3, showHeadingNumbers: true },
    });
    await host.start();
    await host.sendFromWebview({ type: 'ready' });
    host.postedMessages.length = 0;

    // 1. Copy Joplin Markdown link (escapes brackets in title!)
    await host.sendFromWebview({
      type: 'copyHeadingLink',
      format: 'markdown',
      slug: 'architecture-core',
      text: 'Architecture [Core]',
    });
    assert.equal(host.clipboardWrites[0], '[Architecture \\[Core\\]](:/note-p4#architecture-core)');
    assert.equal(host.postedMessages[0].type, 'toast');

    // 2. Copy plain #slug anchor
    await host.sendFromWebview({
      type: 'copyHeadingLink',
      format: 'slug',
      slug: 'scroll-spy',
      text: 'Scroll Spy',
    });
    assert.equal(host.clipboardWrites[1], '#scroll-spy');

    // 3. Insert Markdown TOC via webview action (respects maxHeadingDepth=3 & showHeadingNumbers=true)
    await host.sendFromWebview({ type: 'insertToc' });
    const insertCmd = host.executedCommands.find((c) => c.name === 'insertText');
    assert.ok(insertCmd, 'insertToc should invoke insertText command');
    const insertedToc = insertCmd.args[0];
    assert.ok(insertedToc.includes('- 1. [Introduction](#introduction)'));
    assert.ok(insertedToc.includes('  - 1.1 [Architecture \\[Core\\]](#architecture-core)'));
    assert.ok(insertedToc.includes('    - 1.1.1 [Scroll Spy](#scroll-spy)'));
    assert.ok(!insertedToc.includes('Deep Detail'), 'H4 must be omitted when maxHeadingDepth=3');

    // 4. Native Joplin Command Palette command works even BEFORE webview ready (e.g. hidden panel!)
    assert.ok(host.registeredCommands.has('treeOutline.insertToc'));
    const hiddenPanelHost = createFullPriority4Host({
      persistedSettings: { panelVisible: false },
    });
    await hiddenPanelHost.start();
    // Note: never sent webview { type: 'ready' }!
    await hiddenPanelHost.registeredCommands.get('treeOutline.insertToc').execute();
    const hiddenInsert = hiddenPanelHost.executedCommands.find((c) => c.name === 'insertText');
    assert.ok(
      hiddenInsert && hiddenInsert.args[0].includes('- [Introduction](#introduction)'),
      'Command Palette Insert TOC must sync active note and work even when panel is hidden',
    );

    // 4b. Escapes spaces & parentheses in explicit HTML heading slugs while preserving Unicode slugs
    await host.sendFromWebview({
      type: 'copyHeadingLink',
      format: 'markdown',
      slug: 'sec (1) مقدمه',
      text: 'Section (1)',
    });
    assert.equal(
      host.clipboardWrites[host.clipboardWrites.length - 1],
      '[Section (1)](:/note-p4#sec%20%281%29%20مقدمه)',
    );

    // 5. Viewer-only fallback copies TOC to clipboard when editor commands throw
    const viewerOnlyHost = createFullPriority4Host({
      insertTextFails: true,
      replaceSelectionFails: true,
    });
    await viewerOnlyHost.start();
    await viewerOnlyHost.sendFromWebview({ type: 'ready' });
    viewerOnlyHost.postedMessages.length = 0;
    await viewerOnlyHost.sendFromWebview({ type: 'insertToc' });
    assert.equal(viewerOnlyHost.clipboardWrites.length, 1);
    assert.ok(viewerOnlyHost.clipboardWrites[0].includes('- [Introduction](#introduction)'));
    assert.ok(viewerOnlyHost.postedMessages[0].message.includes('Copied Markdown TOC to clipboard'));
  });

  it('renders numbering, level badges, auto-collapse, custom font/size, context menu, scroll-spy & multi-note empty states in webview', () => {
    const wv = createPriority4WebviewHarness();

    // Apply rich preferences (maxDepth=3, auto-collapse H2+, numbering, badges, custom font & 15px size)
    wv.sendFromHost({
      type: 'preferencesUpdate',
      preferences: {
        textWrapMode: 'nowrap',
        fontPreset: 'auto',
        customFontFamily: '"IBM Plex Sans", sans-serif',
        fontSize: 15,
        maxHeadingDepth: 3,
        defaultCollapseLevel: 2,
        showHeadingNumbers: true,
        showLevelBadges: true,
        followActiveHeading: true,
      },
    });

    assert.equal(wv.container.classList.contains('has-custom-font'), true);
    assert.equal(wv.container.customProps.get('--nav-custom-font'), '"IBM Plex Sans", sans-serif');
    assert.equal(wv.container.customProps.get('--nav-font-size'), '15px');

    // Push nested heading tree (H1 -> H2 -> H3 -> H4)
    wv.sendFromHost({
      type: 'outlineUpdate',
      version: 1,
      noteId: 'n1',
      noteChanged: true,
      selectionKind: 'single',
      selectedCount: 1,
      markupLanguage: 1,
      isRtl: false,
      isMobile: false,
      headings: [
        {
          id: 'h-0',
          key: 'intro',
          level: 1,
          text: 'Introduction',
          rawText: 'Introduction',
          line: 0,
          slug: 'intro',
          script: 'latin',
          children: [
            {
              id: 'h-2',
              key: 'arch',
              level: 2,
              text: 'Architecture',
              rawText: 'Architecture',
              line: 2,
              slug: 'arch',
              script: 'latin',
              children: [
                {
                  id: 'h-4',
                  key: 'spy',
                  level: 3,
                  text: 'Scroll Spy',
                  rawText: 'Scroll Spy',
                  line: 4,
                  slug: 'spy',
                  script: 'latin',
                  children: [
                    {
                      id: 'h-6',
                      key: 'deep',
                      level: 4,
                      text: 'Deep Detail',
                      rawText: 'Deep Detail',
                      line: 6,
                      slug: 'deep',
                      script: 'latin',
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    // H4 pruned by maxHeadingDepth=3
    assert.equal(wv.itemByKey('deep'), undefined);
    // H2 ("arch") auto-collapsed by defaultCollapseLevel=2, while H1 ("intro") stays expanded
    assert.equal(wv.itemByKey('intro').classList.contains('is-collapsed'), false);
    assert.equal(wv.itemByKey('arch').classList.contains('is-collapsed'), true);

    // Level badges and hierarchical numbers rendered cleanly
    const badges = wv.outlineTree.querySelectorAll('.heading-level-badge').map((b) => b.textContent);
    const numbers = wv.outlineTree.querySelectorAll('.heading-number').map((n) => n.textContent);
    assert.deepEqual(badges, ['H1', 'H2', 'H3']);
    assert.deepEqual(numbers, ['1.', '1.1', '1.1.1']);

    // Scroll-spy highlights collapsed descendant ("spy") and marks collapsed parent ("arch") with .has-active-child
    wv.sendFromHost({ type: 'activeHeadingUpdate', noteId: 'n1', headingKey: 'spy' });
    assert.equal(wv.itemByKey('spy').getAttribute('aria-current'), 'location');
    assert.equal(wv.itemByKey('arch').classList.contains('has-active-child'), true);
    assert.ok(wv.scrollCalls.length >= 1, 'Scroll-spy should scroll active item/ancestor into view');

    // Quick-copy button on heading row posts copyHeadingLink (without triggering jumpToHeading)
    wv.posted.length = 0;
    const copyBtn = wv.itemByKey('intro').querySelector('.tree-item-copy-btn');
    copyBtn.dispatchEvent({ type: 'click' });
    assert.equal(wv.posted.length, 1);
    assert.equal(wv.posted[0].type, 'copyHeadingLink');
    assert.equal(wv.posted[0].format, 'markdown');
    assert.equal(wv.posted[0].slug, 'intro');

    // Right-click context menu opens and dispatches copy-slug & insert-toc actions
    wv.posted.length = 0;
    const introRow = wv.itemByKey('intro').querySelector('.tree-item-self');
    introRow.dispatchEvent({ type: 'contextmenu', clientX: 50, clientY: 60 });
    assert.equal(wv.contextMenu.hidden, false);
    wv.copySlugItem.dispatchEvent({ type: 'click' });
    assert.equal(wv.contextMenu.hidden, true);
    assert.equal(wv.posted[0].type, 'copyHeadingLink');
    assert.equal(wv.posted[0].format, 'slug');

    // Toast notification displays feedback cleanly
    wv.sendFromHost({ type: 'toast', message: 'Copied anchor #intro', kind: 'success' });
    assert.equal(wv.toast.hidden, false);
    assert.equal(wv.toast.textContent, 'Copied anchor #intro');

    // Distinguished empty state: Multiple notes selected with exact count
    wv.sendFromHost({
      type: 'outlineUpdate',
      version: 2,
      noteId: '',
      noteChanged: true,
      selectionKind: 'multiple',
      selectedCount: 3,
      markupLanguage: 1,
      isRtl: false,
      isMobile: false,
      headings: [],
    });
    assert.ok(wv.outlineTree.textContent.includes('3 notes selected'));
    assert.ok(wv.outlineTree.textContent.includes('Select a single note'));

    // Distinguished empty state: Note headings all deeper than maxHeadingDepth
    wv.sendFromHost({
      type: 'preferencesUpdate',
      preferences: { maxHeadingDepth: 1 },
    });
    wv.sendFromHost({
      type: 'outlineUpdate',
      version: 3,
      noteId: 'n-h2-only',
      noteChanged: true,
      selectionKind: 'single',
      selectedCount: 1,
      markupLanguage: 1,
      isRtl: false,
      isMobile: false,
      headings: [
        {
          id: 'h2-0',
          key: 'only-h2',
          level: 2,
          text: 'Only H2',
          rawText: 'Only H2',
          line: 0,
          slug: 'only-h2',
          script: 'latin',
          children: [],
        },
      ],
    });
    assert.ok(wv.outlineTree.textContent.includes('No headings within depth H1–H1'));
  });
});

describe('P4 #5: Official Joplin Plugin Store Manifest Metadata & Visual Assets', () => {
  it('declares valid categories, mobile min version, absolute screenshots/promo_tile URLs, and valid PNG assets on disk', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src', 'manifest.json'), 'utf8'));
    const distManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist', 'manifest.json'), 'utf8'));
    const rawPrefix = 'https://raw.githubusercontent.com/xyasharx/joplin-plugin-tree-outline/main/';

    assert.deepEqual(distManifest, manifest);
    assert.equal(manifest.homepage_url, 'https://github.com/xyasharx/joplin-plugin-tree-outline');
    assert.equal(manifest.repository_url, 'https://github.com/your-username/joplin-plugin-tree-outline');
    assert.equal(manifest.app_min_version, '2.8.0');
    assert.equal(manifest.app_min_version_mobile, '3.0.0');

    // Categories match Joplin Plugin Store allowlist
    assert.ok(Array.isArray(manifest.categories) && manifest.categories.length >= 2);
    for (const cat of manifest.categories) {
      assert.ok(VALID_JOPLIN_CATEGORIES.has(cat), `Invalid Joplin category: ${cat}`);
    }

    // PNG icons remain valid on disk for future migration, while manifest omits relative icons
    // so PluginRemoteInfoLoader does not fetch broken 404 URLs from your-username
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(manifest.icons, undefined);
    for (const size of ['16', '32', '48', '128']) {
      const fullPath = path.join(repoRoot, 'images', `icon${size}.png`);
      assert.ok(fs.existsSync(fullPath), `Icon asset missing: images/icon${size}.png`);
      assert.ok(fs.readFileSync(fullPath).subarray(0, 8).equals(pngMagic));
    }

    // Screenshots use absolute raw GitHub URLs backed by real PNG files on disk
    assert.ok(Array.isArray(manifest.screenshots) && manifest.screenshots.length >= 2);
    for (const shot of manifest.screenshots) {
      assert.ok(shot.label && shot.label.length >= 10);
      assert.ok(shot.src.startsWith(rawPrefix), `Expected absolute raw GitHub URL, got ${shot.src}`);
      const localPath = path.join(repoRoot, shot.src.slice(rawPrefix.length));
      assert.ok(fs.existsSync(localPath), `Screenshot missing on disk: ${localPath}`);
      assert.ok(fs.readFileSync(localPath).subarray(0, 8).equals(pngMagic));
    }

    // Promo tile uses absolute raw GitHub URL & is valid 440x280 PNG on disk
    assert.ok(manifest.promo_tile?.src?.startsWith(rawPrefix) && manifest.promo_tile?.label);
    const promoPath = path.join(repoRoot, manifest.promo_tile.src.slice(rawPrefix.length));
    const promoBuf = fs.readFileSync(promoPath);
    assert.ok(promoBuf.subarray(0, 8).equals(pngMagic));
    const width = promoBuf.readUInt32BE(16);
    const height = promoBuf.readUInt32BE(20);
    assert.equal(width, 440, 'Joplin promo_tile must be exactly 440px wide');
    assert.equal(height, 280, 'Joplin promo_tile must be exactly 280px tall');
  });
});
