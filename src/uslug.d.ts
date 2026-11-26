declare module 'uslug' {
  interface UslugOptions {
    allowedChars?: string;
    lower?: boolean;
    spaces?: boolean;
  }

  function uslug(string: string, options?: UslugOptions): string;
  export default uslug;
}
