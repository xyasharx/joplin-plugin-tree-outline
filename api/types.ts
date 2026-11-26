/**
 * Joplin Plugin API types matching @joplin/lib/services/plugins/api/types.ts.
 * Uses erasable `as const` objects + union types for full compatibility with
 * TypeScript 7+, esbuild, and Node.js native TypeScript execution.
 */

export type ViewHandle = string;

export interface Command {
  /** Globally unique command name */
  name: string;

  /**
   * Label shown in menus, command palette, and Keyboard Shortcuts editor.
   * Commands without a label are treated as private/programmatic only.
   */
  label?: string;

  /** Font Awesome icon class used on toolbar buttons (e.g. 'fas fa-stream') */
  iconName?: string;

  /** Command handler */
  execute(...args: any[]): Promise<any | void>;

  /** Optional VSCode-style when-clause controlling enabled state */
  enabledCondition?: string;
}

export interface VersionInfo {
  version: string;
  profileVersion: number;
  syncVersion: number;
  platform?: 'desktop' | 'mobile';
}

export interface CreateMenuItemOptions {
  accelerator?: string;
}

export const MenuItemLocation = {
  File: 'file',
  Edit: 'edit',
  View: 'view',
  Note: 'note',
  Tools: 'tools',
  Help: 'help',
  NoteListContextMenu: 'noteListContextMenu',
  EditorContextMenu: 'editorContextMenu',
  FolderContextMenu: 'folderContextMenu',
  TagContextMenu: 'tagContextMenu',
} as const;

export type MenuItemLocation = (typeof MenuItemLocation)[keyof typeof MenuItemLocation];

export const ToolbarButtonLocation = {
  /** Top-right note toolbar (desktop) */
  NoteToolbar: 'noteToolbar',

  /** Toolbar above the text editor (desktop & mobile) */
  EditorToolbar: 'editorToolbar',
} as const;

export type ToolbarButtonLocation = (typeof ToolbarButtonLocation)[keyof typeof ToolbarButtonLocation];

export const SettingItemType = {
  Int: 1,
  String: 2,
  Bool: 3,
  Array: 4,
  Object: 5,
  Button: 6,
} as const;

export type SettingItemType = (typeof SettingItemType)[keyof typeof SettingItemType];

export const SettingStorage = {
  Database: 1,
  File: 2,
} as const;

export type SettingStorage = (typeof SettingStorage)[keyof typeof SettingStorage];

export const ContentScriptType = {
  MarkdownItPlugin: 'markdownItPlugin',
  CodeMirrorPlugin: 'codeMirrorPlugin',
} as const;

export type ContentScriptType = (typeof ContentScriptType)[keyof typeof ContentScriptType];

export const MarkupLanguage = {
  Markdown: 1,
  Html: 2,
} as const;

export type MarkupLanguage = (typeof MarkupLanguage)[keyof typeof MarkupLanguage];

export interface SettingItem {
  value: any;
  type: SettingItemType;
  label: string;
  description?: string;
  public: boolean;
  section?: string;
  isEnum?: boolean;
  options?: Record<string | number, string>;
  storage?: SettingStorage;
}

export interface SettingSection {
  label: string;
  iconName?: string;
  description?: string;
  name?: string;
}

export interface ContentScriptContext {
  pluginId: string;
  contentScriptId: string;
  postMessage: (message: any) => Promise<any>;
}

export interface CodeMirrorControl {
  /** CodeMirror 6 EditorView instance (present on CM6 desktop & mobile). */
  editor?: any;
  /** Truthy on Joplin's CodeMirror 6 wrapper (CodeMirror5Emulation). */
  cm6?: any;
  addExtension?: (extension: any | any[]) => void;
  supportsCommand?: (name: string) => boolean;
  execCommand?: (name: string, ...args: any[]) => any;
  registerCommand?: (name: string, callback: (...args: any[]) => any) => void;
  /** Legacy CodeMirror 5 extension registration. */
  defineExtension?: (name: string, callback: (...args: any[]) => any) => void;
}

export interface MarkdownEditorContentScriptModule {
  plugin: (editorControl: CodeMirrorControl) => void;
  codeMirrorResources?: string[];
  codeMirrorOptions?: Record<string, any>;
  assets?: () => any[];
}

export interface JoplinApi {
  plugins: {
    register(script: { onStart?: () => Promise<void> }): Promise<void>;
  };
  commands: {
    register(command: Command): Promise<void>;
    execute(commandName: string, ...args: any[]): Promise<any>;
  };
  contentScripts?: {
    register(type: ContentScriptType, id: string, scriptPath: string): Promise<void>;
    onMessage?: (contentScriptId: string, callback: (message: any) => Promise<any> | any) => Promise<void>;
  };
  views: {
    panels: {
      create(id: string): Promise<ViewHandle>;
      setHtml(handle: ViewHandle, html: string): Promise<string>;
      addScript(handle: ViewHandle, scriptPath: string): Promise<void>;
      onMessage(handle: ViewHandle, callback: (message: any) => Promise<any> | any): Promise<void>;
      postMessage(handle: ViewHandle, message: any): Promise<void> | void;
      show(handle: ViewHandle, show?: boolean): Promise<void>;
      hide(handle: ViewHandle): Promise<void>;
      visible(handle: ViewHandle): Promise<boolean>;
    };
    menuItems: {
      create(
        id: string,
        commandName: string,
        location?: MenuItemLocation,
        options?: CreateMenuItemOptions,
      ): Promise<void>;
    };
    toolbarButtons: {
      create(
        id: string,
        commandName: string,
        location: ToolbarButtonLocation,
      ): Promise<void>;
    };
  };
  settings: {
    registerSection?: (name: string, section: SettingSection) => Promise<void>;
    registerSettings(settings: Record<string, SettingItem>): Promise<void>;
    value(key: string): Promise<any>;
    setValue(key: string, value: any): Promise<void>;
    globalValue(key: string): Promise<any>;
  };
  workspace: {
    selectedNote(): Promise<any>;
    selectedNoteIds?: () => Promise<string[]>;
    onNoteSelectionChange(callback: (event?: any) => void | Promise<void>): Promise<void>;
    onNoteChange(callback: (event?: any) => void | Promise<void>): Promise<void>;
    onSyncComplete?: (callback: (event?: { withErrors?: boolean }) => void | Promise<void>) => Promise<void>;
  };
  data: {
    get(path: string[], query?: any): Promise<any>;
  };
  versionInfo(): Promise<VersionInfo>;
}
