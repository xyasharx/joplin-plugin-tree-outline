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

    let activeNoteId = '';
    let activeNoteBody = '';

    const getNote = async () => {
      try {
        const note = await joplin.workspace.selectedNote();
        if (!note || !note.id) return null;
        if (typeof note.body === 'string') return note;

        // Fallback if shallow note is returned
        const fullNote = await joplin.data.get(['notes', note.id], {
          fields: ['id', 'title', 'body'],
        });
        return fullNote || note;
      } catch (e) {
        return null;
      }
    };

    const pushOutlineUpdate = async () => {
      const note = await getNote();
      if (!note) {
        if (activeNoteId !== '') {
          activeNoteId = '';
          activeNoteBody = '';
          try {
            await joplin.views.panels.postMessage(panel, {
              type: 'setHeadings',
              headings: [],
              isRtl: false,
              noteId: '',
            });
          }
