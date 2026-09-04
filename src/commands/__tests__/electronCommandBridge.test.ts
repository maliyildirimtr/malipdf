import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_COMMANDS } from '..';
import {
  COMMAND_EXECUTE_CHANNEL,
  LEGACY_MENU_EVENT_CHANNELS,
} from '../../../electron/commandBridge';
import {
  collectNativeMenuCommandIds,
  createNativeMenuSchema,
} from '../../../electron/nativeMenuSchema';

const NATIVE_MENU_COMMAND_IDS = collectNativeMenuCommandIds(createNativeMenuSchema(true, false));

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

  it('has no parallel legacy menu listeners beside the canonical command channel', () => {
    const preload = readFileSync(resolve(process.cwd(), 'electron/preload.ts'), 'utf8');
    const commands = readFileSync(resolve(process.cwd(), 'src/commands/useAppCommands.ts'), 'utf8');
    expect(preload).not.toMatch(/menu:[a-z]/);
    expect(commands).not.toMatch(/menu:[a-z]/);
    expect(commands.match(/return window\.electronAPI\.onCommand/g)).toHaveLength(1);
  });
});
