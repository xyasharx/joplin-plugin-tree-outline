import joplin from 'api';
import { parseHeadings, isTextRtl } from './parser';

const panelHtml = `
<div class="outline-container" id="outline-container" dir="auto">
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

    let currentNoteId = '';
    let lastNoteBody = '';

    const getFreshNoteData = async () => {
      try {
        const selected = await joplin.workspace.selectedNote();
        if (!selected || !selected.id) return null;

        // Fetch fresh note body directly from database
        const note = await joplin.data.get(['notes', selected.id], {
          fields: ['id', 'title', 'body'],
        });
        return note || null;
      } catch (err) {
        return null;
      }
    };

    const updateOutline = async (force = false) => {
      const note = await getFreshNoteData();
      if (!note) {
        if (currentNoteId !== '') {
          currentNoteId = '';
          lastNoteBody = '';
          await joplin.views.panels.postMessage(panel, {
            type: 'setHeadings',
            headings: [],
            isRtl: false,
            noteId: '',
          });
        }
        return;
      }

      const body = note.body || '';
      if (!force && note.id === currentNoteId && body === lastNoteBody) {
        return;
      }

      currentNoteId = note.id;
      lastNoteBody = body;

      const headings = parseHeadings(body);
      const isRtl = isTextRtl((note.title || '') + ' ' + body.slice(0, 1500));

      await joplin.views.panels.postMessage(panel, {
        type: 'setHeadings',
        headings,
        isRtl,
        noteId: note.id,
      });
    };

    // Webview message listener
    await joplin.views.panels.onMessage(panel, async (message: any) => {
      if (message.type === 'getHeadings') {
        const note = await getFreshNoteData();
        if (!note) return { headings: [], isRtl: false };
        currentNoteId = note.id;
        lastNoteBody = note.body || '';
        return {
          headings: parseHeadings(note.body || ''),
          isRtl: isTextRtl((note.title || '') + ' ' + (note.body || '').slice(0, 1500)),
        };
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
        } catch (e) {}

        try {
          await joplin.commands.execute('scrollToHash', message.slug);
        } catch (e) {}
      }
    });

    // Listen to selection changes and edits
    await joplin.workspace.onNoteSelectionChange(async () => {
      await updateOutline(true);
    });

    await joplin.workspace.onNoteChange(async () => {
      await updateOutline(false);
    });

    // Safety watchdog: catches note switches if Joplin's event drops during rapid clicking
    setInterval(async () => {
      const selected = await joplin.workspace.selectedNote();
      if (selected && selected.id !== currentNoteId) {
        await updateOutline(true);
      }
    }, 1200);

    // Initial triggers
    setTimeout(() => updateOutline(true), 250);
    setTimeout(() => updateOutline(true), 1000);

    // Command to toggle the panel
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
