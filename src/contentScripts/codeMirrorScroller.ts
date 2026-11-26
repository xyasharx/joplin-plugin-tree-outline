import type {
  CodeMirrorControl,
  ContentScriptContext,
  MarkdownEditorContentScriptModule,
} from 'api/types';

const SCROLL_TO_LINE_COMMAND = 'treeOutline.scrollToLine';
const SCROLL_SPY_THROTTLE_MS = 140;
const VIEWPORT_TOP_OFFSET_PX = 24;

interface CodeMirror6ViewModule {
  EditorView?: {
    scrollIntoView?: (
      pos: number,
      options?: { y?: 'nearest' | 'start' | 'end' | 'center' },
    ) => unknown;
    domEventHandlers?: (handlers: Record<string, (event: Event, view: any) => boolean | void>) => unknown;
  };
  ViewPlugin?: {
    fromClass?: (pluginClass: new (view: any) => { update?: (update: any) => void; destroy?: () => void }) => unknown;
  };
}

interface CodeMirror6StateModule {
  EditorSelection?: {
    cursor?: (pos: number) => unknown;
  };
}

function loadCodeMirror6Modules(): {
  EditorView: CodeMirror6ViewModule['EditorView'] | null;
  ViewPlugin: CodeMirror6ViewModule['ViewPlugin'] | null;
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
      ViewPlugin: viewMod?.ViewPlugin ?? null,
      EditorSelection: stateMod?.EditorSelection ?? null,
    };
  } catch {
    return { EditorView: null, ViewPlugin: null, EditorSelection: null };
  }
}

function resolveCursorZeroBasedLine(view: any): number | null {
  try {
    const doc = view?.state?.doc;
    const head = view?.state?.selection?.main?.head;
    if (!doc || typeof doc.lineAt !== 'function' || typeof head !== 'number') {
      return null;
    }
    const clampedPos = Math.min(Math.max(0, head), doc.length);
    return Math.max(0, doc.lineAt(clampedPos).number - 1);
  } catch {
    return null;
  }
}

function resolveViewportTopZeroBasedLine(view: any): number | null {
  try {
    const doc = view?.state?.doc;
    if (!doc || typeof doc.lineAt !== 'function') {
      return null;
    }

    if (typeof view.lineBlockAtHeight === 'function' && view.scrollDOM) {
      const scrollTop = typeof view.scrollDOM.scrollTop === 'number' ? view.scrollDOM.scrollTop : 0;
      const block = view.lineBlockAtHeight(Math.max(0, scrollTop + VIEWPORT_TOP_OFFSET_PX));
      if (block && typeof block.from === 'number') {
        const clampedPos = Math.min(Math.max(0, block.from), doc.length);
        return Math.max(0, doc.lineAt(clampedPos).number - 1);
      }
    }

    if (view.viewport && typeof view.viewport.from === 'number') {
      const clampedPos = Math.min(Math.max(0, view.viewport.from), doc.length);
      return Math.max(0, doc.lineAt(clampedPos).number - 1);
    }

    return resolveCursorZeroBasedLine(view);
  } catch {
    return null;
  }
}

function createCm6ScrollSpyExtensions(
  context: ContentScriptContext,
  EditorView: CodeMirror6ViewModule['EditorView'] | null,
  ViewPlugin: CodeMirror6ViewModule['ViewPlugin'] | null,
): unknown[] {
  if (typeof context?.postMessage !== 'function') {
    return [];
  }

  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSentLine = -1;
  let pendingLine: number | null = null;
  let pendingSource: 'selection' | 'scroll' = 'selection';

  const emitLine = (line: number, source: 'selection' | 'scroll'): void => {
    if (line === lastSentLine) return;
    lastSentLine = line;
    try {
      const result = context.postMessage({
        type: 'editorActiveLine',
        line,
        source,
      });
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch {
      // Never allow IPC failures to deregister CodeMirror extensions.
    }
  };

  const scheduleEmit = (line: number | null, source: 'selection' | 'scroll'): void => {
    if (line === null) return;
    pendingLine = line;
    pendingSource = source;

    if (throttleTimer !== null) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      if (pendingLine !== null) {
        const toSend = pendingLine;
        const src = pendingSource;
        pendingLine = null;
        emitLine(toSend, src);
      }
    }, SCROLL_SPY_THROTTLE_MS);
  };

  const extensions: unknown[] = [];

  if (ViewPlugin && typeof ViewPlugin.fromClass === 'function') {
    extensions.push(
      ViewPlugin.fromClass(
        class {
          constructor(view: any) {
            lastSentLine = -1;
            scheduleEmit(resolveCursorZeroBasedLine(view), 'selection');
          }

          update(update: any): void {
            try {
              if (update.docChanged) {
                // Joplin Desktop reuses the same CM6 EditorView across note switches;
                // reset lastSentLine so a new note starting at the same line (e.g. 0)
                // still reports its initial active section cleanly.
                lastSentLine = -1;
                scheduleEmit(resolveCursorZeroBasedLine(update.view), 'selection');
              } else if (update.selectionSet) {
                scheduleEmit(resolveCursorZeroBasedLine(update.view), 'selection');
              } else if (update.viewportChanged) {
                scheduleEmit(resolveViewportTopZeroBasedLine(update.view), 'scroll');
              }
            } catch {
              // Keep extension registered even on unexpected editor state.
            }
          }

          destroy(): void {
            if (throttleTimer !== null) {
              clearTimeout(throttleTimer);
              throttleTimer = null;
            }
          }
        },
      ),
    );
  }

  if (EditorView && typeof EditorView.domEventHandlers === 'function') {
    extensions.push(
      EditorView.domEventHandlers({
        scroll(_event: Event, view: any) {
          scheduleEmit(resolveViewportTopZeroBasedLine(view), 'scroll');
          return false;
        },
      }),
    );
  }

  return extensions;
}

export default (context: ContentScriptContext): MarkdownEditorContentScriptModule => {
  return {
    plugin: (editorControl: CodeMirrorControl) => {
      // 1. CodeMirror 6 path (Joplin Desktop 3.x & Joplin Mobile)
      if (editorControl?.editor && typeof editorControl.registerCommand === 'function') {
        const { EditorView, ViewPlugin, EditorSelection } = loadCodeMirror6Modules();

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

        // Register throttled active-heading scroll-spy extension
        if (typeof editorControl.addExtension === 'function') {
          const scrollSpyExtensions = createCm6ScrollSpyExtensions(context, EditorView, ViewPlugin);
          if (scrollSpyExtensions.length > 0) {
            try {
              editorControl.addExtension(scrollSpyExtensions);
            } catch {
              // Keep scrollToLine command working even if addExtension fails.
            }
          }
        }

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
