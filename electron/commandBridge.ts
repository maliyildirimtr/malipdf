export const COMMAND_EXECUTE_CHANNEL = 'command:execute' as const;
export const COMMAND_STATE_CHANNEL = 'command:updateState' as const;
export const NATIVE_ROLE_CHANNEL = 'native-role:execute' as const;
export const FULLSCREEN_TOGGLE_CHANNEL = 'window:toggleFullScreen' as const;

/** Phase 0 removes the old menu:* fan-out completely. */
export const LEGACY_MENU_EVENT_CHANNELS: readonly string[] = [];

export const NATIVE_MENU_COMMAND_IDS = [
  'file.open', 'file.save', 'file.saveAs', 'file.export', 'file.close', 'file.closeAll',
  'history.undo', 'history.redo', 'edit.selectAll', 'edit.deleteSelected',
  'tool.hand', 'tool.select', 'tool.pen', 'tool.highlighter', 'tool.eraser', 'tool.text',
  'tool.rectangle', 'tool.ellipse', 'tool.line', 'tool.arrow',
  'view.zoomIn', 'view.zoomOut', 'view.actualSize', 'view.fitWidth', 'view.fitPage',
  'view.rotateCW', 'view.rotateCCW', 'view.sidebar', 'view.nativeFullscreen', 'view.focusMode',
] as const;

export type NativeRole = 'cut' | 'copy' | 'paste' | 'minimize' | 'zoom' | 'bringAllToFront';
export interface NativeCommandState { commandId: string; enabled: boolean; checked?: boolean }
