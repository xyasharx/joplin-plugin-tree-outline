import type { JoplinApi } from './types';

// Universal global resolution safe for Electron (Desktop), Android (Hermes/WebView), and iOS (JavaScriptCore)
const globalScope: { joplin?: JoplinApi } =
  typeof globalThis !== 'undefined'
    ? (globalThis as { joplin?: JoplinApi })
    : typeof window !== 'undefined'
      ? (window as unknown as { joplin?: JoplinApi })
      : typeof global !== 'undefined'
        ? (global as unknown as { joplin?: JoplinApi })
        : typeof self !== 'undefined'
          ? (self as unknown as { joplin?: JoplinApi })
          : {};

const joplin = globalScope.joplin as JoplinApi;

export default joplin;
