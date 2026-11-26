export type HeadingScript =
  | 'persian'
  | 'arabic'
  | 'hebrew'
  | 'sc'
  | 'jp'
  | 'devanagari'
  | 'latin';

export type TextWrapMode = 'auto' | 'wrapped' | 'nowrap';

export type FontPreset =
  | 'auto'
  | 'inter'
  | 'roboto'
  | 'vazirmatn'
  | 'arabic'
  | 'hebrew'
  | 'cjk-sc'
  | 'cjk-jp'
  | 'devanagari'
  | 'lora'
  | 'mono'
  | 'system';

export interface OutlinePreferences {
  textWrapMode: TextWrapMode;
  fontPreset: FontPreset;
  customFontFamily: string;
  /** Base font size override in px (0 = inherit Joplin theme font size; 10–24 when custom). */
  fontSize: number;
  /** Maximum heading level displayed (1–6). */
  maxHeadingDepth: number;
  /** Auto-collapse headings at or deeper than this level when opening a note (0 = off, 2–5). */
  defaultCollapseLevel: number;
  /** Prefix outline entries with hierarchical numbering (1., 1.1, 1.2). */
  showHeadingNumbers: boolean;
  /** Display subtle H1–H6 level pill badges beside each heading. */
  showLevelBadges: boolean;
  /** Automatically highlight and scroll-track the active heading as the user reads/writes. */
  followActiveHeading: boolean;
}

export interface HeadingNode {
  id: string;
  /** Stable per-note structural key (survives line shifts from body edits). */
  key: string;
  level: number;
  text: string;
  rawText: string;
  line: number;
  slug: string;
  /** For HTML notes, indicates the heading had an explicit HTML id="..." attribute. */
  hasExplicitId?: boolean;
  script: HeadingScript;
  children: HeadingNode[];
}

export type NoteSelectionKind = 'none' | 'single' | 'multiple';

export interface OutlineUpdateMessage {
  type: 'outlineUpdate';
  version: number;
  noteId: string;
  noteChanged: boolean;
  selectionKind: NoteSelectionKind;
  /** Number of currently selected notes (0, 1, or N > 1 for multi-note selection feedback). */
  selectedCount: number;
  markupLanguage: number;
  headings: HeadingNode[];
  isRtl: boolean;
  isMobile: boolean;
}

export interface PreferencesUpdateMessage {
  type: 'preferencesUpdate';
  preferences: OutlinePreferences;
}

export interface ActiveHeadingUpdateMessage {
  type: 'activeHeadingUpdate';
  noteId: string;
  headingKey: string | null;
}

export interface ToastNotificationMessage {
  type: 'toast';
  message: string;
  kind?: 'info' | 'success' | 'error';
}

export type PluginToWebviewMessage =
  | OutlineUpdateMessage
  | PreferencesUpdateMessage
  | ActiveHeadingUpdateMessage
  | ToastNotificationMessage;

export interface WebviewReadyMessage {
  type: 'ready';
}

export interface WebviewRequestSyncMessage {
  type: 'requestSync';
  force?: boolean;
}

export interface WebviewJumpToHeadingMessage {
  type: 'jumpToHeading';
  line: number;
  slug: string;
  text: string;
  level: number;
  hasExplicitId?: boolean;
  markupLanguage?: number;
}

export interface WebviewUpdatePreferencesMessage {
  type: 'updatePreferences';
  textWrapMode?: TextWrapMode;
}

export type CopyLinkFormat = 'markdown' | 'slug';

export interface WebviewCopyHeadingLinkMessage {
  type: 'copyHeadingLink';
  format: CopyLinkFormat;
  slug: string;
  text: string;
}

export interface WebviewInsertTocMessage {
  type: 'insertToc';
}

export type WebviewToPluginMessage =
  | WebviewReadyMessage
  | WebviewRequestSyncMessage
  | WebviewJumpToHeadingMessage
  | WebviewUpdatePreferencesMessage
  | WebviewCopyHeadingLinkMessage
  | WebviewInsertTocMessage;
