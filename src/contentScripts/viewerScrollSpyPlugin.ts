import type {
  ContentScriptContext,
  MarkdownItContentScriptModule,
} from 'api/types';

/**
 * Lightweight Markdown-It content script that leaves note HTML completely untouched
 * while attaching the throttled viewer scroll-spy runtime script in Joplin's rendered
 * Markdown viewer.
 */
export default (_context: ContentScriptContext): MarkdownItContentScriptModule => {
  return {
    plugin: () => {
      // No-op: do not alter Markdown rendering.
    },
    assets: () => [{ name: 'viewerScrollSpyRuntime.js' }],
  };
};
