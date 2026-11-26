import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const bundlePath = path.join(repoRoot, 'dist', 'index.js');

/**
 * Simulates the real Joplin Plugin API runtime behavior from laurent22/joplin:
 * - JoplinViewsMenuItems.create() requires a registered command and registers it
 *   in KeymapService (with accelerator || null) so it appears in Keyboard Shortcuts.
 * - JoplinViewsToolbarButtons.create() requires a registered command.
 * - KeymapConfigScreen filters commands by command name or command label.
 */
function createJoplinHostMock({
  platform = 'desktop',
  persistedSettings = {},
  selectedNote = null,
  throwOnSettings = false,
} = {}) {
  const callOrder = [];
  const commands = new Map();
  const keymap = new Map();
  const menuItems = [];
  const toolbarButtons = [];
  const contentScripts = [];
  const registeredSections = new Map();
  const registeredSettings = new Map();
  const settingValues = new Map(Object.entries(persistedSettings));
  const panels = new Map();
  const postedMessages = [];
  const messageHandlers = new Map();
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
        callOrder.push(`contentScripts.register:${type}:${id}`);
        contentScripts.push({ type, id, scriptPath });
      },
    },
    async versionInfo() {
      if (platform === 'legacy-desktop') {
        return { version: '2.8.0', profileVersion: 41, syncVersion: 3 };
      }
      return {
        version: '3.7.0',
        profileVersion: 45,
        syncVersion: 3,
        platform,
      };
    },
    settings: {
      async registerSection(name, section) {
        if (throwOnSettings) throw new Error('Settings unavailable');
        registeredSections.set(name, section);
      },
      async registerSettings(settings) {
        callOrder.push('settings.registerSettings');
        if (throwOnSettings) throw new Error('Settings unavailable');
        for (const [key, spec] of Object.entries(settings)) {
          registeredSettings.set(key, spec);
          if (!settingValues.has(key)) {
            settingValues.set(key, spec.value);
          }
        }
      },
      async registerSetting() {
        throw new Error('Deprecated joplin.settings.registerSetting() must not be called');
      },
      async value(key) {
        if (throwOnSettings) throw new Error('Settings unavailable');
        return settingValues.get(key);
      },
      async setValue(key, value) {
        callOrder.push(`settings.setValue:${key}=${value}`);
        if (throwOnSettings) throw new Error('Settings unavailable');
        settingValues.set(key, value);
      },
      async globalValue(key) {
        if (key === 'noteVisiblePanes') return ['editor', 'viewer'];
        if (key === 'editor.codeView') return true;
        return undefined;
      },
    },
    commands: {
      async register(command) {
        callOrder.push(`commands.register:${command.name}`);
        commands.set(command.name, command);
      },
      async execute(name, ...args) {
        const command = commands.get(name);
        if (!command) throw new Error(`Command not found: ${name}`);
        return command.execute(...args);
      },
    },
    views: {
      panels: {
        async create(id) {
          callOrder.push(`panels.create:${id}`);
          const handle = `plugin-view-com.xyasharx.treeoutline-${id}`;
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
          callOrder.push(`panels.show:${show}`);
          panels.get(handle).visible = Boolean(show);
        },
        async hide(handle) {
          callOrder.push('panels.hide');
          panels.get(handle).visible = false;
        },
        async visible(handle) {
          return panels.get(handle).visible;
        },
      },
      menuItems: {
        async create(id, commandName, location = 'tools', options = null) {
          callOrder.push(`menuItems.create:${id}:${location}`);
          assert.ok(
            commands.has(commandName),
            `Command "${commandName}" must be registered before menuItems.create()`,
          );
          menuItems.push({ id, commandName, location, options });
          // Mirrors JoplinViewsMenuItems.ts registering commands in KeymapService
          if (!keymap.has(commandName)) {
            keymap.set(commandName, {
              command: commandName,
              accelerator: options?.accelerator ?? null,
            });
          }
        },
      },
      toolbarButtons: {
        async create(id, commandName, location) {
          callOrder.push(`toolbarButtons.create:${id}:${location}`);
          assert.ok(
            commands.has(commandName),
            `Command "${commandName}" must be registered before toolbarButtons.create()`,
          );
          toolbarButtons.push({ id, commandName, location });
        },
      },
    },
    workspace: {
      async selectedNote() {
        return selectedNote;
      },
      async selectedNoteIds() {
        return selectedNote ? [selectedNote.id] : [];
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
        return selectedNote;
      },
    },
  };

  async function startPlugin() {
    const code = fs.readFileSync(bundlePath, 'utf8');
    const sandbox = {
      joplin,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    };
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(code, context, { filename: 'dist/index.js' });
    assert.ok(registeredPlugin?.onStart, 'Plugin must register an onStart handler');
    await registeredPlugin.onStart();
  }

  /** Mirrors KeymapConfigScreen.tsx search filter */
  function searchKeyboardShortcuts(query) {
    const q = query.toLowerCase();
    return Array.from(keymap.values()).filter(({ command }) => {
      const label = commands.get(command)?.label ?? command;
      return command.toLowerCase().includes(q) || label.toLowerCase().includes(q);
    });
  }

  return {
    joplin,
    startPlugin,
    searchKeyboardShortcuts,
    callOrder,
    commands,
    keymap,
    menuItems,
    toolbarButtons,
    contentScripts,
    registeredSections,
    registeredSettings,
    settingValues,
    panels,
    postedMessages,
    messageHandlers,
    get noteSelectionHandler() {
      return noteSelectionHandler;
    },
    get noteChangeHandler() {
      return noteChangeHandler;
    },
    get syncCompleteHandler() {
      return syncCompleteHandler;
    },
  };
}

describe('TreeOutline desktop & mobile toggle controls (Issue #1)', () => {
  it('registers Tools menu item, Keyboard Shortcuts keymap entry, and NoteToolbar button on desktop (macOS/Windows/Linux)', async () => {
    const host = createJoplinHostMock({ platform: 'desktop' });
    await host.startPlugin();

    // 1. Command registered with clear label and icon
    const cmd = host.commands.get('toggleTreeOutline');
    assert.ok(cmd, 'toggleTreeOutline command should be registered');
    assert.equal(cmd.label, 'Toggle TreeOutline');
    assert.equal(cmd.iconName, 'fas fa-stream');

    // 2. Menu item registered under Tools (available on macOS, Windows, and Linux)
    assert.equal(host.menuItems.length, 1);
    assert.deepEqual(host.menuItems[0], {
      id: 'toggleTreeOutlineMenuItem',
      commandName: 'toggleTreeOutline',
      location: 'tools',
      options: null,
    });

    // 3. Registered in Joplin KeymapService with null accelerator (no conflicts)
    //    and discoverable when searching "Tree" in Keyboard Shortcuts
    const matches = host.searchKeyboardShortcuts('Tree');
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0], {
      command: 'toggleTreeOutline',
      accelerator: null,
    });

    // 4. Toolbar button registered in desktop NoteToolbar
    assert.equal(host.toolbarButtons.length, 1);
    assert.deepEqual(host.toolbarButtons[0], {
      id: 'toggleTreeOutlineToolbarButton',
      commandName: 'toggleTreeOutline',
      location: 'noteToolbar',
    });

    // 5. Private boolean setting registered via modern registerSettings()
    const setting = host.registeredSettings.get('panelVisible');
    assert.ok(setting);
    assert.equal(setting.type, 3); // SettingItemType.Bool
    assert.equal(setting.public, false);
    assert.equal(setting.value, true);

    // 6. Command registered before menu item & toolbar button
    const cmdIdx = host.callOrder.indexOf('commands.register:toggleTreeOutline');
    const menuIdx = host.callOrder.indexOf('menuItems.create:toggleTreeOutlineMenuItem:tools');
    const btnIdx = host.callOrder.indexOf('toolbarButtons.create:toggleTreeOutlineToolbarButton:noteToolbar');
    assert.ok(cmdIdx !== -1 && menuIdx > cmdIdx && btnIdx > cmdIdx);

    // 7. Visible by default on first run and initial push-based outlineUpdate dispatched
    const [panelHandle, panelState] = Array.from(host.panels.entries())[0];
    assert.equal(panelState.visible, true);
    assert.equal(host.postedMessages.length, 1);
    assert.equal(host.postedMessages[0].handle, panelHandle);
    assert.equal(host.postedMessages[0].message.type, 'outlineUpdate');
  });

  it('toggles visibility off and on, persists state, and syncs webview when shown', async () => {
    const host = createJoplinHostMock({ platform: 'desktop' });
    await host.startPlugin();

    const [panelHandle] = Array.from(host.panels.keys());
    assert.equal(await host.joplin.views.panels.visible(panelHandle), true);
    assert.equal(host.postedMessages.length, 1);

    // Toggle OFF
    await host.joplin.commands.execute('toggleTreeOutline');
    assert.equal(await host.joplin.views.panels.visible(panelHandle), false);
    assert.equal(host.settingValues.get('panelVisible'), false);
    assert.equal(host.postedMessages.length, 1, 'Should not post sync message when hiding');

    // Toggle ON
    await host.joplin.commands.execute('toggleTreeOutline');
    assert.equal(await host.joplin.views.panels.visible(panelHandle), true);
    assert.equal(host.settingValues.get('panelVisible'), true);
    assert.equal(host.postedMessages.length, 2, 'Should immediately push outlineUpdate when showing');
    assert.equal(host.postedMessages[1].message.type, 'outlineUpdate');
  });

  it('remembers hidden state across Joplin restarts on desktop', async () => {
    const host = createJoplinHostMock({
      platform: 'desktop',
      persistedSettings: { panelVisible: false },
    });
    await host.startPlugin();

    const [panelHandle] = Array.from(host.panels.keys());
    assert.equal(await host.joplin.views.panels.visible(panelHandle), false);
    assert.equal(host.postedMessages.length, 0);

    // User can toggle it back on via menu / toolbar / shortcut
    await host.joplin.commands.execute('toggleTreeOutline');
    assert.equal(await host.joplin.views.panels.visible(panelHandle), true);
    assert.equal(host.settingValues.get('panelVisible'), true);
    assert.equal(host.postedMessages.length, 1);
  });

  it('works on Joplin 2.8–2.12 desktop builds where versionInfo().platform is undefined', async () => {
    const host = createJoplinHostMock({ platform: 'legacy-desktop' });
    await host.startPlugin();

    assert.equal(host.menuItems.length, 1);
    assert.equal(host.toolbarButtons.length, 1);
    assert.equal(host.searchKeyboardShortcuts('Tree').length, 1);
  });

  it('skips desktop-only menuItems and NoteToolbar button on mobile and keeps panel open', async () => {
    const host = createJoplinHostMock({
      platform: 'mobile',
      persistedSettings: { panelVisible: false },
    });
    await host.startPlugin();

    assert.equal(host.menuItems.length, 0);
    assert.equal(host.toolbarButtons.length, 0);
    assert.ok(host.commands.has('toggleTreeOutline'));

    const [panelHandle] = Array.from(host.panels.keys());
    assert.equal(await host.joplin.views.panels.visible(panelHandle), true);
  });

  it('degrades gracefully if settings API throws', async () => {
    const host = createJoplinHostMock({
      platform: 'desktop',
      throwOnSettings: true,
    });
    await host.startPlugin();

    assert.equal(host.menuItems.length, 1);
    assert.equal(host.toolbarButtons.length, 1);
    const [panelHandle] = Array.from(host.panels.keys());
    assert.equal(await host.joplin.views.panels.visible(panelHandle), true);

    await host.joplin.commands.execute('toggleTreeOutline');
    assert.equal(await host.joplin.views.panels.visible(panelHandle), false);
  });

  it('parses both ATX and Setext headings on webview ready handshake without errors', async () => {
    const host = createJoplinHostMock({
      platform: 'desktop',
      selectedNote: {
        id: 'note-1',
        title: 'Test Note',
        markup_language: 1,
        body: 'Setext H1\n=========\n\nSetext H2\n---------\n\n### ATX H3\n',
      },
    });
    await host.startPlugin();

    const [panelHandle] = Array.from(host.panels.keys());
    const handler = host.messageHandlers.get(panelHandle);
    await handler({ type: 'ready' });

    const lastMsg = host.postedMessages[host.postedMessages.length - 1].message;
    assert.equal(lastMsg.type, 'outlineUpdate');
    assert.equal(lastMsg.headings.length, 1);
    assert.equal(lastMsg.headings[0].text, 'Setext H1');
    assert.equal(lastMsg.headings[0].rawText, 'Setext H1');
    assert.equal(lastMsg.headings[0].children[0].text, 'Setext H2');
    assert.equal(lastMsg.headings[0].children[0].children[0].text, 'ATX H3');
  });

  it('produces a valid .jpl archive in publish/ containing index, webview, and CM6 content script', () => {
    const jplPath = path.join(repoRoot, 'publish', 'com.xyasharx.treeoutline.jpl');
    const distDir = path.join(repoRoot, 'dist');
    assert.ok(fs.existsSync(jplPath), 'publish/com.xyasharx.treeoutline.jpl should exist');
    assert.ok(fs.statSync(jplPath).size > 0, '.jpl archive should be non-empty');

    const distEntries = fs.readdirSync(distDir);
    assert.ok(distEntries.includes('index.js'));
    assert.ok(distEntries.includes('manifest.json'));
    assert.ok(distEntries.includes('webview'));
    assert.ok(distEntries.includes('contentScripts'));
    assert.ok(
      fs.existsSync(path.join(distDir, 'contentScripts', 'codeMirrorScroller.js')),
      'dist/contentScripts/codeMirrorScroller.js should exist',
    );
    assert.ok(
      fs.existsSync(path.join(distDir, 'webview', 'outline.js')),
      'dist/webview/outline.js should exist',
    );
    assert.equal(
      distEntries.some((entry) => entry.endsWith('.ts')),
      false,
      'dist/ should not contain TypeScript source or declaration files',
    );
  });
});
