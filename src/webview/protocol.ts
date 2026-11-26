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
  markupLanguage: number;
  headings: HeadingNode[];
  isRtl: boolean;
  isMobile: boolean;
}

export interface PreferencesUpdateMessage {
  type: 'preferencesUpdate';
  preferences: OutlinePreferences;
}

export type PluginToWebviewMessage = OutlineUpdateMessage | PreferencesUpdateMessage;

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

export type WebviewToPluginMessage =
  | WebviewReadyMessage
  | WebviewRequestSyncMessage
  | WebviewJumpToHeadingMessage
  | WebviewUpdatePreferencesMessage;
