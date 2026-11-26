import joplin from 'api';
import {
  copyHeadingLinkToClipboard,
  insertMarkdownTocIntoNote,
} from './headingActions';
import { jumpToHeading, registerCodeMirrorScroller } from './navigation';
import { createOutlineSyncController } from './outlineSync';
import {
  createScrollSpyController,
  registerViewerScrollSpy,
} from './scrollSpy';
import {
  DEFAULT_OUTLINE_PREFERENCES,
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
  ToastNotificationMessage,
  WebviewToPluginMessage,
} from './webview/protocol';

export const INSERT_TOC_COMMAND = 'treeOutline.insertToc';

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
    await registerViewerScrollSpy(joplin);
    await registerPluginSettings(joplin);

    let currentPreferences: OutlinePreferences = await readOutlinePreferences(joplin.settings);

    const pushPreferences = (preferences: OutlinePreferences): void => {
      currentPreferences = preferences;
      if (typeof joplin.views.panels.postMessage !== 'function') return;
      const msg: PreferencesUpdateMessage = {
        type: 'preferencesUpdate',
        preferences,
      };
      joplin.views.panels.postMessage(panel, msg);
    };

    const pushToast = (message: string, kind: 'info' | 'success' | 'error' = 'info'): void => {
      if (!message || typeof joplin.views.panels.postMessage !== 'function') return;
      const msg: ToastNotificationMessage = {
        type: 'toast',
        message,
        kind,
      };
      joplin.views.panels.postMessage(panel, msg);
    };

    let scrollSpy: ReturnType<typeof createScrollSpyController> | null = null;

    const syncController = createOutlineSyncController({
      joplinApi: joplin,
      panel,
      isMobile,
      onNoteChanged: (noteId) => {
        scrollSpy?.resetForNote(noteId);
      },
    });

    scrollSpy = createScrollSpyController({
      joplinApi: joplin,
      panel,
      getSnapshot: () => syncController.getCurrentSnapshot(),
      getPreferences: () => currentPreferences,
    });
    await scrollSpy.registerListeners();

    const executeInsertToc = async (): Promise<void> => {
      const snapshot = syncController.getCurrentSnapshot();
      const result = await insertMarkdownTocIntoNote(joplin, snapshot.headings, {
        maxDepth: currentPreferences.maxHeadingDepth,
        numbered: currentPreferences.showHeadingNumbers,
      });
      pushToast(result.message, result.kind);
    };

    try {
      await joplin.commands.register({
        name: INSERT_TOC_COMMAND,
        label: 'TreeOutline: Insert Table of Contents',
        iconName: 'fas fa-list-ol',
        execute: executeInsertToc,
      });
    } catch {
      // Do not fail plugin startup if command registration fails.
    }

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
          const savedMode = await persistTextWrapMode(joplin.settings, message.textWrapMode);
          currentPreferences = { ...currentPreferences, textWrapMode: savedMode };
        }
        return;
      }

      if (message.type === 'requestSync') {
        await syncController.syncNow({ force: Boolean(message.force) });
        return;
      }

      if (message.type === 'jumpToHeading') {
        scrollSpy?.suppressTemporarily(600);
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
        return;
      }

      if (message.type === 'copyHeadingLink') {
        const snapshot = syncController.getCurrentSnapshot();
        const result = await copyHeadingLinkToClipboard(joplin, {
          noteId: snapshot.noteId,
          format: message.format === 'slug' ? 'slug' : 'markdown',
          slug: typeof message.slug === 'string' ? message.slug : '',
          text: typeof message.text === 'string' ? message.text : '',
        });
        pushToast(result.message, result.kind);
        return;
      }

      if (message.type === 'insertToc') {
        await executeInsertToc();
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
        const preferences =
          (await readOutlinePreferences(joplin.settings)) ?? { ...DEFAULT_OUTLINE_PREFERENCES };
        pushPreferences(preferences);
        await syncController.syncNow({ force: true });
      },
    });
  },
});
