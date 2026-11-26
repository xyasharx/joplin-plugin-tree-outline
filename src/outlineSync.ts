import { MarkupLanguage, type JoplinApi, type ViewHandle } from 'api/types';
import { computeHeadingSignature, isTextRtl, parseNoteHeadings } from './parser';
import type {
  HeadingNode,
  NoteSelectionKind,
  OutlineUpdateMessage,
} from './webview/protocol';

export interface OutlineSnapshot {
  noteId: string;
  selectionKind: NoteSelectionKind;
  selectedCount: number;
  markupLanguage: number;
  headings: HeadingNode[];
}

export interface OutlineSyncControllerOptions {
  joplinApi: Pick<JoplinApi, 'workspace' | 'data' | 'views'>;
  panel: ViewHandle;
  isMobile: boolean;
  debounceMs?: number;
  onNoteChanged?: (noteId: string) => void;
}

export interface OutlineSyncController {
  syncNow: (options?: { force?: boolean }) => Promise<boolean>;
  scheduleSync: () => void;
  handleWebviewReady: () => Promise<boolean>;
  getCurrentSnapshot: () => OutlineSnapshot;
  dispose: () => void;
}

interface LoadedNoteState {
  selectionKind: NoteSelectionKind;
  selectedCount: number;
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
 * - Distinguishes empty states (0 notes selected vs N > 1 multiple notes selected).
 * - Diffs heading structure signatures so paragraph edits do not trigger DOM rebuilds,
 *   while same-length heading edits are always detected.
 * - Guards against async out-of-order race conditions via a monotonic version counter.
 */
export function createOutlineSyncController({
  joplinApi,
  panel,
  isMobile,
  debounceMs = 200,
  onNoteChanged,
}: OutlineSyncControllerOptions): OutlineSyncController {
  let lastNoteId = '';
  let lastHeadingSignature = '';
  let lastIsRtl = false;
  let lastSelectionKind: NoteSelectionKind = 'none';
  let lastSelectedCount = 0;
  let lastMarkupLanguage: number = MarkupLanguage.Markdown;
  let lastHeadings: HeadingNode[] = [];
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
              selectedCount: 0,
              noteId: '',
              title: '',
              body: '',
              markupLanguage: MarkupLanguage.Markdown,
            };
          }
          if (selectedIds.length > 1) {
            return {
              selectionKind: 'multiple',
              selectedCount: selectedIds.length,
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
          selectedCount: 0,
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
        selectedCount: 1,
        noteId: note.id,
        title,
        body,
        markupLanguage,
      };
    } catch {
      return {
        selectionKind: 'none',
        selectedCount: 0,
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
      state.selectionKind !== lastSelectionKind ||
      state.selectedCount !== lastSelectedCount;

    const structureChanged = signature !== lastHeadingSignature || isRtl !== lastIsRtl;

    if (!force && !noteChanged && !structureChanged) {
      return false;
    }

    lastNoteId = state.noteId;
    lastHeadingSignature = signature;
    lastIsRtl = isRtl;
    lastSelectionKind = state.selectionKind;
    lastSelectedCount = state.selectedCount;
    lastMarkupLanguage = state.markupLanguage;
    lastHeadings = headings;
    hasPushedOnce = true;

    if (noteChanged) {
      onNoteChanged?.(state.noteId);
    }

    const message: OutlineUpdateMessage = {
      type: 'outlineUpdate',
      version,
      noteId: state.noteId,
      noteChanged,
      selectionKind: state.selectionKind,
      selectedCount: state.selectedCount,
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

  const getCurrentSnapshot = (): OutlineSnapshot => ({
    noteId: lastNoteId,
    selectionKind: lastSelectionKind,
    selectedCount: lastSelectedCount,
    markupLanguage: lastMarkupLanguage,
    headings: lastHeadings,
  });

  const dispose = () => {
    clearPendingDebounce();
  };

  return {
    syncNow,
    scheduleSync,
    handleWebviewReady,
    getCurrentSnapshot,
    dispose,
  };
}
