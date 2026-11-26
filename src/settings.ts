import {
  SettingItemType,
  SettingStorage,
  type JoplinApi,
} from 'api/types';
import type {
  FontPreset,
  OutlinePreferences,
  TextWrapMode,
} from './webview/protocol';

export const SETTINGS_SECTION_NAME = 'treeOutline';

export const MAX_HEADING_DEPTH_SETTING_KEY = 'maxHeadingDepth';
export const DEFAULT_COLLAPSE_LEVEL_SETTING_KEY = 'defaultCollapseLevel';
export const FOLLOW_ACTIVE_HEADING_SETTING_KEY = 'followActiveHeading';
export const SHOW_HEADING_NUMBERS_SETTING_KEY = 'showHeadingNumbers';
export const SHOW_LEVEL_BADGES_SETTING_KEY = 'showLevelBadges';
export const TEXT_WRAP_MODE_SETTING_KEY = 'textWrapMode';
export const FONT_PRESET_SETTING_KEY = 'fontPreset';
export const CUSTOM_FONT_FAMILY_SETTING_KEY = 'customFontFamily';
export const FONT_SIZE_SETTING_KEY = 'fontSize';
export const AUTO_DISMISS_MOBILE_SETTING_KEY = 'autoDismissOnMobile';

export const PREFERENCE_SETTING_KEYS: readonly string[] = [
  TEXT_WRAP_MODE_SETTING_KEY,
  FONT_PRESET_SETTING_KEY,
  CUSTOM_FONT_FAMILY_SETTING_KEY,
  FONT_SIZE_SETTING_KEY,
  MAX_HEADING_DEPTH_SETTING_KEY,
  DEFAULT_COLLAPSE_LEVEL_SETTING_KEY,
  SHOW_HEADING_NUMBERS_SETTING_KEY,
  SHOW_LEVEL_BADGES_SETTING_KEY,
  FOLLOW_ACTIVE_HEADING_SETTING_KEY,
];

export const VALID_TEXT_WRAP_MODES = new Set<TextWrapMode>(['auto', 'wrapped', 'nowrap']);

export const VALID_FONT_PRESETS = new Set<FontPreset>([
  'auto',
  'inter',
  'roboto',
  'vazirmatn',
  'arabic',
  'hebrew',
  'cjk-sc',
  'cjk-jp',
  'devanagari',
  'lora',
  'mono',
  'system',
]);

export const DEFAULT_OUTLINE_PREFERENCES: OutlinePreferences = {
  textWrapMode: 'auto',
  fontPreset: 'auto',
  customFontFamily: '',
  fontSize: 0,
  maxHeadingDepth: 6,
  defaultCollapseLevel: 0,
  showHeadingNumbers: false,
  showLevelBadges: false,
  followActiveHeading: true,
};

export function normalizeTextWrapMode(value: unknown): TextWrapMode {
  return typeof value === 'string' && VALID_TEXT_WRAP_MODES.has(value as TextWrapMode)
    ? (value as TextWrapMode)
    : DEFAULT_OUTLINE_PREFERENCES.textWrapMode;
}

export function normalizeFontPreset(value: unknown): FontPreset {
  return typeof value === 'string' && VALID_FONT_PRESETS.has(value as FontPreset)
    ? (value as FontPreset)
    : DEFAULT_OUTLINE_PREFERENCES.fontPreset;
}

/**
 * Sanitizes a user-supplied CSS font-family string by stripping characters that
 * could break out of a CSS property value or inject markup (`;`, `{`, `}`, `<`, `>`).
 */
export function sanitizeCustomFontFamily(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[;{}<>\\]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * Normalizes custom font size in pixels:
 * `0` inherits Joplin's default `--joplin-font-size`, non-zero values clamp safely to `[10, 24]`.
 */
export function normalizeFontSize(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.min(24, Math.max(10, Math.round(num)));
}

export function normalizeMaxHeadingDepth(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_OUTLINE_PREFERENCES.maxHeadingDepth;
  return Math.min(6, Math.max(1, Math.round(num)));
}

export function normalizeDefaultCollapseLevel(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  const rounded = Math.round(num);
  return rounded >= 2 && rounded <= 5 ? rounded : 0;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function mapRawValuesToPreferences(raw: Record<string, unknown>): OutlinePreferences {
  return {
    textWrapMode: normalizeTextWrapMode(raw[TEXT_WRAP_MODE_SETTING_KEY]),
    fontPreset: normalizeFontPreset(raw[FONT_PRESET_SETTING_KEY]),
    customFontFamily: sanitizeCustomFontFamily(raw[CUSTOM_FONT_FAMILY_SETTING_KEY]),
    fontSize: normalizeFontSize(raw[FONT_SIZE_SETTING_KEY]),
    maxHeadingDepth: normalizeMaxHeadingDepth(raw[MAX_HEADING_DEPTH_SETTING_KEY]),
    defaultCollapseLevel: normalizeDefaultCollapseLevel(raw[DEFAULT_COLLAPSE_LEVEL_SETTING_KEY]),
    showHeadingNumbers: normalizeBoolean(
      raw[SHOW_HEADING_NUMBERS_SETTING_KEY],
      DEFAULT_OUTLINE_PREFERENCES.showHeadingNumbers,
    ),
    showLevelBadges: normalizeBoolean(
      raw[SHOW_LEVEL_BADGES_SETTING_KEY],
      DEFAULT_OUTLINE_PREFERENCES.showLevelBadges,
    ),
    followActiveHeading: normalizeBoolean(
      raw[FOLLOW_ACTIVE_HEADING_SETTING_KEY],
      DEFAULT_OUTLINE_PREFERENCES.followActiveHeading,
    ),
  };
}

/**
 * Registers the TreeOutline settings section and all user-facing plugin settings
 * via the modern joplin.settings.registerSettings() API.
 */
export async function registerPluginSettings(
  joplinApi: Pick<JoplinApi, 'settings'>,
): Promise<void> {
  try {
    if (typeof joplinApi.settings.registerSection === 'function') {
      await joplinApi.settings.registerSection(SETTINGS_SECTION_NAME, {
        label: 'TreeOutline',
        iconName: 'fas fa-stream',
        description:
          'Configure heading depth, auto-collapse behavior, scroll-spy tracking, visual style, typography, and mobile jump behavior.',
      });
    }

    await joplinApi.settings.registerSettings({
      [MAX_HEADING_DEPTH_SETTING_KEY]: {
        value: DEFAULT_OUTLINE_PREFERENCES.maxHeadingDepth,
        type: SettingItemType.Int,
        minimum: 1,
        maximum: 6,
        step: 1,
        public: true,
        section: SETTINGS_SECTION_NAME,
        storage: SettingStorage.File,
        label: 'Maximum heading depth (H1–H6)',
        description:
          'Limit displayed headings to levels 1 through this depth (e.g. 3 shows H1–H3 only).',
      },
      [DEFAULT_COLLAPSE_LEVEL_SETTING_KEY]: {
        value: DEFAULT_OUTLINE_PREFERENCES.defaultCollapseLevel,
        type: SettingItemType.Int,
        isEnum: true,
        options: {
          0: 'Off (expand all headings)',
          2: 'Collapse H2 and deeper',
          3: 'Collapse H3 and deeper',
          4: 'Collapse H4 and deeper',
          5: 'Collapse H5 and deeper',
        },
        public: true,
        section: SETTINGS_SECTION_NAME,
        storage: SettingStorage.File,
        label: 'Default auto-collapse level',
        description:
          'Automatically collapse headings with children at or deeper than this level when opening a note.',
      },
      [FOLLOW_ACTIVE_HEADING_SETTING_KEY]: {
        value: DEFAULT_OUTLINE_PREFERENCES.followActiveHeading,
        type: SettingItemType.Bool,
        public: true,
        section: SETTINGS_SECTION_NAME,
        storage: SettingStorage.File,
        label: 'Follow active heading (scroll-spy)',
        description:
          'Automatically highlight and scroll the current section into view as you read or edit.',
      },
      [SHOW_HEADING_NUMBERS_SETTING_KEY]: {
        value: DEFAULT_OUTLINE_PREFERENCES.showHeadingNumbers,
        type: SettingItemType.Bool,
        public: true,
        section: SETTINGS_SECTION_NAME,
        storage: SettingStorage.File,
        label: 'Show hierarchical heading numbering',
        description:
          'Display automatic section numbering (e.g. 1., 1.1, 1.2) before each heading.',
      },
      [SHOW_LEVEL_BADGES_SETTING_KEY]: {
        value: DEFAULT_OUTLINE_PREFERENCES.showLevelBadges,
        type: SettingItemType.Bool,
        public: true,
        section: SETTINGS_SECTION_NAME,
        storage: SettingStorage.File,
        label: 'Show heading level badges (H1–H6)',
        description:
          'Display subtle H1–H6 level pills beside each heading (disable for a minimal view).',
      },
      [TEXT_WRAP_MODE_SETTING_KEY]: {
        value: DEFAULT_OUTLINE_PREFERENCES.textWrapMode,
        type: SettingItemType.String,
        isEnum: true,
        options: {
          auto: 'Auto (wrap on narrow panels)',
          wrapped: 'Always wrap long headings',
          nowrap: 'Single line (truncate with ellipsis)',
        },
        public: true,
        section: SETTINGS_SECTION_NAME,
        storage: SettingStorage.File,
        label: 'Heading text wrapping',
        description:
          'Control how long headings display in the outline panel. Also updated when toggling wrap from the panel toolbar.',
      },
      [FONT_PRESET_SETTING_KEY]: {
        value: DEFAULT_OUTLINE_PREFERENCES.fontPreset,
        type: SettingItemType.String,
        isEnum: true,
        options: {
          auto: 'Auto (match heading script)',
          inter: 'Inter / Modern Sans',
          roboto: 'Roboto',
          vazirmatn: 'Vazirmatn / Persian',
          arabic: 'Arabic',
          hebrew: 'Hebrew',
          'cjk-sc': 'Simplified Chinese',
          'cjk-jp': 'Japanese',
          devanagari: 'Devanagari',
          lora: 'Lora / Book Serif',
          mono: 'Monospace',
          system: 'System Default',
        },
        public: true,
        section: SETTINGS_SECTION_NAME,
        storage: SettingStorage.File,
        label: 'Outline font preset',
        description:
          'Choose automatic per-script font selection or override with a preferred font stack.',
      },
      [CUSTOM_FONT_FAMILY_SETTING_KEY]: {
        value: DEFAULT_OUTLINE_PREFERENCES.customFontFamily,
        type: SettingItemType.String,
        public: true,
        section: SETTINGS_SECTION_NAME,
        storage: SettingStorage.File,
        label: 'Custom font family override',
        description:
          'Optional CSS font-family name (e.g. "IBM Plex Sans", "Vazirmatn"). When non-empty, overrides the font preset.',
      },
      [FONT_SIZE_SETTING_KEY]: {
        value: DEFAULT_OUTLINE_PREFERENCES.fontSize,
        type: SettingItemType.Int,
        minimum: 0,
        maximum: 24,
        step: 1,
        public: true,
        section: SETTINGS_SECTION_NAME,
        storage: SettingStorage.File,
        label: 'Custom font size (px, 0 = Joplin default)',
        description:
          'Override the outline base font size (10–24 px). Set to 0 to inherit Joplin’s theme font size.',
      },
      [AUTO_DISMISS_MOBILE_SETTING_KEY]: {
        value: true,
        type: SettingItemType.Bool,
        public: true,
        section: SETTINGS_SECTION_NAME,
        storage: SettingStorage.File,
        label: 'Auto-dismiss panel after jumping (Mobile)',
        description:
          'Automatically close the TreeOutline panel after tapping a heading on Joplin Mobile.',
      },
    });
  } catch {
    // Never block plugin startup if settings registration fails.
  }
}

/**
 * Reads all outline preferences in a single batch via joplin.settings.values()
 * (with fallback to joplin.settings.value() on older Joplin builds).
 */
export async function readOutlinePreferences(
  settings: JoplinApi['settings'],
): Promise<OutlinePreferences> {
  try {
    if (typeof settings.values === 'function') {
      const vals = await settings.values([...PREFERENCE_SETTING_KEYS]);
      return mapRawValuesToPreferences(vals ?? {});
    }

    const entries = await Promise.all(
      PREFERENCE_SETTING_KEYS.map(async (key) => [key, await settings.value(key)] as const),
    );
    const raw: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      raw[key] = val;
    }
    return mapRawValuesToPreferences(raw);
  } catch {
    return { ...DEFAULT_OUTLINE_PREFERENCES };
  }
}

export async function persistTextWrapMode(
  settings: JoplinApi['settings'],
  mode: unknown,
): Promise<TextWrapMode> {
  const normalized = normalizeTextWrapMode(mode);
  try {
    await settings.setValue(TEXT_WRAP_MODE_SETTING_KEY, normalized);
  } catch {
    // Ignore storage failures so UI toggling still succeeds.
  }
  return normalized;
}

export async function shouldAutoDismissOnMobile(
  settings: JoplinApi['settings'],
): Promise<boolean> {
  try {
    const val = await settings.value(AUTO_DISMISS_MOBILE_SETTING_KEY);
    return typeof val === 'boolean' ? val : true;
  } catch {
    return true;
  }
}

const PREFERENCE_KEY_SET = new Set<string>(PREFERENCE_SETTING_KEYS);

/**
 * Subscribes to live Joplin settings changes for webview-visible preferences.
 */
export async function subscribePreferenceChanges(
  settings: JoplinApi['settings'],
  onPreferencesChanged: (preferences: OutlinePreferences) => Promise<void> | void,
): Promise<void> {
  if (typeof settings.onChange !== 'function') return;
  try {
    await settings.onChange(async (event) => {
      const keys = Array.isArray(event?.keys) ? event.keys : [];
      if (keys.some((key) => PREFERENCE_KEY_SET.has(key))) {
        const preferences = await readOutlinePreferences(settings);
        await onPreferencesChanged(preferences);
      }
    });
  } catch {
    // Graceful degradation if settings.onChange is unavailable.
  }
}
