declare module '@joplin/fork-uslug' {
  export interface UslugOptions {
    allowedChars?: string;
    lower?: boolean;
    spaces?: boolean;
  }

  function uslug(string: string, options?: UslugOptions): string;
  export default uslug;
}
