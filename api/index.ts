// api/index.ts
// In the Joplin Electron runtime, the `joplin` object is injected into the global scope.
const joplin = (global as any).joplin;
export default joplin;
