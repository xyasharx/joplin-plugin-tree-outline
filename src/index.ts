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
    
    // Set HTML snippet directly (no filesystem reads)
    await joplin.views.panels.setHtml(panel, panelHtml);
    await joplin.views.panels.addScript(panel, './webview/outline.css');
    await joplin.views.panels.addScript(panel, './webview/outline.js');

    const updateOutline = async () => {
      try {
        const note = await joplin.workspace.selectedNote();
        if (!note || !note.body) {
          await joplin.views.panels.postMessage(panel, { type: 'setHeadings', headings: [] });
          return;
        }
        const headings = parseHeadings(note.body);
        await joplin.views.panels.postMessage(panel, { type: 'setHeadings', headings });
      } catch (err) {
        console.error('Error updating outline:', err);
      }
    };

    // Communication handshake
    await joplin.views.panels.onMessage(panel, async (message: any) => {
      if (message.type === 'ready') {
        // Webview is now mounted and listening
        await updateOutline();
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
          console.warn('CodeMirror scroll error:', e);
        }
        try {
          await joplin.commands.execute('scrollToHash', message.slug);
        } catch (e) {}
      }
    });

    // Listen to note switches and edits
    await joplin.workspace.onNoteSelectionChange(updateOutline);
    await joplin.workspace.onNoteChange(updateOutline);

    // Register a command to toggle the panel
    await joplin.commands.register({
      name: 'toggleTreeOutline',
      label: 'Toggle TreeOutline',
      iconName: 'fas fa-stream',
      execute: async () => {
        const isVisible = await joplin.views.panels.visible(panel);
        await joplin.views.panels.show(panel, !isVisible);
      },
    });

    // Explicitly show the panel on start
    await joplin.views.panels.show(panel, true);
  },
});
