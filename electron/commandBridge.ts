export const COMMAND_EXECUTE_CHANNEL = 'command:execute' as const;
export const COMMAND_STATE_CHANNEL = 'command:updateState' as const;
export const FULLSCREEN_TOGGLE_CHANNEL = 'window:toggleFullScreen' as const;

/** Phase 0 removes the old menu:* fan-out completely. */
export const LEGACY_MENU_EVENT_CHANNELS: readonly string[] = [];

export interface NativeCommandState { commandId: string; enabled: boolean; checked?: boolean }
