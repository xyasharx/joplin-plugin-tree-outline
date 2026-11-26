import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distIndexPath = path.join(repoRoot, 'dist', 'index.js');
const distWebviewPath = path.join(repoRoot, 'dist', 'webview', 'outline.js');
const distCssPath = path.join(repoRoot, 'dist', 'webview', 'outline.css');
const srcHtmlPath = path.join(repoRoot, 'src', 'webview', 'outline.html');
const jplPath = path.join(repoRoot, 'publish', 'com.xyasharx.treeoutline.jpl');

/**
 * Minimal host mock supporting Joplin 3.x joplin.settings.values(),
 * joplin.settings.globalValues(), and joplin.settings.onChange().
 */
function createSettingsIntegrationHost({
  persistedSettings = {},
  supportsBatchValues = true,
  supportsGlobalValues = true,
  codeView = true,
  visiblePanes = ['editor', 'viewer'],
} = {}) {
  const registeredSettings = new Map();
  const settingValues = new Map(Object.entries(persistedSettings));
  const settingsChangeListeners = [];
  const postedMessages = [];
  const executedCommands = [];
  let panelHtmlCaptured = '';
  let panelMessageHandler = null;
  let valuesCallCount = 0;
  let globalValuesCallCount = 0;

  const settingsApi = {
    async registerSection() {},
    async registerSettings(defs) {
      for (const [key, def] of Object.entries(defs)) {
        registeredSettings.set(key, def);
        if (!settingValues.has(key)) {
          settingValues.set(key, def.value);
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
      if (key === 'editor.codeView') return codeView;
      if (key === 'noteVisiblePanes') return visiblePanes;
      return undefined;
    },
    async onChange(cb) {
      settingsChangeListeners.push(cb);
    },
  };

  if (supportsBatchValues) {
    settingsApi.values = async (keys) => {
      valuesCallCount += 1;
      const list = Array.isArray(keys) ? keys : [keys];
      const result = {};
      for (const key of list) {
        result[key] = settingValues.get(key);
      }
      return result;
    };
  }

  if (supportsGlobalValues) {
    settingsApi.globalValues = async (keys) => {
      globalValuesCallCount += 1;
      return keys.map((key) => {
        if (key === 'editor.codeView') return codeView;
        if (key === 'noteVisiblePanes') return visiblePanes;
        return undefined;
      });
    };
  }

  let registeredPlugin = null;
  const joplin = {
    plugins: {
      register(plugin) {
        registeredPlugin = plugin;
      },
    },
    versionInfo: async () => ({ platform: 'desktop', version: '3.2.0' }),
    settings: settingsApi,
    contentScripts: { register: async () => {} },
    commands: {
      register: async () => {},
      execute: async (name, ...args) => {
        executedCommands.push({ name, args });
        if (name === 'editor.execCommand' && args[0]?.name === 'treeOutline.scrollToLine') {
          return true;
        }
        return undefined;
      },
    },
    views: {
      panels: {
        create: async (id) => `panel:${id}`,
        setHtml: async (_h, html) => {
          panelHtmlCaptured = html;
        },
        addScript: async () => {},
        show: async () => {},
        hide: async () => {},
        visible: async () => true,
        onMessage: async (_h, cb) => {
          panelMessageHandler = cb;
        },
        postMessage: (_h, message) => {
          postedMessages.push(JSON.parse(JSON.stringify(message)));
        },
      },
      menuItems: { create: async () => {} },
      toolbarButtons: { create: async () => {} },
    },
    workspace: {
      selectedNote: async () => ({
        id: 'note-pref',
        title: 'Preferences Test',
        body: '# Heading One\n',
        markup_language: 1,
      }),
      selectedNoteIds: async () => ['note-pref'],
      onNoteSelectionChange: async () => {},
      onNoteChange: async () => {},
      onSyncComplete: async () => {},
    },
    data: { get: async () => null },
  };

  const code = fs.readFileSync(distIndexPath, 'utf8');
  const mod = { exports: {} };
  const sandbox = {
    module: mod,
    exports: mod.exports,
    require: (id) => {
      if (id === 'api' || id === 'api/index') return { default: joplin };
      if (id === 'api/types') {
        return {
          MenuItemLocation: { Tools: 'tools' },
          ToolbarButtonLocation: { NoteToolbar: 'noteToolbar' },
          SettingItemType: { Int: 1, String: 2, Bool: 3 },
          SettingStorage: { Database: 1, File: 2 },
          ContentScriptType: { CodeMirrorPlugin: 'codeMirrorPlugin' },
          MarkupLanguage: { Markdown: 1, Html: 2 },
        };
      }
      throw new Error(`Unexpected require("${id}")`);
    },
    joplin,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(code, sandbox, { filename: distIndexPath });

  return {
    registeredSettings,
    settingValues,
    postedMessages,
    executedCommands,
    get panelHtml() {
      return panelHtmlCaptured;
    },
    get valuesCallCount() {
      return valuesCallCount;
    },
    get globalValuesCallCount() {
      return globalValuesCallCount;
    },
    async start() {
      await registeredPlugin.onStart();
    },
    async sendFromWebview(msg) {
      return panelMessageHandler(msg);
    },
    async simulateJoplinSettingChange(updates) {
      const keys = Object.keys(updates);
      for (const [k, v] of Object.entries(updates)) {
        settingValues.set(k, v);
      }
      for (const cb of settingsChangeListeners) {
        await cb({ keys });
      }
    },
  };
}

/**
 * Lightweight DOM harness for testing compiled dist/webview/outline.js
 * preferences sync, Joplin { message } envelope unwrapping, and blocked localStorage.
 */
function createPreferencesWebviewHarness({ innerWidth = 900, throwStorage = true } = {}) {
  const byId = new Map();
  const windowListeners = new Map();

  class FakeClassList {
    constructor(el) {
      this._el = el;
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
    toArray() {
      return Array.from(this._set);
    }
  }

  class FakeElement {
    constructor(tagName, id = '') {
      this.tagName = tagName.toUpperCase();
      this.attrs = new Map();
      this.classList = new FakeClassList(this);
      this.children = [];
      this.listeners = new Map();
      this.style = {};
      this.value = '';
      this.scrollTop = 0;
      if (id) {
        this.id = id;
        byId.set(id, this);
      }
    }
    setAttribute(k, v) {
      this.attrs.set(k, String(v));
    }
    getAttribute(k) {
      return this.attrs.has(k) ? this.attrs.get(k) : null;
    }
    removeAttribute(k) {
      this.attrs.delete(k);
    }
    addEventListener(type, fn) {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    }
    dispatch(type, event = {}) {
      for (const fn of this.listeners.get(type) ?? []) {
        fn({
          target: this,
          preventDefault() {},
          stopPropagation() {},
          ...event,
        });
      }
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    replaceChildren(...nodes) {
      this.children = [...nodes];
    }
    focus() {}
    querySelector() {
      return null;
    }
    closest() {
      return null;
    }
  }

  const body = new FakeElement('body');
  const container = new FakeElement('div', 'outline-container');
  const searchToggleBtn = new FakeElement('div', 'search-toggle-btn');
  const wrapToggleBtn = new FakeElement('div', 'wrap-toggle-btn');
  const collapseAllBtn = new FakeElement('div', 'collapse-all-btn');
  const searchContainer = new FakeElement('div', 'search-container');
  const searchInput = new FakeElement('input', 'search-input');
  const searchClearBtn = new FakeElement('span', 'search-clear-btn');
  const outlineTree = new FakeElement('div', 'outline-tree');

  const posted = [];
  let onMessageHandler = null;

  const webviewApi = {
    postMessage(msg) {
      posted.push(msg);
    },
    onMessage(cb) {
      onMessageHandler = cb;
    },
  };

  const localStorage = throwStorage
    ? {
        getItem() {
          throw new Error('SecurityError: localStorage blocked');
        },
        setItem() {
          throw new Error('SecurityError: localStorage blocked');
        },
      }
    : (() => {
        const store = new Map();
        return {
          getItem: (k) => (store.has(k) ? store.get(k) : null),
          setItem: (k, v) => store.set(k, String(v)),
        };
      })();

  const win = {
    innerWidth,
    localStorage,
    webviewApi,
    addEventListener(type, fn) {
      const list = windowListeners.get(type) ?? [];
      list.push(fn);
      windowListeners.set(type, list);
    },
  };

  const doc = {
    readyState: 'complete',
    visibilityState: 'visible',
    body,
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    createDocumentFragment: () => {
      const children = [];
      return {
        children,
        appendChild(c) {
          children.push(c);
          return c;
        },
      };
    },
    querySelectorAll: () => [],
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

  return {
    win,
    container,
    wrapToggleBtn,
    outlineTree,
    searchToggleBtn,
    collapseAllBtn,
    searchContainer,
    searchInput,
    searchClearBtn,
    posted,
    pushJoplinEnvelope(payload) {
      // Exact Joplin Desktop & Mobile runtime envelope: webviewApi.onMessage((event) => event.message)
      onMessageHandler({ message: payload });
    },
    resizeTo(width) {
      win.innerWidth = width;
      for (const fn of windowListeners.get('resize') ?? []) {
        fn();
      }
    },
  };
}

describe('P1 #5: Dead code removal, single-source HTML template, dependencies & manifest', () => {
  it('sets real homepage_url and preserves Joplin registry-locked repository_url in src & dist manifest', () => {
    const srcManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'src', 'manifest.json'), 'utf8'));
    const distManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'dist', 'manifest.json'), 'utf8'));

    assert.equal(srcManifest.homepage_url, 'https://github.com/xyasharx/joplin-plugin-tree-outline');
    assert.equal(distManifest.homepage_url, 'https://github.com/xyasharx/joplin-plugin-tree-outline');
    // Must match original joplin/plugins/manifests.json lock so automated updates are not rejected
    assert.equal(srcManifest.repository_url, 'https://github.com/your-username/joplin-plugin-tree-outline');
    assert.equal(distManifest.repository_url, 'https://github.com/your-username/joplin-plugin-tree-outline');
  });

  it('removes unused chalk and glob from package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    assert.equal(pkg.dependencies?.chalk, undefined);
    assert.equal(pkg.devDependencies?.chalk, undefined);
    assert.equal(pkg.dependencies?.glob, undefined);
    assert.equal(pkg.devDependencies?.glob, undefined);
  });

  it('loads src/webview/outline.html as the single source of truth via Webpack asset/source and does NOT ship unused outline.html in .jpl', async () => {
    const expectedHtml = fs.readFileSync(srcHtmlPath, 'utf8');
    assert.ok(expectedHtml.includes('id="wrap-toggle-btn"'), 'outline.html must contain #wrap-toggle-btn');

    const host = createSettingsIntegrationHost();
    await host.start();
    assert.equal(host.panelHtml, expectedHtml, 'Plugin setHtml() must use exact src/webview/outline.html');

    assert.ok(!fs.existsSync(path.join(repoRoot, 'dist', 'webview', 'outline.html')));
    const archiveEntries = execFileSync('tar', ['-tf', jplPath], { encoding: 'utf8' })
      .trim()
      .split(/\r?\n/);
    assert.ok(
      !archiveEntries.some((entry) => entry.endsWith('.html')),
      `Unused HTML files must not be shipped in .jpl archive: ${archiveEntries.join(', ')}`,
    );
  });

  it('contains zero orphaned Font Preset Menu CSS/JS references in src/ or dist/', () => {
    const distCss = fs.readFileSync(distCssPath, 'utf8');
    const distJs = fs.readFileSync(distWebviewPath, 'utf8');
    const srcCss = fs.readFileSync(path.join(repoRoot, 'src', 'webview', 'outline.css'), 'utf8');

    for (const deadToken of ['font-toggle-btn', 'font-menu', 'font-icon-label']) {
      assert.ok(!srcCss.includes(deadToken), `src/webview/outline.css should not contain ${deadToken}`);
      assert.ok(!distCss.includes(deadToken), `dist/webview/outline.css should not contain ${deadToken}`);
      assert.ok(!distJs.includes(deadToken), `dist/webview/outline.js should not contain ${deadToken}`);
    }
  });
});

describe('P1 #6: Native joplin.settings persistence, live onChange sync & Joplin envelope handling', () => {
  it('registers textWrapMode, fontPreset, and autoDismissOnMobile in treeOutline settings with SettingStorage.File', async () => {
    const host = createSettingsIntegrationHost();
    await host.start();

    const wrapDef = host.registeredSettings.get('textWrapMode');
    const fontDef = host.registeredSettings.get('fontPreset');
    const dismissDef = host.registeredSettings.get('autoDismissOnMobile');

    assert.ok(wrapDef, 'textWrapMode setting must be registered');
    assert.equal(wrapDef.section, 'treeOutline');
    assert.equal(wrapDef.value, 'auto');
    assert.equal(wrapDef.isEnum, true);
    assert.equal(wrapDef.storage, 2); // SettingStorage.File
    assert.deepEqual(Object.keys(wrapDef.options), ['auto', 'wrapped', 'nowrap']);

    assert.ok(fontDef, 'fontPreset setting must be registered');
    assert.equal(fontDef.section, 'treeOutline');
    assert.equal(fontDef.value, 'auto');
    assert.equal(fontDef.isEnum, true);
    assert.equal(fontDef.storage, 2); // SettingStorage.File
    assert.ok(fontDef.options.vazirmatn && fontDef.options.arabic && fontDef.options.mono);

    assert.ok(dismissDef, 'autoDismissOnMobile setting must be registered');
    assert.equal(dismissDef.section, 'treeOutline');
    assert.equal(dismissDef.storage, 2); // SettingStorage.File
  });

  it('batches startup reads via joplin.settings.values(), persists wrap changes, and pushes live onChange updates', async () => {
    const host = createSettingsIntegrationHost({
      persistedSettings: {
        textWrapMode: 'wrapped',
        fontPreset: 'lora',
      },
      supportsBatchValues: true,
    });
    await host.start();

    // Webview ready handshake -> host pushes initial preferencesUpdate + outlineUpdate
    host.postedMessages.length = 0;
    await host.sendFromWebview({ type: 'ready' });
    assert.ok(host.valuesCallCount >= 1, 'Should use batch joplin.settings.values() when available');

    const initialPrefs = host.postedMessages.find((m) => m.type === 'preferencesUpdate');
    assert.equal(initialPrefs?.preferences.textWrapMode, 'wrapped');
    assert.equal(initialPrefs?.preferences.fontPreset, 'lora');
    assert.equal(initialPrefs?.preferences.maxHeadingDepth, 6);
    assert.equal(initialPrefs?.preferences.followActiveHeading, true);

    // Webview toggles wrap off -> host persists 'nowrap' via joplin.settings.setValue
    await host.sendFromWebview({ type: 'updatePreferences', textWrapMode: 'nowrap' });
    assert.equal(host.settingValues.get('textWrapMode'), 'nowrap');

    // User edits fontPreset in Joplin Settings -> live onChange pushes updated preferences
    host.postedMessages.length = 0;
    await host.simulateJoplinSettingChange({ fontPreset: 'mono', textWrapMode: 'auto' });
    assert.equal(host.postedMessages.length, 1);
    assert.equal(host.postedMessages[0].type, 'preferencesUpdate');
    assert.equal(host.postedMessages[0].preferences.textWrapMode, 'auto');
    assert.equal(host.postedMessages[0].preferences.fontPreset, 'mono');

    // Unrelated setting changes should NOT trigger redundant preferencesUpdate pushes
    host.postedMessages.length = 0;
    await host.simulateJoplinSettingChange({ panelVisible: false });
    assert.equal(host.postedMessages.length, 0);
  });

  it('falls back cleanly when joplin.settings.values() and globalValues() are absent on older Joplin builds', async () => {
    const host = createSettingsIntegrationHost({
      persistedSettings: { textWrapMode: 'nowrap', fontPreset: 'inter' },
      supportsBatchValues: false,
      supportsGlobalValues: false,
      codeView: true,
      visiblePanes: ['editor'],
    });
    await host.start();
    host.postedMessages.length = 0;

    await host.sendFromWebview({ type: 'ready' });
    const prefMsg = host.postedMessages.find((m) => m.type === 'preferencesUpdate');
    assert.equal(prefMsg?.preferences.textWrapMode, 'nowrap');
    assert.equal(prefMsg?.preferences.fontPreset, 'inter');

    await host.sendFromWebview({
      type: 'jumpToHeading',
      line: 0,
      slug: 'heading-one',
      text: 'Heading One',
      level: 1,
    });
    assert.equal(
      host.executedCommands.some((c) => c.name === 'editor.execCommand'),
      true,
    );
  });

  it('uses modern joplin.settings.globalValues() for desktop jump state on Joplin 2.14+', async () => {
    const host = createSettingsIntegrationHost({
      supportsGlobalValues: true,
      codeView: true,
      visiblePanes: ['editor', 'viewer'],
    });
    await host.start();

    await host.sendFromWebview({
      type: 'jumpToHeading',
      line: 0,
      slug: 'heading-one',
      text: 'Heading One',
      level: 1,
    });
    assert.equal(host.globalValuesCallCount, 1);
  });

  it('unwraps real Joplin { message } envelopes, syncs wrap/font presets, and survives blocked localStorage', () => {
    const harness = createPreferencesWebviewHarness({ innerWidth: 900, throwStorage: true });

    // Even with blocked localStorage, initial handshake runs cleanly
    assert.equal(harness.posted.length, 1);
    assert.equal(harness.posted[0].type, 'ready');
    assert.equal(harness.container.classList.contains('is-wrapped'), false);

    // Receive preferencesUpdate wrapped in Joplin's real { message: payload } event envelope
    harness.pushJoplinEnvelope({
      type: 'preferencesUpdate',
      preferences: { textWrapMode: 'wrapped', fontPreset: 'vazirmatn' },
    });
    assert.equal(harness.container.classList.contains('is-wrapped'), true);
    assert.equal(harness.wrapToggleBtn.classList.contains('is-active'), true);
    assert.equal(harness.wrapToggleBtn.getAttribute('aria-pressed'), 'true');
    assert.equal(harness.container.classList.contains('override-vazirmatn'), true);

    // Clicking wrap toggle persists 'nowrap' to plugin host via postMessage
    harness.wrapToggleBtn.dispatch('click');
    assert.equal(harness.container.classList.contains('is-wrapped'), false);
    assert.equal(harness.wrapToggleBtn.getAttribute('aria-pressed'), 'false');
    assert.equal(harness.posted[harness.posted.length - 1].type, 'updatePreferences');
    assert.equal(harness.posted[harness.posted.length - 1].textWrapMode, 'nowrap');

    // Switch back to 'auto' wrap and 'auto' font preset from Joplin Settings
    harness.pushJoplinEnvelope({
      type: 'preferencesUpdate',
      preferences: { textWrapMode: 'auto', fontPreset: 'auto' },
    });
    assert.equal(harness.container.classList.contains('override-vazirmatn'), false);
    assert.equal(harness.container.classList.contains('is-wrapped'), false);

    // Narrow panel resize in 'auto' mode automatically enables wrapping
    harness.resizeTo(480);
    assert.equal(harness.container.classList.contains('is-wrapped'), true);

    // Wide panel resize in 'auto' mode disables wrapping
    harness.resizeTo(900);
    assert.equal(harness.container.classList.contains('is-wrapped'), false);

    // Outline updates arriving in Joplin's real { message: payload } envelope also render properly
    harness.pushJoplinEnvelope({
      type: 'outlineUpdate',
      version: 1,
      noteId: 'n-envelope',
      noteChanged: true,
      selectionKind: 'single',
      markupLanguage: 1,
      isRtl: false,
      isMobile: false,
      headings: [
        {
          id: 'h-0',
          key: '1:intro:0',
          level: 1,
          text: 'Intro',
          rawText: 'Intro',
          line: 0,
          slug: 'intro',
          script: 'latin',
          children: [],
        },
      ],
    });
    assert.equal(harness.outlineTree.children.length, 1);
  });
});
