import {
  ContentScriptType,
  MarkupLanguage,
  type JoplinApi,
} from 'api/types';
import {
  AUTO_DISMISS_MOBILE_SETTING_KEY,
  SETTINGS_SECTION_NAME,
  registerPluginSettings,
  shouldAutoDismissOnMobile,
} from './settings';

export const CODEMIRROR_SCROLLER_SCRIPT_ID = 'treeOutlineCodeMirrorScroller';
export const CODEMIRROR_SCROLLER_SCRIPT_PATH = './contentScripts/codeMirrorScroller.js';
export const SCROLL_TO_LINE_COMMAND = 'treeOutline.scrollToLine';

export { AUTO_DISMISS_MOBILE_SETTING_KEY, SETTINGS_SECTION_NAME };

export interface JumpToHeadingOptions {
  joplinApi: Pick<JoplinApi, 'commands' | 'settings'>;
  isMobile: boolean;
  line: number;
  slug: string;
  text?: string;
  level?: number;
  hasExplicitId?: boolean;
  markupLanguage?: number;
}

/**
 * Registers the native CodeMirror 6 (with CM5 compatibility) scrolling content script
 * so Markdown editor jumps work by exact line number on Desktop 3.x and Mobile.
 */
export async function registerCodeMirrorScroller(
  joplinApi: Pick<JoplinApi, 'contentScripts'>,
): Promise<void> {
  if (!joplinApi.contentScripts?.register) return;
  try {
    await joplinApi.contentScripts.register(
      ContentScriptType.CodeMirrorPlugin,
      CODEMIRROR_SCROLLER_SCRIPT_ID,
      CODEMIRROR_SCROLLER_SCRIPT_PATH,
    );
  } catch {
    // Graceful degradation on environments without contentScripts support.
  }
}

/**
 * Registers user-facing TreeOutline settings (delegates to centralized settings module).
 */
export async function registerNavigationSettings(
  joplinApi: Pick<JoplinApi, 'settings'>,
): Promise<void> {
  await registerPluginSettings(joplinApi);
}

/**
 * Reads desktop editor view state via modern joplin.settings.globalValues()
 * (falling back to globalValue() for Joplin < 2.14).
 */
async function readDesktopEditorViewState(
  settings: JoplinApi['settings'],
): Promise<{ isMarkdown: boolean; visiblePanes: string[] }> {
  let codeView: unknown;
  let panes: unknown;

  try {
    if (typeof settings.globalValues === 'function') {
      const results = await settings.globalValues(['editor.codeView', 'noteVisiblePanes']);
      codeView = results?.[0];
      panes = results?.[1];
    } else {
      [codeView, panes] = await Promise.all([
        settings.globalValue('editor.codeView').catch(() => undefined),
        settings.globalValue('noteVisiblePanes').catch(() => undefined),
      ]);
    }
  } catch {
    // Fall back to safe defaults below.
  }

  return {
    isMarkdown: typeof codeView === 'boolean' ? codeView : true,
    visiblePanes: Array.isArray(panes) ? panes : ['viewer'],
  };
}

async function scrollCodeMirrorToLine(
  commands: JoplinApi['commands'],
  line: number,
  allowCm5Fallback: boolean,
): Promise<boolean> {
  const safeLine =
    typeof line === 'number' && Number.isFinite(line) ? Math.max(0, Math.floor(line)) : 0;

  try {
    const handled = await commands.execute('editor.execCommand', {
      name: SCROLL_TO_LINE_COMMAND,
      args: [safeLine],
    });
    if (handled === true) {
      return true;
    }
  } catch {
    // Content script command may be unavailable (e.g. editor not mounted or legacy CM5).
  }

  if (!allowCm5Fallback) {
    return false;
  }

  // Graceful fallback for Joplin < 3.0 (CodeMirror 5) or if content script hasn't loaded yet.
  try {
    await commands.execute('editor.execCommand', {
      name: 'setCursor',
      args: [{ line: safeLine, ch: 0 }],
    });
    await commands.execute('editor.execCommand', {
      name: 'scrollIntoView',
      args: [{ line: safeLine, ch: 0 }, 150],
    });
    return true;
  } catch {
    return false;
  }
}

async function scrollViewerToHash(
  commands: JoplinApi['commands'],
  slug: string,
): Promise<boolean> {
  if (!slug) return false;
  try {
    await commands.execute('scrollToHash', slug);
    return true;
  } catch {
    return false;
  }
}

async function scrollRichTextToHeading(
  commands: JoplinApi['commands'],
  {
    slug,
    text,
    level,
    hasExplicitId,
    markupLanguage,
  }: Pick<JumpToHeadingOptions, 'slug' | 'text' | 'level' | 'hasExplicitId' | 'markupLanguage'>,
): Promise<void> {
  const isHtmlWithoutId = markupLanguage === MarkupLanguage.Html && !hasExplicitId;

  // For HTML notes whose headings lack an explicit id="..." attribute, TinyMCE's
  // scrollToHash(getElementById) cannot find an anchor; use Joplin's built-in
  // editor.scrollToText command (supported for h1-h5 in TinyMCE.tsx).
  if (isHtmlWithoutId && text && typeof level === 'number' && level >= 1 && level <= 5) {
    try {
      await commands.execute('editor.scrollToText', {
        text,
        element: `h${level}`,
        scrollStrategy: 'start',
      });
      return;
    } catch {
      // Fall through to scrollToHash below.
    }
  }

  if (slug) {
    await scrollViewerToHash(commands, slug);
  }
}

/**
 * Navigates to the clicked heading across all Joplin modes:
 * - Desktop Markdown (Editor-only, Viewer-only, Split View) with CM6 native scroll + CM5 fallback
 * - Desktop Rich Text Editor (TinyMCE, editor.codeView === false)
 * - Mobile (Edit mode CM6 + Read/Viewer mode scrollToHash + dismissPluginPanels)
 */
export async function jumpToHeading({
  joplinApi,
  isMobile,
  line,
  slug,
  text,
  level,
  hasExplicitId,
  markupLanguage,
}: JumpToHeadingOptions): Promise<void> {
  if (isMobile) {
    // In Mobile Edit mode, the CM6 editor is mounted and handles treeOutline.scrollToLine
    // accurately (including duplicate headings) without leaving edit mode.
    const scrolledMobileEditor = await scrollCodeMirrorToLine(joplinApi.commands, line, false);

    // In Mobile Read/Viewer mode (or if CM6 editor isn't mounted), use scrollToHash.
    if (!scrolledMobileEditor && slug) {
      await scrollViewerToHash(joplinApi.commands, slug);
    }

    if (await shouldAutoDismissOnMobile(joplinApi.settings)) {
      try {
        await joplinApi.commands.execute('dismissPluginPanels');
      } catch {
        // Older mobile versions without dismissPluginPanels fail silently.
      }
    }
    return;
  }

  const { isMarkdown, visiblePanes } = await readDesktopEditorViewState(joplinApi.settings);

  // Desktop Rich Text Editor (WYSIWYG / TinyMCE): always navigate via TinyMCE-compatible commands,
  // regardless of noteVisiblePanes (which may still be ['editor'] from Markdown mode).
  if (!isMarkdown) {
    await scrollRichTextToHeading(joplinApi.commands, {
      slug,
      text,
      level,
      hasExplicitId,
      markupLanguage,
    });
    return;
  }

  // Desktop Markdown mode
  const viewerVisible = visiblePanes.includes('viewer');
  const editorVisible = visiblePanes.includes('editor');

  // 1. Viewer navigation (Viewer-only or Split View)
  if (viewerVisible && slug) {
    await scrollViewerToHash(joplinApi.commands, slug);
  }

  // 2. Editor navigation (Editor-only or Split View):
  //    Uses exact line targeting via CM6 content script (fixes duplicate heading bug #13892)
  //    and falls back to CM5 setCursor/scrollIntoView on Joplin < 3.0.
  if (editorVisible) {
    await scrollCodeMirrorToLine(joplinApi.commands, line, true);
  }
}
