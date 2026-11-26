import { MarkupLanguage, type JoplinApi, type ViewHandle } from 'api/types';
import { computeHeadingSignature, isTextRtl, parseNoteHeadings } from './parser';
import type { NoteSelectionKind, OutlineUpdateMessage } from './webview/protocol';

export interface OutlineSyncControllerOptions {
  joplinApi: Pick<JoplinApi, 'workspace' | 'data' | 'views'>;
  panel: ViewHandle;
  isMobile: boolean;
  debounceMs?: number;
}

export interface OutlineSyncController {
  syncNow: (options?: { force?: boolean }) => Promise<boolean>;
  scheduleSync: () => void;
  handleWebviewReady: () => Promise<boolean>;
  dispose: () => void;
}

interface LoadedNoteState {
  selectionKind: NoteSelectionKind;
  noteId: string;
  title: string;
  body: string;
  markupLanguage: number;
}

function sampleBodyForRtlDetection(body: string, markupLanguage: number): string {
  const sample = body.slice(0, 2000);
  if (markupLanguage === MarkupLanguage.Html) {
    return sample.replace(/<[^>]*>/g, ' ');
  }
  return sample;
}

/**
 * Push-based, event-driven outline synchronizer:
 * - Zero continuous polling (no idle SQLite Note.load calls).
 * - Fixes empty-note double DB fetch (`typeof note.body !== 'string'`).
 * - Diffs heading structure signatures so paragraph edits do not trigger DOM rebuilds,
 *   while same-length heading edits are always detected.
 * - Guards against async out-of-order race conditions via a monotonic version counter.
 */
export function createOutlineSyncController({
  joplinApi,
  panel,
  isMobile,
  debounceMs = 200,
}: OutlineSyncControllerOptions): OutlineSyncController {
  let lastNoteId = '';
  let lastHeadingSignature = '';
  let lastIsRtl = false;
  let lastSelectionKind: NoteSelectionKind = 'none';
  let hasPushedOnce = false;
  let syncVersion = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const clearPendingDebounce = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const loadSelectedNoteState = async (): Promise<LoadedNoteState> => {
    try {
      if (typeof joplinApi.workspace.selectedNoteIds === 'function') {
        const selectedIds = await joplinApi.workspace.selectedNoteIds();
        if (Array.isArray(selectedIds)) {
          if (selectedIds.length === 0) {
            return {
              selectionKind: 'none',
              noteId: '',
              title: '',
              body: '',
              markupLanguage: MarkupLanguage.Markdown,
            };
          }
          if (selectedIds.length > 1) {
            return {
              selectionKind: 'multiple',
              noteId: '',
              title: '',
              body: '',
              markupLanguage: MarkupLanguage.Markdown,
            };
          }
        }
      }

      const note = await joplinApi.workspace.selectedNote();
      if (!note || !note.id) {
        return {
          selectionKind: 'none',
          noteId: '',
          title: '',
          body: '',
          markupLanguage: MarkupLanguage.Markdown,
        };
      }

      let title = typeof note.title === 'string' ? note.title : '';
      let body = typeof note.body === 'string' ? note.body : '';
      let markupLanguage =
        typeof note.markup_language === 'number'
          ? note.markup_language
          : MarkupLanguage.Markdown;

      // Only fall back to joplin.data.get() when body is actually missing (not when empty string "")
      if (typeof note.body !== 'string') {
        try {
          const fullNote = await joplinApi.data.get(['notes', note.id], {
            fields: ['id', 'title', 'body', 'markup_language'],
          });
          if (fullNote) {
            body = typeof fullNote.body === 'string' ? fullNote.body : '';
            title = typeof fullNote.title === 'string' ? fullNote.title : title;
            if (typeof fullNote.markup_language === 'number') {
              markupLanguage = fullNote.markup_language;
            }
          }
        } catch {
          // Proceed with available metadata.
        }
      }

      return {
        selectionKind: 'single',
        noteId: note.id,
        title,
        body,
        markupLanguage,
      };
    } catch {
      return {
        selectionKind: 'none',
        noteId: '',
        title: '',
        body: '',
        markupLanguage: MarkupLanguage.Markdown,
      };
    }
  };

  const syncNow = async ({ force = false }: { force?: boolean } = {}): Promise<boolean> => {
    clearPendingDebounce();
    const version = ++syncVersion;

    const state = await loadSelectedNoteState();

    // Discard stale async response if a newer sync started while awaiting DB/IPC
    if (version !== syncVersion) {
      return false;
    }

    const headings =
      state.selectionKind === 'single'
        ? parseNoteHeadings(state.body, state.markupLanguage)
        : [];
    const signature = computeHeadingSignature(headings);
    const isRtl =
      state.selectionKind === 'single'
        ? isTextRtl(
            `${state.title} ${sampleBodyForRtlDetection(state.body, state.markupLanguage)}`,
          )
        : false;

    const noteChanged =
      !hasPushedOnce ||
      state.noteId !== lastNoteId ||
      state.selectionKind !== lastSelectionKind;

    const structureChanged = signature !== lastHeadingSignature || isRtl !== lastIsRtl;

    if (!force && !noteChanged && !structureChanged) {
      return false;
    }

    lastNoteId = state.noteId;
    lastHeadingSignature = signature;
    lastIsRtl = isRtl;
    lastSelectionKind = state.selectionKind;
    hasPushedOnce = true;

    const message: OutlineUpdateMessage = {
      type: 'outlineUpdate',
      version,
      noteId: state.noteId,
      noteChanged,
      selectionKind: state.selectionKind,
      markupLanguage: state.markupLanguage,
      headings,
      isRtl,
      isMobile,
    };

    try {
      await joplinApi.views.panels.postMessage(panel, message);
      return true;
    } catch {
      return false;
    }
  };

  const scheduleSync = () => {
    clearPendingDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void syncNow({ force: false });
    }, debounceMs);
  };

  const handleWebviewReady = () => syncNow({ force: true });

  const dispose = () => {
    clearPendingDebounce();
  };

  return {
    syncNow,
    scheduleSync,
    handleWebviewReady,
    dispose,
  };
}
