import type {
  CodeMirrorControl,
  ContentScriptContext,
  MarkdownEditorContentScriptModule,
} from 'api/types';

const SCROLL_TO_LINE_COMMAND = 'treeOutline.scrollToLine';

interface CodeMirror6ViewModule {
  EditorView?: {
    scrollIntoView?: (pos: number, options?: { y?: 'nearest' | 'start' | 'end' | 'center' }) => unknown;
  };
}

interface CodeMirror6StateModule {
  EditorSelection?: {
    cursor?: (pos: number) => unknown;
  };
}

function loadCodeMirror6Modules(): {
  EditorView: CodeMirror6ViewModule['EditorView'] | null;
  EditorSelection: CodeMirror6StateModule['EditorSelection'] | null;
} {
  try {
    // Compiled as CommonJS externals so Joplin's PluginLoader resolves these to
    // its single runtime @codemirror/view and @codemirror/state instances (Desktop & Mobile).
    // Loaded lazily inside the CM6 guard so legacy Joplin CodeMirror 5 never throws.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const viewMod: CodeMirror6ViewModule = require('@codemirror/view');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const stateMod: CodeMirror6StateModule = require('@codemirror/state');
    return {
      EditorView: viewMod?.EditorView ?? null,
      EditorSelection: stateMod?.EditorSelection ?? null,
    };
  } catch {
    return { EditorView: null, EditorSelection: null };
  }
}

export default (_context: ContentScriptContext): MarkdownEditorContentScriptModule => {
  return {
    plugin: (editorControl: CodeMirrorControl) => {
      // 1. CodeMirror 6 path (Joplin Desktop 3.x & Joplin Mobile)
      if (editorControl?.editor && typeof editorControl.registerCommand === 'function') {
        const { EditorView, EditorSelection } = loadCodeMirror6Modules();

        editorControl.registerCommand(SCROLL_TO_LINE_COMMAND, (lineZeroBased: number) => {
          const view = editorControl.editor;
          const doc = view?.state?.doc;
          if (!doc || typeof doc.line !== 'function' || doc.lines <= 0) {
            return false;
          }

          const normalizedZeroBased =
            typeof lineZeroBased === 'number' && Number.isFinite(lineZeroBased)
              ? Math.floor(lineZeroBased)
              : 0;

          // CodeMirror 6 lines are 1-based; parser heading lines are 0-based.
          const targetLineNumber = Math.min(Math.max(1, normalizedZeroBased + 1), doc.lines);
          const lineInfo = doc.line(targetLineNumber);
          const pos: number = lineInfo.from;

          const selection =
            EditorSelection && typeof EditorSelection.cursor === 'function'
              ? EditorSelection.cursor(pos)
              : { anchor: pos };

          if (EditorView && typeof EditorView.scrollIntoView === 'function') {
            view.dispatch({
              selection,
              effects: EditorView.scrollIntoView(pos, { y: 'start' }),
            });
          } else {
            view.dispatch({
              selection,
              scrollIntoView: true,
            });
          }

          return true;
        });

        return;
      }

      // 2. Legacy CodeMirror 5 path (Joplin Desktop < 3.0)
      if (typeof editorControl?.defineExtension === 'function') {
        editorControl.defineExtension(
          SCROLL_TO_LINE_COMMAND,
          function (this: any, lineZeroBased: number) {
            const targetLine =
              typeof lineZeroBased === 'number' && Number.isFinite(lineZeroBased)
                ? Math.max(0, Math.floor(lineZeroBased))
                : 0;
            if (typeof this?.setCursor === 'function') {
              this.setCursor({ line: targetLine, ch: 0 });
            }
            if (typeof this?.scrollIntoView === 'function') {
              this.scrollIntoView({ line: targetLine, ch: 0 }, 150);
            }
            return true;
          },
        );
      }
    },
  };
};
