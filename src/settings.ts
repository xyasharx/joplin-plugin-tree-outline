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
export const AUTO_DISMISS_MOBILE_SETTING_KEY = 'autoDismissOnMobile';
export const TEXT_WRAP_MODE_SETTING_KEY = 'textWrapMode';
export const FONT_PRESET_SETTING_KEY = 'fontPreset';

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
      });
    }

    await joplinApi.settings.registerSettings({
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
 * Reads outline preferences in a single batch via joplin.settings.values()
 * (with fallback to joplin.settings.value() on older Joplin builds).
 */
export async function readOutlinePreferences(
  settings: JoplinApi['settings'],
): Promise<OutlinePreferences> {
  try {
    if (typeof settings.values === 'function') {
      const vals = await settings.values([
        TEXT_WRAP_MODE_SETTING_KEY,
        FONT_PRESET_SETTING_KEY,
      ]);
      return {
        textWrapMode: normalizeTextWrapMode(vals?.[TEXT_WRAP_MODE_SETTING_KEY]),
        fontPreset: normalizeFontPreset(vals?.[FONT_PRESET_SETTING_KEY]),
      };
    }

    const [wrapVal, fontVal] = await Promise.all([
      settings.value(TEXT_WRAP_MODE_SETTING_KEY),
      settings.value(FONT_PRESET_SETTING_KEY),
    ]);
    return {
      textWrapMode: normalizeTextWrapMode(wrapVal),
      fontPreset: normalizeFontPreset(fontVal),
    };
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
      if (
        keys.includes(TEXT_WRAP_MODE_SETTING_KEY) ||
        keys.includes(FONT_PRESET_SETTING_KEY)
      ) {
        const preferences = await readOutlinePreferences(settings);
        await onPreferencesChanged(preferences);
      }
    });
  } catch {
    // Graceful degradation if settings.onChange is unavailable.
  }
}
