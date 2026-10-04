import joplin from 'api';
import { parseHeadings } from './parser';
import * as path from 'path';

joplin.plugins.register({
  onStart: async function () {
    const panel = await joplin.views.panels.create('obsidian_outline_panel');
    await joplin.views.panels.addScript(panel, './webview/outline.css');
    await joplin.views.panels.addScript(panel, './webview/outline.js');

    const updateOutline = async () => {
      const note = await joplin.workspace.selectedNote();
      if (!note || !note.body) {
        await joplin.views.panels.postMessage(panel, { type: 'setHeadings', headings: [] });
        return;
      }
      const headings = parseHeadings(note.body);
      await joplin.views.panels.postMessage(panel, { type: 'setHeadings', headings });
    };

    // Load HTML layout into panel
    const fs = joplin.require('fs-extra');
    const htmlPath = path.join(await joplin.plugins.installationFolder(), 'webview/outline.html');
    const htmlContent = await fs.readFile(htmlPath, 'utf8');
    await joplin.views.panels.setHtml(panel, htmlContent);

    // Listen to note switches and keystrokes
    await joplin.workspace.onNoteSelectionChange(updateOutline);
    await joplin.workspace.onNoteChange(updateOutline);

    // Handle messages from Webview
    await joplin.views.panels.onMessage(panel, async (message) => {
      if (message.type === 'jumpToHeading') {
        // 1. Scroll CodeMirror Editor to line
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

        // 2. Scroll Markdown Rendered Preview
        try {
          await joplin.commands.execute('scrollToHash', message.slug);
        } catch (e) {
          // In case preview pane is closed
        }
      }
    });

    // Initial run
    await updateOutline();
  },
});
