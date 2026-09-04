import { describe, expect, it } from 'vitest';
import { APP_COMMANDS } from '..';
import {
  COMMAND_EXECUTE_CHANNEL,
  LEGACY_MENU_EVENT_CHANNELS,
  NATIVE_MENU_COMMAND_IDS,
} from '../../../electron/commandBridge';

describe('Electron command bridge contract', () => {
  it('uses one renderer command execution channel', () => {
    expect(COMMAND_EXECUTE_CHANNEL).toBe('command:execute');
    expect(LEGACY_MENU_EVENT_CHANNELS).toEqual([]);
  });

  it.each(NATIVE_MENU_COMMAND_IDS)('maps native %s to a registered command ID', (commandId) => {
    expect(APP_COMMANDS).toHaveProperty(commandId);
  });

  it('contains no duplicate native command mappings', () => {
    expect(new Set(NATIVE_MENU_COMMAND_IDS).size).toBe(NATIVE_MENU_COMMAND_IDS.length);
  });
});
