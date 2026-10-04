// Universal global resolution safe for Node.js (Desktop), Android (Hermes/WebView), and iOS (JavaScriptCore)
const globalScope: any =
  typeof globalThis !== 'undefined' ? globalThis :
  typeof window !== 'undefined' ? window :
  typeof global !== 'undefined' ? global :
  typeof self !== 'undefined' ? self : {};

const joplin = globalScope.joplin;

export default joplin;
