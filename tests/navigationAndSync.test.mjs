import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mainBundlePath = path.join(repoRoot, 'dist', 'index.js');
const contentScriptBundlePath = path.join(repoRoot, 'dist', 'contentScripts', 'codeMirrorScroller.js');
const webviewBundlePath = path.join(repoRoot, 'dist', 'webview', 'outline.js');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Full-featured Joplin host simulator for testing P0 #1 (Navigation + CM6 + RTE + Mobile)
 * and P0 #2 (Event-driven sync, empty-note guard, same-length edits, race conditions).
 */
function createIntegrationHost({
  platform = 'desktop',
  codeView = true,
  visiblePanes = ['editor', 'viewer'],
  persistedSettings = {},
  selectedNote = null,
  selectedNoteIds = null,
  cm6HandlesScroll = true,
} = {}) {
  let currentNote = selectedNote;
  let currentNoteIds = selectedNoteIds;
  let currentCodeView = codeView;
  let currentVisiblePanes = visiblePanes;
  let currentCm6HandlesScroll = cm6HandlesScroll;

  const executedCommands = [];
  const registeredCommands = new Map();
  const contentScripts = [];
  const settingValues = new Map(Object.entries(persistedSettings));
  const panels = new Map();
  const postedMessages = [];
  const messageHandlers = new Map();
  let dataGetCalls = 0;
  let selectedNoteCalls = 0;
  let intervalCalls = 0;
  let noteSelectionHandler = null;
  let noteChangeHandler = null;
  let syncCompleteHandler = null;
  let registeredPlugin = null;

  const joplin = {
    plugins: {
      async register(plugin) {
        registeredPlugin = plugin;
      },
    },
    contentScripts: {
      async register(type, id, scriptPath) {
        contentScripts.push({ type, id, scriptPath });
      },
    },
    async versionInfo() {
      return { version: '3.7.0', profileVersion: 45, syncVersion: 3, platform };
    },
    settings: {
      async registerSection() {},
      async registerSettings(settings) {
        for (const [key, spec] of Object.entries(settings)) {
          if (!settingValues.has(key)) {
            settingValues.set(key, spec.value);
          }
        }
      },
      async value(key) {
        return settingValues.get(key);
      },
      async setValue(key, val) {
        settingValues.set(key, val);
      },
      async globalValue(key) {
        if (key === 'editor.codeView') return currentCodeView;
        if (key === 'noteVisiblePanes') return currentVisiblePanes;
        return undefined;
      },
    },
    commands: {
      async register(command) {
        registeredCommands.set(command.name, command);
      },
      async execute(name, ...args) {
        executedCommands.push({ name, args });
        if (registeredCommands.has(name)) {
          return registeredCommands.get(name).execute(...args);
        }
        if (name === 'editor.execCommand') {
          const payload = args[0];
          if (payload?.name === 'treeOutline.scrollToLine') {
            return currentCm6HandlesScroll;
          }
          return true;
        }
        return undefined;
      },
    },
    views: {
      panels: {
        async create(id) {
          const handle = `panel-${id}`;
          panels.set(handle, { id, html: '', scripts: [], visible: true });
          return handle;
        },
        async setHtml(handle, html) {
          panels.get(handle).html = html;
          return html;
        },
        async addScript(handle, scriptPath) {
          panels.get(handle).scripts.push(scriptPath);
        },
        async onMessage(handle, handler) {
          messageHandlers.set(handle, handler);
        },
        async postMessage(handle, message) {
          postedMessages.push({ handle, message });
        },
        async show(handle, show = true) {
          panels.get(handle).visible = Boolean(show);
        },
        async hide(handle) {
          panels.get(handle).visible = false;
        },
        async visible(handle) {
          return panels.get(handle).visible;
        },
      },
      menuItems: {
        async create() {},
      },
      toolbarButtons: {
        async create() {},
      },
    },
    workspace: {
      async selectedNote() {
        selectedNoteCalls += 1;
        return typeof currentNote === 'function' ? currentNote() : currentNote;
      },
      async selectedNoteIds() {
        if (currentNoteIds !== null) return currentNoteIds;
        const note = typeof currentNote === 'function' ? null : currentNote;
        return note ? [note.id] : [];
      },
      async onNoteSelectionChange(cb) {
        noteSelectionHandler = cb;
      },
      async onNoteChange(cb) {
        noteChangeHandler = cb;
      },
      async onSyncComplete(cb) {
        syncCompleteHandler = cb;
      },
    },
    data: {
      async get() {
        dataGetCalls += 1;
        return typeof currentNote === 'function' ? currentNote() : currentNote;
      },
    },
  };

  async function startPlugin() {
    const code = fs.readFileSync(mainBundlePath, 'utf8');
    const sandbox = {
      joplin,
      console,
      setTimeout,
      clearTimeout,
      setInterval: (...args) => {
        intervalCalls += 1;
        return setInterval(...args);
      },
      clearInterval,
    };
    sandbox.globalThis = sandbox;
    vm.runInContext(code, vm.createContext(sandbox), { filename: 'dist/index.js' });
    await registeredPlugin.onStart();
  }

  function getPanelHandler() {
    const [handle] = Array.from(panels.keys());
    return messageHandlers.get(handle);
  }

  return {
    joplin,
    startPlugin,
    getPanelHandler,
    executedCommands,
    contentScripts,
    postedMessages,
    settingValues,
    setNote(n) {
      currentNote = n;
      currentNoteIds = n ? [n.id] : [];
    },
    setNoteIds(ids) {
      currentNoteIds = ids;
    },
    setCodeView(v) {
      currentCodeView = v;
    },
    setVisiblePanes(p) {
      currentVisiblePanes = p;
    },
    setCm6HandlesScroll(v) {
      currentCm6HandlesScroll = v;
    },
    get dataGetCalls() {
      return dataGetCalls;
    },
    get selectedNoteCalls() {
      return selectedNoteCalls;
    },
    get intervalCalls() {
      return intervalCalls;
    },
    triggerSelectionChange: () => noteSelectionHandler?.(),
    triggerNoteChange: () => noteChangeHandler?.(),
    triggerSyncComplete: () => syncCompleteHandler?.({ withErrors: false }),
  };
}

describe('P0 #1: Navigation (RTE, CM6 content script, CM5 fallback, Mobile auto-dismiss)', () => {
  it('registers CodeMirrorPlugin content script and autoDismissOnMobile setting on startup', async () => {
    const host = createIntegrationHost({ platform: 'desktop' });
    await host.startPlugin();

    assert.equal(host.contentScripts.length, 1);
    assert.deepEqual(host.contentScripts[0], {
      type: 'codeMirrorPlugin',
      id: 'treeOutlineCodeMirrorScroller',
      scriptPath: './contentScripts/codeMirrorScroller.js',
    });
    assert.equal(host.settingValues.get('autoDismissOnMobile'), true);
  });

  it('executes compiled dist/contentScripts/codeMirrorScroller.js accurately in Joplin CM6 PluginLoader sandbox', () => {
    const scriptSource = fs.readFileSync(contentScriptBundlePath, 'utf8');
    const dispatched = [];
    const registeredCmds = new Map();

    const mockEditorView = {
      scrollIntoView(pos, opts) {
        return { effect: 'scrollIntoView', pos, opts };
      },
    };
    const mockEditorSelection = {
      cursor(pos) {
        return { anchor: pos, head: pos };
      },
    };

    // Mirrors packages/editor/CodeMirror/pluginApi/PluginLoader.ts
    const exportsObj = {};
    const moduleObj = { exports: exportsObj };
    const codeMirrorRequire = (lib) => {
      if (lib === '@codemirror/view') return { EditorView: mockEditorView };
      if (lib === '@codemirror/state') return { EditorSelection: mockEditorSelection };
      throw new Error(`Unexpected require: ${lib}`);
    };

    const sandbox = {
      exports: exportsObj,
      module: moduleObj,
      require: codeMirrorRequire,
      joplin: { require: codeMirrorRequire },
    };
    vm.runInContext(scriptSource, vm.createContext(sandbox), {
      filename: 'dist/contentScripts/codeMirrorScroller.js',
    });

    assert.equal(typeof moduleObj.exports.default, 'function');
    const loaded = moduleObj.exports.default({ pluginId: 'test', contentScriptId: 'cs' });

    const mockDoc = {
      lines: 10,
      line(n) {
        assert.ok(n >= 1 && n <= 10, `Line ${n} must be clamped within 1..10`);
        return { number: n, from: (n - 1) * 20 };
      },
    };

    const editorControl = {
      cm6: {},
      editor: {
        state: { doc: mockDoc },
        dispatch(tr) {
          dispatched.push(tr);
        },
      },
      registerCommand(name, fn) {
        registeredCmds.set(name, fn);
      },
    };

    loaded.plugin(editorControl);
    assert.ok(registeredCmds.has('treeOutline.scrollToLine'));

    // 0-based line 4 -> CM6 1-based line 5 -> pos 80
    const ok = registeredCmds.get('treeOutline.scrollToLine')(4);
    assert.equal(ok, true);
    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].selection.anchor, 80);
    assert.equal(dispatched[0].effects.effect, 'scrollIntoView');
    assert.equal(dispatched[0].effects.pos, 80);
    assert.equal(dispatched[0].effects.opts.y, 'start');

    // Out-of-bounds line clamps cleanly to last line (line 10 -> pos 180)
    assert.equal(registeredCmds.get('treeOutline.scrollToLine')(999), true);
    assert.equal(dispatched[1].selection.anchor, 180);
  });

  it('loads compiled dist/contentScripts/codeMirrorScroller.js safely on legacy CM5 without requiring @codemirror/view', () => {
    const scriptSource = fs.readFileSync(contentScriptBundlePath, 'utf8');
    const exportsObj = {};
    const moduleObj = { exports: exportsObj };
    const cm5Extensions = new Map();

    const throwingRequire = (lib) => {
      throw new Error(`CM5 cannot load ${lib}`);
    };

    vm.runInContext(
      scriptSource,
      vm.createContext({
        exports: exportsObj,
        module: moduleObj,
        require: throwingRequire,
      }),
    );

    const loaded = moduleObj.exports.default({});
    loaded.plugin({
      defineExtension(name, fn) {
        cm5Extensions.set(name, fn);
      },
    });

    assert.ok(cm5Extensions.has('treeOutline.scrollToLine'));
    const cm5Calls = [];
    const fakeCm5Instance = {
      setCursor: (pos) => cm5Calls.push(['setCursor', pos]),
      scrollIntoView: (pos, margin) => cm5Calls.push(['scrollIntoView', pos, margin]),
    };
    const res = cm5Extensions.get('treeOutline.scrollToLine').call(fakeCm5Instance, 7);
    assert.equal(res, true);
    assert.equal(cm5Calls.length, 2);
    assert.equal(cm5Calls[0][1].line, 7);
    assert.equal(cm5Calls[1][2], 150);
  });

  it('navigates properly in Rich Text Editor (TinyMCE) even when noteVisiblePanes is ["editor"]', async () => {
    const host = createIntegrationHost({
      platform: 'desktop',
      codeView: false, // Rich Text Editor active!
      visiblePanes: ['editor'], // Viewer pane not in noteVisiblePanes
    });
    await host.startPlugin();

    const handler = host.getPanelHandler();
    await handler({
      type: 'jumpToHeading',
      line: 12,
      slug: 'architecture-overview',
      text: 'Architecture Overview',
      level: 2,
      markupLanguage: 1,
    });

    assert.deepEqual(
      host.executedCommands.map((c) => c.name),
      ['scrollToHash'],
      'RTE must use scrollToHash and never send CodeMirror commands to TinyMCE',
    );
    assert.equal(host.executedCommands[0].args[0], 'architecture-overview');
  });

  it('uses editor.scrollToText in RTE for HTML note headings without an explicit HTML id', async () => {
    const host = createIntegrationHost({
      platform: 'desktop',
      codeView: false,
      visiblePanes: ['editor'],
    });
    await host.startPlugin();

    const handler = host.getPanelHandler();
    await handler({
      type: 'jumpToHeading',
      line: 3,
      slug: 'clipped-section',
      text: 'Clipped Section',
      level: 2,
      hasExplicitId: false,
      markupLanguage: 2,
    });

    assert.equal(host.executedCommands.length, 1);
    assert.equal(host.executedCommands[0].name, 'editor.scrollToText');
    assert.equal(host.executedCommands[0].args[0].text, 'Clipped Section');
    assert.equal(host.executedCommands[0].args[0].element, 'h2');
  });

  it('uses native CM6 scrollToLine in Markdown editor-only mode and falls back to CM5 setCursor/scrollIntoView on older Joplin', async () => {
    const host = createIntegrationHost({
      platform: 'desktop',
      codeView: true,
      visiblePanes: ['editor'],
      cm6HandlesScroll: true,
    });
    await host.startPlugin();

    const handler = host.getPanelHandler();
    await handler({ type: 'jumpToHeading', line: 15, slug: 'notes-2', text: 'Notes', level: 2 });

    assert.equal(host.executedCommands.length, 1);
    assert.equal(host.executedCommands[0].name, 'editor.execCommand');
    assert.equal(host.executedCommands[0].args[0].name, 'treeOutline.scrollToLine');
    assert.equal(host.executedCommands[0].args[0].args[0], 15);

    // Simulate legacy Joplin CM5 where treeOutline.scrollToLine returns falsy
    host.executedCommands.length = 0;
    host.setCm6HandlesScroll(false);
    await handler({ type: 'jumpToHeading', line: 15, slug: 'notes-2', text: 'Notes', level: 2 });

    assert.deepEqual(
      host.executedCommands.map((c) => c.args[0].name),
      ['treeOutline.scrollToLine', 'setCursor', 'scrollIntoView'],
    );
  });

  it('supports Mobile Edit mode (CM6), Mobile Read mode (scrollToHash), and dismissPluginPanels', async () => {
    // 1. Mobile Read mode (CM6 editor not mounted -> returns false) + auto-dismiss default ON
    const mobileRead = createIntegrationHost({
      platform: 'mobile',
      cm6HandlesScroll: false,
    });
    await mobileRead.startPlugin();
    await mobileRead.getPanelHandler()({
      type: 'jumpToHeading',
      line: 5,
      slug: 'rocket-launch-plan',
      text: '🚀 Launch Plan',
      level: 1,
    });

    assert.deepEqual(
      mobileRead.executedCommands.map((c) => c.name),
      ['editor.execCommand', 'scrollToHash', 'dismissPluginPanels'],
    );
    assert.equal(mobileRead.executedCommands[1].args[0], 'rocket-launch-plan');

    // 2. Mobile Edit mode (CM6 mounted -> returns true) + auto-dismiss disabled by setting
    const mobileEdit = createIntegrationHost({
      platform: 'mobile',
      cm6HandlesScroll: true,
      persistedSettings: { autoDismissOnMobile: false },
    });
    await mobileEdit.startPlugin();
    await mobileEdit.getPanelHandler()({
      type: 'jumpToHeading',
      line: 5,
      slug: 'rocket-launch-plan',
      text: '🚀 Launch Plan',
      level: 1,
    });

    assert.deepEqual(
      mobileEdit.executedCommands.map((c) => c.name),
      ['editor.execCommand'],
      'Mobile Edit mode uses CM6 scrollToLine directly and respects autoDismissOnMobile=false',
    );
  });
});

describe('P0 #2: Event-driven push sync, empty-note guard, same-length edits & race safety', () => {
  it('registers zero setInterval polling timers and does not double-query DB on empty notes', async () => {
    const host = createIntegrationHost({
      platform: 'desktop',
      selectedNote: { id: 'empty-1', title: 'Blank', body: '', markup_language: 1 },
    });
    await host.startPlugin();

    const outlineMessages = host.postedMessages.filter((m) => m.message.type === 'outlineUpdate');
    assert.equal(host.intervalCalls, 0, 'Plugin host must never create setInterval pollers');
    assert.equal(host.dataGetCalls, 0, 'Empty body "" must not trigger redundant joplin.data.get()');
    assert.equal(outlineMessages.length, 1);
    assert.equal(outlineMessages[0].message.selectionKind, 'single');
    assert.equal(outlineMessages[0].message.headings.length, 0);
  });

  it('detects same-length heading edits while skipping redundant pushes for paragraph-only edits', async () => {
    const host = createIntegrationHost({
      platform: 'desktop',
      selectedNote: {
        id: 'note-1',
        title: 'Spec',
        body: '# Draft\n\nBody paragraph.\n',
        markup_language: 1,
      },
    });
    await host.startPlugin();
    const outlineMessages = () =>
      host.postedMessages.filter((m) => m.message.type === 'outlineUpdate');
    assert.equal(outlineMessages().length, 1);
    assert.equal(outlineMessages()[0].message.headings[0].text, 'Draft');

    // Edit paragraph only -> should NOT push an outlineUpdate!
    host.setNote({
      id: 'note-1',
      title: 'Spec',
      body: '# Draft\n\nCompletely rewritten body text with lots of changes!\n',
      markup_language: 1,
    });
    host.triggerNoteChange();
    await sleep(260);
    assert.equal(outlineMessages().length, 1, 'Paragraph-only edit must not rebuild outline DOM');

    // Rename heading with EXACT SAME character length (# Draft -> # Final) -> MUST push!
    host.setNote({
      id: 'note-1',
      title: 'Spec',
      body: '# Final\n\nCompletely rewritten body text with lots of changes!\n',
      markup_language: 1,
    });
    host.triggerNoteChange();
    await sleep(260);
    assert.equal(outlineMessages().length, 2, 'Same-length heading rename must push update');
    assert.equal(outlineMessages()[1].message.noteChanged, false);
    assert.equal(outlineMessages()[1].message.headings[0].text, 'Final');
  });

  it('handles onSyncComplete and distinguishes multiple selected notes', async () => {
    const host = createIntegrationHost({
      platform: 'desktop',
      selectedNote: { id: 'note-1', title: 'Sync Test', body: '# Before Sync\n', markup_language: 1 },
    });
    await host.startPlugin();

    // Multi-note selection
    host.setNoteIds(['note-1', 'note-2']);
    host.triggerSelectionChange();
    await sleep(20);
    const multiMsg = host.postedMessages[host.postedMessages.length - 1].message;
    assert.equal(multiMsg.selectionKind, 'multiple');
    assert.equal(multiMsg.headings.length, 0);

    // Sync updates single note
    host.setNote({ id: 'note-1', title: 'Sync Test', body: '# After Sync\n', markup_language: 1 });
    host.triggerSyncComplete();
    await sleep(260);
    const syncMsg = host.postedMessages[host.postedMessages.length - 1].message;
    assert.equal(syncMsg.selectionKind, 'single');
    assert.equal(syncMsg.headings[0].text, 'After Sync');
  });

  it('discards out-of-order stale async responses during rapid note switching', async () => {
    let resolveSlowNoteA;
    const slowNoteAPromise = new Promise((resolve) => {
      resolveSlowNoteA = resolve;
    });

    const host = createIntegrationHost({ platform: 'desktop', selectedNote: null });
    await host.startPlugin();
    host.postedMessages.length = 0;

    // Start slow load for Note A
    host.setNoteIds(['note-A']);
    host.setNote(() => slowNoteAPromise);
    host.setNoteIds(['note-A']);
    host.triggerSelectionChange();

    // Immediately switch to Note B which resolves right away
    host.setNote({ id: 'note-B', title: 'Note B', body: '# Heading B\n', markup_language: 1 });
    host.triggerSelectionChange();
    await sleep(20);

    assert.equal(host.postedMessages.length, 1);
    assert.equal(host.postedMessages[0].message.noteId, 'note-B');

    // Now Note A finishes late -> MUST be discarded!
    resolveSlowNoteA({ id: 'note-A', title: 'Note A', body: '# Heading A\n', markup_language: 1 });
    await sleep(20);

    assert.equal(host.postedMessages.length, 1, 'Stale Note A response must be discarded');
    assert.equal(host.postedMessages[0].message.noteId, 'note-B');
  });
});

/**
 * Minimal zero-dependency DOM harness to test the real compiled dist/webview/outline.js
 * (P0 #2 state preservation + P0 #4 search highlight <mark>, Escape key, toolbar state sync).
 */
function createMiniDom() {
  class MiniClassList {
    constructor(el) {
      this._el = el;
      this._set = new Set();
    }
    _syncFromString(str) {
      this._set = new Set(String(str || '').split(/\s+/).filter(Boolean));
    }
    add(...cls) {
      for (const c of cls) this._set.add(c);
    }
    remove(...cls) {
      for (const c of cls) this._set.delete(c);
    }
    contains(c) {
      return this._set.has(c);
    }
    toggle(c, force) {
      if (force === undefined) {
        if (this._set.has(c)) {
          this._set.delete(c);
          return false;
        }
        this._set.add(c);
        return true;
      }
      if (force) {
        this._set.add(c);
        return true;
      }
      this._set.delete(c);
      return false;
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
    set textContent(val) {
      if (this.nodeType === 3) {
        this._text = String(val ?? '');
      } else {
        this.childNodes = [];
        const str = String(val ?? '');
        if (str.length > 0) {
          const t = new MiniNode(3);
          t._text = str;
          t.parentNode = this;
          this.childNodes.push(t);
        }
      }
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

  class MiniElement extends MiniNode {
    constructor(tagName) {
      super(1, tagName);
      this.attributes = new Map();
      this.classList = new MiniClassList(this);
      this.style = {};
      this.dataset = {};
      this.listeners = new Map();
      this.value = '';
      this.placeholder = '';
      this.scrollTop = 0;
      this._innerHTML = '';
      this._focused = false;
    }
    get id() {
      return this.attributes.get('id') || '';
    }
    set id(v) {
      this.attributes.set('id', String(v));
    }
    get className() {
      return this.classList.toString();
    }
    set className(v) {
      this.classList._syncFromString(v);
    }
    get title() {
      return this.attributes.get('title') || '';
    }
    set title(v) {
      this.attributes.set('title', String(v));
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
      this.attributes.set(k, String(v));
    }
    getAttribute(k) {
      if (k === 'class') return this.className;
      return this.attributes.has(k) ? this.attributes.get(k) : null;
    }
    removeAttribute(k) {
      this.attributes.delete(k);
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    dispatchEvent(event) {
      event.target = event.target || this;
      event.preventDefault = event.preventDefault || (() => { event.defaultPrevented = true; });
      event.stopPropagation = event.stopPropagation || (() => { event.propagationStopped = true; });
      let cur = this;
      while (cur) {
        const list = cur.listeners?.get(event.type) || [];
        for (const fn of list) fn.call(cur, event);
        if (event.propagationStopped) break;
        cur = cur.parentNode;
      }
    }
    focus() {
      document.activeElement = this;
      this._focused = true;
    }
    matches(selector) {
      if (selector.startsWith('#')) return this.id === selector.slice(1);
      if (selector.startsWith('.')) {
        const parts = selector.split('.').filter(Boolean);
        return parts.every((p) => this.classList.contains(p));
      }
      return this.tagName.toLowerCase() === selector.toLowerCase();
    }
    closest(selector) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (cur.matches(selector)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }
    querySelectorAll(selector) {
      const results = [];
      const walk = (node) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 1) {
            if (child.matches(selector)) results.push(child);
            walk(child);
          }
        }
      };
      walk(this);
      return results;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }

  const body = new MiniElement('body');
  const container = new MiniElement('div');
  container.id = 'outline-container';
  container.className = 'outline-container';
  const searchToggleBtn = new MiniElement('div');
  searchToggleBtn.id = 'search-toggle-btn';
  const wrapToggleBtn = new MiniElement('div');
  wrapToggleBtn.id = 'wrap-toggle-btn';
  const collapseAllBtn = new MiniElement('div');
  collapseAllBtn.id = 'collapse-all-btn';
  const searchContainer = new MiniElement('div');
  searchContainer.id = 'search-container';
  const searchInput = new MiniElement('input');
  searchInput.id = 'search-input';
  const searchClearBtn = new MiniElement('span');
  searchClearBtn.id = 'search-clear-btn';
  const outlineTree = new MiniElement('div');
  outlineTree.id = 'outline-tree';

  searchContainer.appendChild(searchInput);
  searchContainer.appendChild(searchClearBtn);
  container.appendChild(searchToggleBtn);
  container.appendChild(wrapToggleBtn);
  container.appendChild(collapseAllBtn);
  container.appendChild(searchContainer);
  container.appendChild(outlineTree);
  body.appendChild(container);

  const byId = new Map([
    ['outline-container', container],
    ['search-toggle-btn', searchToggleBtn],
    ['wrap-toggle-btn', wrapToggleBtn],
    ['collapse-all-btn', collapseAllBtn],
    ['search-container', searchContainer],
    ['search-input', searchInput],
    ['search-clear-btn', searchClearBtn],
    ['outline-tree', outlineTree],
  ]);

  const docListeners = new Map();
  const document = {
    readyState: 'complete',
    visibilityState: 'visible',
    body,
    activeElement: null,
    getElementById(id) {
      return byId.get(id) || null;
    },
    createElement(tag) {
      return new MiniElement(tag);
    },
    createTextNode(text) {
      const n = new MiniNode(3);
      n._text = String(text);
      return n;
    },
    createDocumentFragment() {
      return new MiniNode(11);
    },
    querySelectorAll(sel) {
      return body.querySelectorAll(sel);
    },
    querySelector(sel) {
      return body.querySelector(sel);
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    dispatchDocEvent(type) {
      for (const fn of docListeners.get(type) || []) fn({ type });
    },
  };

  return {
    document,
    elements: {
      container,
      searchToggleBtn,
      wrapToggleBtn,
      collapseAllBtn,
      searchContainer,
      searchInput,
      searchClearBtn,
      outlineTree,
    },
  };
}

describe('P0 #2 & #4: Compiled webview dist/webview/outline.js DOM behavior', () => {
  function bootWebview({ throwLocalStorage = false } = {}) {
    const dom = createMiniDom();
    const postedToHost = [];
    let hostMessageListener = null;
    let intervalCount = 0;

    const webviewApi = {
      postMessage(msg) {
        postedToHost.push(msg);
      },
      onMessage(cb) {
        hostMessageListener = cb;
      },
    };

    const storageMap = new Map();
    const localStorage = {
      getItem(k) {
        if (throwLocalStorage) throw new Error('SecurityError');
        return storageMap.has(k) ? storageMap.get(k) : null;
      },
      setItem(k, v) {
        if (throwLocalStorage) throw new Error('SecurityError');
        storageMap.set(k, String(v));
      },
    };

    const winListeners = new Map();
    const windowObj = {
      webviewApi,
      localStorage,
      innerWidth: 320,
      addEventListener(type, fn) {
        if (!winListeners.has(type)) winListeners.set(type, []);
        winListeners.get(type).push(fn);
      },
    };

    const code = fs.readFileSync(webviewBundlePath, 'utf8');
    const sandbox = {
      window: windowObj,
      document: dom.document,
      webviewApi,
      localStorage,
      console,
      setTimeout,
      clearTimeout,
      setInterval: () => {
        intervalCount += 1;
        return 1;
      },
      clearInterval,
    };
    vm.runInContext(code, vm.createContext(sandbox), { filename: 'dist/webview/outline.js' });

    return {
      ...dom,
      postedToHost,
      sendFromHost: (msg) => hostMessageListener(msg),
      get intervalCount() {
        return intervalCount;
      },
    };
  }

  it('sends a single ready handshake with zero setInterval polling and survives localStorage SecurityError', () => {
    const wv = bootWebview({ throwLocalStorage: true });
    assert.equal(wv.intervalCount, 0, 'Webview must never use setInterval polling');
    assert.equal(wv.postedToHost.length, 1);
    assert.equal(wv.postedToHost[0].type, 'ready');

    // Toolbar controls still work despite localStorage throwing
    wv.elements.searchToggleBtn.dispatchEvent({ type: 'click' });
    assert.equal(wv.elements.searchContainer.classList.contains('is-visible'), true);
    assert.equal(wv.elements.searchToggleBtn.classList.contains('is-active'), true);
    assert.equal(wv.elements.searchToggleBtn.getAttribute('aria-pressed'), 'true');
  });

  it('highlights Persian ZWNJ & accented matches with exact <mark> slices and handles Escape key cleanly', () => {
    const wv = bootWebview();
    wv.sendFromHost({
      type: 'outlineUpdate',
      version: 1,
      noteId: 'note-1',
      noteChanged: true,
      selectionKind: 'single',
      markupLanguage: 1,
      isRtl: true,
      isMobile: false,
      headings: [
        {
          id: 'h-0',
          key: 'persian-1',
          level: 1,
          text: 'من می‌خواهم معماری Café را ببینم',
          rawText: 'من می‌خواهم معماری Café را ببینم',
          line: 0,
          slug: 'persian-1',
          script: 'persian',
          children: [],
        },
      ],
    });

    // Open search and type normalized query without ZWNJ
    wv.elements.searchToggleBtn.dispatchEvent({ type: 'click' });
    wv.elements.searchInput.value = 'میخواهم';
    wv.elements.searchInput.dispatchEvent({ type: 'input' });

    assert.equal(wv.elements.searchClearBtn.style.display, 'block');
    const marks = wv.elements.outlineTree.querySelectorAll('mark');
    assert.equal(marks.length, 1);
    assert.equal(marks[0].className, 'highlight-match');
    assert.equal(marks[0].textContent, 'می\u200Cخواهم');

    // Accent search
    wv.elements.searchInput.value = 'cafe';
    wv.elements.searchInput.dispatchEvent({ type: 'input' });
    const accentMarks = wv.elements.outlineTree.querySelectorAll('mark');
    assert.equal(accentMarks.length, 1);
    assert.equal(accentMarks[0].textContent, 'Café');

    // First Escape clears query and restores full view while keeping search bar open
    wv.elements.searchInput.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(wv.elements.searchInput.value, '');
    assert.equal(wv.elements.searchClearBtn.style.display, 'none');
    assert.equal(wv.elements.searchContainer.classList.contains('is-visible'), true);
    assert.equal(wv.elements.outlineTree.querySelectorAll('mark').length, 0);

    // Second Escape closes search bar and updates search-toggle-btn active state
    wv.elements.searchInput.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(wv.elements.searchContainer.classList.contains('is-visible'), false);
    assert.equal(wv.elements.searchToggleBtn.classList.contains('is-active'), false);
    assert.equal(wv.elements.searchToggleBtn.getAttribute('aria-pressed'), 'false');
  });

  it('preserves collapsed branches, active heading, and scrollTop across edits and resets collapse-all button on note switch', () => {
    const wv = bootWebview();
    const noteAHeadings = [
      {
        id: 'h-0',
        key: 'section-a',
        level: 1,
        text: 'Section A',
        rawText: 'Section A',
        line: 0,
        slug: 'section-a',
        script: 'latin',
        children: [
          {
            id: 'h-2',
            key: 'child-a',
            level: 2,
            text: 'Child A',
            rawText: 'Child A',
            line: 2,
            slug: 'child-a',
            script: 'latin',
            children: [],
          },
        ],
      },
    ];

    wv.sendFromHost({
      type: 'outlineUpdate',
      version: 1,
      noteId: 'note-A',
      noteChanged: true,
      selectionKind: 'single',
      markupLanguage: 1,
      isRtl: false,
      isMobile: false,
      headings: noteAHeadings,
    });

    // Click Section A to make it active, scroll down, and collapse all
    const rowA = wv.elements.outlineTree.querySelector('.tree-item-self');
    rowA.dispatchEvent({ type: 'click' });
    wv.elements.outlineTree.scrollTop = 120;
    wv.elements.collapseAllBtn.dispatchEvent({ type: 'click' });

    assert.equal(wv.elements.collapseAllBtn.classList.contains('is-active'), true);
    assert.equal(wv.elements.collapseAllBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(wv.elements.collapseAllBtn.getAttribute('title'), 'Expand all sections');

    // Same-note edit shifts line numbers (line 0 -> line 10, new heading id)
    wv.sendFromHost({
      type: 'outlineUpdate',
      version: 2,
      noteId: 'note-A',
      noteChanged: false,
      selectionKind: 'single',
      markupLanguage: 1,
      isRtl: false,
      isMobile: false,
      headings: [
        {
          ...noteAHeadings[0],
          id: 'h-10',
          line: 10,
          children: [{ ...noteAHeadings[0].children[0], id: 'h-12', line: 12 }],
        },
      ],
    });

    const rerenderedItem = wv.elements.outlineTree.querySelector('.tree-item');
    const rerenderedSelf = wv.elements.outlineTree.querySelector('.tree-item-self');
    assert.equal(rerenderedItem.classList.contains('is-collapsed'), true, 'Collapsed state must persist across edits');
    assert.equal(rerenderedSelf.classList.contains('is-active'), true, 'Active highlight must persist across edits');
    assert.equal(wv.elements.outlineTree.scrollTop, 120, 'Scroll position must persist across edits');

    // Switch to Note B (expanded by default) -> collapse-all button MUST reset cleanly!
    wv.sendFromHost({
      type: 'outlineUpdate',
      version: 3,
      noteId: 'note-B',
      noteChanged: true,
      selectionKind: 'single',
      markupLanguage: 1,
      isRtl: false,
      isMobile: false,
      headings: [
        {
          id: 'b-0',
          key: 'section-b',
          level: 1,
          text: 'Section B',
          rawText: 'Section B',
          line: 0,
          slug: 'section-b',
          script: 'latin',
          children: [
            {
              id: 'b-1',
              key: 'child-b',
              level: 2,
              text: 'Child B',
              rawText: 'Child B',
              line: 1,
              slug: 'child-b',
              script: 'latin',
              children: [],
            },
          ],
        },
      ],
    });

    assert.equal(wv.elements.outlineTree.scrollTop, 0, 'Scroll resets on note switch');
    assert.equal(wv.elements.collapseAllBtn.classList.contains('is-active'), false);
    assert.equal(wv.elements.collapseAllBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(wv.elements.collapseAllBtn.getAttribute('title'), 'Collapse all sections');

    // First click on Note B immediately collapses Note B (not a no-op!)
    wv.elements.collapseAllBtn.dispatchEvent({ type: 'click' });
    assert.equal(
      wv.elements.outlineTree.querySelector('.tree-item').classList.contains('is-collapsed'),
      true,
    );
    assert.equal(wv.elements.collapseAllBtn.classList.contains('is-active'), true);
  });
});
