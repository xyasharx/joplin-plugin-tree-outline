import joplin from 'api';
import {
  jumpToHeading,
  registerCodeMirrorScroller,
  registerNavigationSettings,
} from './navigation';
import { createOutlineSyncController } from './outlineSync';
import { registerToggleControls } from './toggleControls';
import type { WebviewToPluginMessage } from './webview/protocol';

const panelHtml = `
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<div class="outline-container" id="outline-container" dir="auto">
  <div class="nav-header">
    <div class="nav-buttons-container">
      <div class="clickable-icon nav-action-button" id="search-toggle-btn" role="button" tabindex="0" aria-label="Filter headings" aria-pressed="false" title="Filter headings">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      </div>
      <div class="clickable-icon nav-action-button" id="wrap-toggle-btn" role="button" tabindex="0" aria-label="Toggle text wrap" aria-pressed="false" title="Toggle text wrap">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="12" x2="15" y2="12"></line>
          <polyline points="16 10 19 12 16 14"></polyline>
          <path d="M19 12h-4a3 3 0 0 0-3 3v1"></path>
          <line x1="3" y1="18" x2="10" y2="18"></line>
        </svg>
      </div>
      <div class="clickable-icon nav-action-button" id="collapse-all-btn" role="button" tabindex="0" aria-label="Collapse all sections" aria-pressed="false" title="Collapse all sections">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="4 14 10 14 10 20"></polyline>
          <polyline points="20 10 14 10 14 4"></polyline>
          <line x1="14" y1="10" x2="21" y2="3"></line>
          <line x1="3" y1="21" x2="10" y2="14"></line>
        </svg>
      </div>
    </div>
    <div class="search-input-container" id="search-container">
      <input type="text" id="search-input" placeholder="Filter headings..." aria-label="Filter headings" autocomplete="off">
      <span class="search-clear-btn" id="search-clear-btn" role="button" tabindex="0" aria-label="Clear filter" title="Clear filter">&times;</span>
    </div>
  </div>
  <div class="outline-tree" id="outline-tree" role="tree" aria-label="Note outline">
    <div class="outline-status">Select a note to view outline</div>
  </div>
</div>
`;

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
    await registerNavigationSettings(joplin);

    const syncController = createOutlineSyncController({
      joplinApi: joplin,
      panel,
      isMobile,
    });

    await joplin.views.panels.onMessage(panel, async (message: WebviewToPluginMessage) => {
      if (!message || typeof message !== 'object') return;

      if (message.type === 'ready') {
        await syncController.handleWebviewReady();
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
        await syncController.syncNow({ force: true });
      },
    });
  },
});
