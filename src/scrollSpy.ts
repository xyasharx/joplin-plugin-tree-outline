import { ContentScriptType, type JoplinApi, type ViewHandle } from 'api/types';
import {
  resolveActiveHeadingKeyByLine,
  resolveActiveHeadingKeyBySlug,
} from './headingActions';
import { CODEMIRROR_SCROLLER_SCRIPT_ID } from './navigation';
import type { OutlineSnapshot } from './outlineSync';
import type { ActiveHeadingUpdateMessage, OutlinePreferences } from './webview/protocol';

export const VIEWER_SCROLL_SPY_SCRIPT_ID = 'treeOutlineViewerScrollSpy';
export const VIEWER_SCROLL_SPY_SCRIPT_PATH = './contentScripts/viewerScrollSpyPlugin.js';

export interface ScrollSpyControllerOptions {
  joplinApi: Pick<JoplinApi, 'contentScripts' | 'views'>;
  panel: ViewHandle;
  getSnapshot: () => OutlineSnapshot;
  getPreferences: () => OutlinePreferences;
}

export interface ScrollSpyController {
  registerListeners: () => Promise<void>;
  suppressTemporarily: (durationMs?: number) => void;
  notifyManualJump: (noteId: string, headingKey: string | null, durationMs?: number) => void;
  resetForNote: (noteId: string) => void;
  resetActiveTracking: () => void;
}

/**
 * Registers the no-op Markdown-It content script that loads the throttled
 * viewer scroll-spy asset inside Joplin's rendered Markdown viewer.
 */
export async function registerViewerScrollSpy(
  joplinApi: Pick<JoplinApi, 'contentScripts'>,
): Promise<void> {
  if (!joplinApi.contentScripts?.register) return;
  try {
    await joplinApi.contentScripts.register(
      ContentScriptType.MarkdownItPlugin,
      VIEWER_SCROLL_SPY_SCRIPT_ID,
      VIEWER_SCROLL_SPY_SCRIPT_PATH,
    );
  } catch {
    // Graceful degradation on environments without contentScripts support.
  }
}

/**
 * Coordinates throttled editor (CM6) and Markdown viewer scroll-spy events,
 * mapping active lines/slugs against the current outline snapshot and pushing
 * deduplicated `activeHeadingUpdate` messages to the outline panel.
 */
export function createScrollSpyController({
  joplinApi,
  panel,
  getSnapshot,
  getPreferences,
}: ScrollSpyControllerOptions): ScrollSpyController {
  let lastNoteId = '';
  let lastPushedHeadingKey: string | null = null;
  let suppressedUntil = 0;

  const suppressTemporarily = (durationMs = 600): void => {
    suppressedUntil = Date.now() + Math.max(0, durationMs);
  };

  const notifyManualJump = (
    noteId: string,
    headingKey: string | null,
    durationMs = 600,
  ): void => {
    if (noteId) {
      lastNoteId = noteId;
    }
    if (headingKey) {
      lastPushedHeadingKey = headingKey;
    }
    suppressTemporarily(durationMs);
  };

  const resetForNote = (noteId: string): void => {
    lastNoteId = noteId;
    lastPushedHeadingKey = null;
  };

  const resetActiveTracking = (): void => {
    lastPushedHeadingKey = null;
  };

  const pushActiveHeading = async (noteId: string, headingKey: string | null): Promise<void> => {
    if (!noteId || !headingKey) return;
    if (noteId === lastNoteId && headingKey === lastPushedHeadingKey) return;

    lastNoteId = noteId;
    lastPushedHeadingKey = headingKey;

    if (typeof joplinApi.views.panels.postMessage !== 'function') return;
    const msg: ActiveHeadingUpdateMessage = {
      type: 'activeHeadingUpdate',
      noteId,
      headingKey,
    };
    try {
      await joplinApi.views.panels.postMessage(panel, msg);
    } catch {
      // Ignore panel IPC errors when panel is hidden or closing.
    }
  };

  const handleEditorMessage = async (message: unknown): Promise<void> => {
    if (!message || typeof message !== 'object') return;
    const payload = message as { type?: string; line?: number };
    if (payload.type !== 'editorActiveLine' || typeof payload.line !== 'number') return;
    if (Date.now() < suppressedUntil) return;

    const prefs = getPreferences();
    if (!prefs.followActiveHeading) return;

    const snapshot = getSnapshot();
    if (snapshot.selectionKind !== 'single' || !snapshot.noteId || snapshot.headings.length === 0) {
      return;
    }

    const activeKey = resolveActiveHeadingKeyByLine(
      snapshot.headings,
      payload.line,
      prefs.maxHeadingDepth,
    );
    await pushActiveHeading(snapshot.noteId, activeKey);
  };

  const handleViewerMessage = async (message: unknown): Promise<void> => {
    if (!message || typeof message !== 'object') return;
    const payload = message as { type?: string; slug?: string; index?: number };
    if (payload.type !== 'viewerActiveHeading') return;
    if (Date.now() < suppressedUntil) return;

    const prefs = getPreferences();
    if (!prefs.followActiveHeading) return;

    const snapshot = getSnapshot();
    if (snapshot.selectionKind !== 'single' || !snapshot.noteId || snapshot.headings.length === 0) {
      return;
    }

    const activeKey = resolveActiveHeadingKeyBySlug(
      snapshot.headings,
      typeof payload.slug === 'string' ? payload.slug : '',
      typeof payload.index === 'number' ? payload.index : undefined,
      prefs.maxHeadingDepth,
    );
    await pushActiveHeading(snapshot.noteId, activeKey);
  };

  const registerListeners = async (): Promise<void> => {
    if (typeof joplinApi.contentScripts?.onMessage !== 'function') return;
    try {
      await joplinApi.contentScripts.onMessage(CODEMIRROR_SCROLLER_SCRIPT_ID, handleEditorMessage);
      await joplinApi.contentScripts.onMessage(VIEWER_SCROLL_SPY_SCRIPT_ID, handleViewerMessage);
    } catch {
      // Graceful degradation if contentScripts.onMessage is unavailable.
    }
  };

  return {
    registerListeners,
    suppressTemporarily,
    notifyManualJump,
    resetForNote,
    resetActiveTracking,
  };
}
