import joplin from 'api';
import { parseHeadings, isTextRtl } from './parser';

const panelHtml = `
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
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
    const panel = await joplin.views.panels.create('tree_outline_panel');
    await joplin.views.panels.setHtml(panel, panelHtml);
    await joplin.views.panels.addScript(panel, './webview/outline.css');
    await joplin.views.panels.addScript(panel, './webview/outline.js');

    let isMobile = false;
    try {
      const vInfo = await joplin.versionInfo();
      isMobile = (vInfo as any)?.platform === 'mobile';
    } catch (e) {}

    const getSelectedNoteData = async () => {
      try {
        const note = await joplin.workspace.selectedNote();
        if (!note || !note.id) return null;

        let body = typeof note.body === 'string' ? note.body : '';
        let title = typeof note.title === 'string' ? note.title : '';

        if (!body) {
          try {
            const fullNote = await joplin.data.get(['notes', note.id], {
              fields: ['id', 'title', 'body'],
            });
            if (fullNote) {
              body = fullNote.body || '';
              title = fullNote.title || title;
            }
          } catch (e) {}
        }

        return { id: note.id, title, body };
      } catch (err) {
        return null;
      }
    };

    const notifyWebviewToSync = async () => {
      try {
        await joplin.views.panels.postMessage(panel, { type: 'noteSwitched' });
      } catch (e) {}
    };

    await joplin.views.panels.onMessage(panel, async (message: any) => {
      if (message.type === 'pollNote') {
        const note = await getSelectedNoteData();

        if (!note) {
          const changed = message.clientNoteId !== '';
          return { changed, noteId: '', headings: [], isRtl: false, isMobile };
        }

        const idChanged = note.id !== message.clientNoteId;
        const lengthChanged = note.body.length !== message.clientBodyLength;
        const changed = message.force || idChanged || lengthChanged;

        if (changed) {
          return {
            changed: true,
            noteId: note.id,
            bodyLength: note.body.length,
            headings: parseHeadings(note.body),
            isRtl: isTextRtl(note.title + ' ' + note.body.slice(0, 1500)),
            isMobile,
          };
        }

        return { changed: false };
      } else if (message.type === 'jumpToHeading') {
        const line = typeof message.line === 'number' ? message.line : 0;
        const slug = message.slug || '';

        try {
          let isCodeView = false;
          try {
            isCodeView = await joplin.settings.globalValue('editor.codeView');
          } catch (e) {
            isCodeView = !isMobile;
          }

          if (isCodeView) {
            // Mode A: Markdown Editor (CodeMirror) or Split View
            await joplin.commands.execute('editor.focus');
            await joplin.commands.execute('editor.execCommand', {
              name: 'setCursor',
              args: [{ line: line, ch: 0 }],
            });
            await joplin.commands.execute('editor.execCommand', {
              name: 'scrollIntoView',
              args: [{ line: line, ch: 0 }, 150],
            });

            if (slug) {
              await joplin.commands.execute('scrollToHash', slug);
            }
          } else {
            // Mode B: Markdown Viewer (HTML Rendered Mode & Mobile)
            // Dispatches directly to scrollToHash without focus collisions
            if (slug) {
              await joplin.commands.execute('scrollToHash', slug);
            }
          }
        } catch (e) {
          if (slug) {
            try {
              await joplin.commands.execute('scrollToHash', slug);
            } catch (err) {}
          }
        }
      }
    });

    await joplin.workspace.onNoteSelectionChange(notifyWebviewToSync);
    await joplin.workspace.onNoteChange(notifyWebviewToSync);

    notifyWebviewToSync();

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
