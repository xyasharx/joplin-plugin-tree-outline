/**
 * Rendered Markdown Viewer scroll-spy runtime script.
 * Loaded by Joplin via `viewerScrollSpyPlugin.ts` `assets()`.
 * Safely no-ops inside TinyMCE Rich Text Editor where `webviewApi` is undefined.
 */

export {};

const VIEWER_SCROLL_SPY_SCRIPT_ID = 'treeOutlineViewerScrollSpy';
const SCROLL_THROTTLE_MS = 140;
const TOP_THRESHOLD_PX = 80;

interface ViewerWebviewApi {
  postMessage: (contentScriptId: string, message: unknown) => Promise<unknown> | void;
}

interface ViewerGlobalScope {
  webviewApi?: ViewerWebviewApi;
  __treeOutlineViewerScrollSpyInit?: boolean;
}

function resolveViewerWebviewApi(): ViewerWebviewApi | null {
  try {
    const scope = globalThis as unknown as ViewerGlobalScope;
    if (typeof scope.webviewApi?.postMessage === 'function') {
      return scope.webviewApi;
    }
  } catch {
    // webviewApi is intentionally absent in TinyMCE Rich Text Editor (Joplin #12108).
  }
  try {
    if (typeof window !== 'undefined') {
      const win = window as unknown as ViewerGlobalScope;
      if (typeof win.webviewApi?.postMessage === 'function') {
        return win.webviewApi;
      }
    }
  } catch {
    // Ignore restricted window access.
  }
  return null;
}

function getRenderedHeadings(): HTMLElement[] {
  const renderedRoot = document.getElementById('rendered-md');
  const scope: ParentNode = renderedRoot ?? document;
  const list = scope.querySelectorAll('h1, h2, h3, h4, h5, h6');
  return Array.from(list) as HTMLElement[];
}

function initViewerScrollSpy(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const win = window as unknown as ViewerGlobalScope;
  if (win.__treeOutlineViewerScrollSpyInit) return;

  const api = resolveViewerWebviewApi();
  if (!api) return;

  // Never attach inside TinyMCE body even if a future build injects webviewApi there
  if (document.body?.id === 'tinymce') return;

  win.__treeOutlineViewerScrollSpyInit = true;

  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastReportedKey = '';

  const reportActiveHeading = (): void => {
    const headings = getRenderedHeadings();
    if (headings.length === 0) return;

    let activeIndex = 0;
    for (let i = 0; i < headings.length; i++) {
      const rect = headings[i].getBoundingClientRect?.();
      if (!rect) continue;
      if (rect.top <= TOP_THRESHOLD_PX) {
        activeIndex = i;
      } else {
        break;
      }
    }

    const activeEl = headings[activeIndex];
    const slug = (activeEl.getAttribute('id') || activeEl.id || '').trim();
    const dedupeKey = `${slug}:${activeIndex}`;
    if (dedupeKey === lastReportedKey) return;
    lastReportedKey = dedupeKey;

    try {
      const res = api.postMessage(VIEWER_SCROLL_SPY_SCRIPT_ID, {
        type: 'viewerActiveHeading',
        slug,
        index: activeIndex,
      });
      if (res && typeof (res as Promise<unknown>).catch === 'function') {
        (res as Promise<unknown>).catch(() => {});
      }
    } catch {
      // Swallow transient IPC errors during note transitions.
    }
  };

  const scheduleReport = (): void => {
    if (throttleTimer !== null) return;
    throttleTimer = setTimeout(() => {
      throttleTimer = null;
      reportActiveHeading();
    }, SCROLL_THROTTLE_MS);
  };

  window.addEventListener('scroll', scheduleReport, { passive: true });
  document.addEventListener('scroll', scheduleReport, { passive: true, capture: true });
  window.addEventListener('resize', scheduleReport, { passive: true });
  document.addEventListener('joplin-noteDidUpdate', () => {
    lastReportedKey = '';
    scheduleReport();
  });

  scheduleReport();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initViewerScrollSpy, { once: true });
  } else {
    initViewerScrollSpy();
  }
}
