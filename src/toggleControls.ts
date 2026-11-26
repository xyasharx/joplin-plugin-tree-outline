import {
  MenuItemLocation,
  SettingItemType,
  ToolbarButtonLocation,
  type JoplinApi,
  type ViewHandle,
} from 'api/types';

export const TOGGLE_COMMAND_NAME = 'toggleTreeOutline';
export const TOGGLE_COMMAND_LABEL = 'Toggle TreeOutline';
export const TOGGLE_COMMAND_ICON = 'fas fa-stream';
export const TOGGLE_MENU_ITEM_ID = 'toggleTreeOutlineMenuItem';
export const TOGGLE_TOOLBAR_BUTTON_ID = 'toggleTreeOutlineToolbarButton';
export const PANEL_VISIBLE_SETTING_KEY = 'panelVisible';

export interface RegisterToggleControlsOptions {
  joplinApi: Pick<JoplinApi, 'commands' | 'settings' | 'views'>;
  panel: ViewHandle;
  isMobile: boolean;
  onPanelShown?: () => Promise<void> | void;
}

async function readSavedVisibility(
  settings: JoplinApi['settings'],
): Promise<boolean> {
  try {
    const saved = await settings.value(PANEL_VISIBLE_SETTING_KEY);
    return typeof saved === 'boolean' ? saved : true;
  } catch {
    return true;
  }
}

async function persistVisibility(
  settings: JoplinApi['settings'],
  visible: boolean,
): Promise<void> {
  try {
    await settings.setValue(PANEL_VISIBLE_SETTING_KEY, visible);
  } catch {
    // Toggling visibility should still succeed even if persistence fails.
  }
}

/**
 * Registers the TreeOutline toggle command, desktop menu item (which also exposes
 * the command in Joplin's Keyboard Shortcuts on macOS, Windows, and Linux),
 * desktop note toolbar button, and restores persisted panel visibility.
 */
export async function registerToggleControls({
  joplinApi,
  panel,
  isMobile,
  onPanelShown,
}: RegisterToggleControlsOptions): Promise<boolean> {
  if (!isMobile) {
    try {
      await joplinApi.settings.registerSettings({
        [PANEL_VISIBLE_SETTING_KEY]: {
          value: true,
          type: SettingItemType.Bool,
          public: false,
          label: 'Show TreeOutline panel',
        },
      });
    } catch {
      // Fall back to default visible state if settings registration is unavailable.
    }
  }

  // Register the command before associating it with any menu item or toolbar button
  // so Joplin's MenuBar and NoteToolbar can immediately resolve its declaration.
  await joplinApi.commands.register({
    name: TOGGLE_COMMAND_NAME,
    label: TOGGLE_COMMAND_LABEL,
    iconName: TOGGLE_COMMAND_ICON,
    execute: async () => {
      const isVisible = await joplinApi.views.panels.visible(panel);
      const nextVisible = !isVisible;
      await joplinApi.views.panels.show(panel, nextVisible);

      if (!isMobile) {
        await persistVisibility(joplinApi.settings, nextVisible);
      }

      if (nextVisible && onPanelShown) {
        await onPanelShown();
      }
    },
  });

  if (!isMobile) {
    // Creating a top-level menu item via joplin.views.menuItems.create() places
    // "Toggle TreeOutline" under Tools on macOS, Windows, and Linux, and
    // registers the command in Joplin's KeymapService (with no conflicting default
    // accelerator) so users can search and assign a custom shortcut in
    // Keyboard Shortcuts on all Joplin versions >= 2.8.0.
    await joplinApi.views.menuItems.create(
      TOGGLE_MENU_ITEM_ID,
      TOGGLE_COMMAND_NAME,
      MenuItemLocation.Tools,
    );

    // Expose a one-click toggle button in the desktop note toolbar.
    await joplinApi.views.toolbarButtons.create(
      TOGGLE_TOOLBAR_BUTTON_ID,
      TOGGLE_COMMAND_NAME,
      ToolbarButtonLocation.NoteToolbar,
    );
  }

  // On mobile, keep the panel marked opened so it stays accessible in Joplin's
  // native tabbed Plugin Panels dialog. On desktop, restore the saved state.
  const initialVisible = isMobile
    ? true
    : await readSavedVisibility(joplinApi.settings);

  await joplinApi.views.panels.show(panel, initialVisible);

  if (initialVisible && onPanelShown) {
    await onPanelShown();
  }

  return initialVisible;
}
