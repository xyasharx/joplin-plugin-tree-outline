import joplin from 'api';
import { parseHeadings } from './parser';

const panelHtml = `
<div class="outline-container">
  <div class="nav-header">
    <div class="nav-buttons-container">
      <div class="clickable-icon nav-action-button" id="search-toggle-btn" title="Filter headings">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
      </div>
      <div class="clickable-icon nav-action-button" id="collapse-all-btn" title="Collapse / Expand all">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7 11V7h4"></path>
          <path d="M11 7L4 14"></path>
          <path d="M17 13v4h-4"></path>
          <path d="M13 17l7-7"></path>
        </svg>
      </div>
    </div>
    <div class="search-input-container" id="search-container">
      <input type="text" id="search-input" placeholder="Filter headings..." autocomplete="off">
      <span class="search-clear-btn" id="search-clear-btn">&times;</span>
    </div>
  </div>
  <div class="outline-tree" id="outline-tree">
    <div class="outline-status">Select a note to view outline</div>
  </div>
</div>
`;

joplin.plugins.register({
  onStart: async function () {
    const panel = await joplin.views.panels.create('obsidian_outline_panel');
    await joplin.views.panels.setHtml(panel, panelHtml);
    await joplin.views.panels.addScript(panel, './webview/outline.css');
    await joplin.views.panels.addScript(panel, './webview/outline.js');

    const getNoteHeadings = async () => {
      try {
        const note = await joplin.workspace.selectedNote();
        if (!note || !note.body) return [];
        return parseHeadings(note.body);
      } catch (err) {
        console.error('[TreeOutline] getNoteHeadings error:', err);
        return [];
      }
    };

    const updateOutline = async () => {
      const headings = await getNoteHeadings();
      try {
        await joplin.views.panels.postMessage(panel, {
          type: 'setHeadings',
          headings: headings,
        });
      } catch (err) {
        // Ignored if webview is cycling
      }
    };

    // Responds to pull requests & navigation clicks from webview
    await joplin.views.panels.onMessage(panel, async (message: any) => {
      if (message.type === 'getHeadings') {
        const headings = await getNoteHeadings();
        return { headings };
      } else if (message.type === 'jumpToHeading') {
        try {
          await joplin.commands.execute('editor.execCommand', {
            name: 'scrollIntoView',
            args: [{ line: message.line, char: 0 }],
          });
          await joplin.commands.execute('editor.execCommand', {
            name: 'setCursor',
            args: [{ line: message.line, char: 0 }],
          });
        } catch (e) {
          // Viewer-only mode fallback
        }
        try {
          await joplin.commands.execute('scrollToHash', message.slug);
        } catch (e) {}
      }
    });

    // Event hooks
    await joplin.workspace.onNoteSelectionChange(updateOutline);
    await joplin.workspace.onNoteChange(updateOutline);

    // Initial triggers for app startup
    setTimeout(updateOutline, 250);
    setTimeout(updateOutline, 1000);

    // Register toggle command
    await joplin.commands.register({
      name: 'toggleTreeOutline',
      label: 'Toggle TreeOutline',
      iconName: 'fas fa-stream',
      execute: async () => {
        const isVisible = await joplin.views.panels.visible(panel);
        await joplin.views.panels.show(panel, !isVisible);
      },
    });

    await joplin.views.panels.show(panel, true);
  },
});
