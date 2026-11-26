import joplin from 'api';
import { jumpToHeading, registerCodeMirrorScroller } from './navigation';
import { createOutlineSyncController } from './outlineSync';
import {
  persistTextWrapMode,
  readOutlinePreferences,
  registerPluginSettings,
  subscribePreferenceChanges,
} from './settings';
import { registerToggleControls } from './toggleControls';
import panelHtml from './webview/outline.html';
import type {
  OutlinePreferences,
  PreferencesUpdateMessage,
  WebviewToPluginMessage,
} from './webview/protocol';

joplin.plugins.register({
  onStart: async function () {
    const panel = await joplin.views.panels.create('tree_outline_panel');
    await joplin.views.panels.setHtml(panel, panelHtml);
    await joplin.views.panels.addScript(panel, './webview/outline.css');
    await joplin.views.panels.addScript(panel, './webview/outline.js');

    let isMobile = false;
    try {
      const vInfo = await joplin.versionInfo();
      isMobile = vInfo?.platform === 'mobile';
    } catch {
      isMobile = false;
    }

    await registerCodeMirrorScroller(joplin);
    await registerPluginSettings(joplin);

    const pushPreferences = (preferences: OutlinePreferences): void => {
      if (typeof joplin.views.panels.postMessage !== 'function') return;
      const msg: PreferencesUpdateMessage = {
        type: 'preferencesUpdate',
        preferences,
      };
      joplin.views.panels.postMessage(panel, msg);
    };

    const syncController = createOutlineSyncController({
      joplinApi: joplin,
      panel,
      isMobile,
    });

    await joplin.views.panels.onMessage(panel, async (message: WebviewToPluginMessage) => {
      if (!message || typeof message !== 'object') return;

      if (message.type === 'ready') {
        const preferences = await readOutlinePreferences(joplin.settings);
        pushPreferences(preferences);
        await syncController.handleWebviewReady();
        return;
      }

      if (message.type === 'updatePreferences') {
        if (message.textWrapMode !== undefined) {
          await persistTextWrapMode(joplin.settings, message.textWrapMode);
        }
        return;
      }

      if (message.type === 'requestSync') {
        await syncController.syncNow({ force: Boolean(message.force) });
        return;
      }

      if (message.type === 'jumpToHeading') {
        await jumpToHeading({
          joplinApi: joplin,
          isMobile,
          line: typeof message.line === 'number' ? message.line : 0,
          slug: typeof message.slug === 'string' ? message.slug : '',
          text: typeof message.text === 'string' ? message.text : '',
          level: typeof message.level === 'number' ? message.level : undefined,
          hasExplicitId: Boolean(message.hasExplicitId),
          markupLanguage:
            typeof message.markupLanguage === 'number' ? message.markupLanguage : undefined,
        });
      }
    });

    await subscribePreferenceChanges(joplin.settings, (preferences) => {
      pushPreferences(preferences);
    });

    await joplin.workspace.onNoteSelectionChange(() => {
      void syncController.syncNow({ force: false });
    });

    await joplin.workspace.onNoteChange(() => {
      syncController.scheduleSync();
    });

    if (typeof joplin.workspace.onSyncComplete === 'function') {
      await joplin.workspace.onSyncComplete(() => {
        syncController.scheduleSync();
      });
    }

    await registerToggleControls({
      joplinApi: joplin,
      panel,
      isMobile,
      onPanelShown: async () => {
        const preferences = await readOutlinePreferences(joplin.settings);
        pushPreferences(preferences);
        await syncController.syncNow({ force: true });
      },
    });
  },
});
