import { describe, it, expect } from 'vitest';
import { parseCliArgs } from '../src/photon-cli-runner.js';

const registerParams = [
  { name: 'group', type: 'string', optional: false, description: 'Group name' },
  { name: 'folder', type: 'string', optional: false, description: 'Folder path' },
  { name: 'trigger', type: 'string', optional: false, description: 'Trigger pattern' },
  { name: 'requiresTrigger', type: 'boolean', optional: true, description: 'Require trigger' },
];

describe('parseCliArgs', () => {
  it('handles pure positional args', () => {
    const result = parseCliArgs(['Arul and Lura', '~/Projects', '@bot'], registerParams);
    expect(result).toEqual({
      group: 'Arul and Lura',
      folder: '~/Projects',
      trigger: '@bot',
    });
  });

  it('handles pure --flag args', () => {
    const result = parseCliArgs(
      ['--group', 'Arul and Lura', '--folder', '~/Projects', '--trigger', '@bot'],
      registerParams
    );
    expect(result).toEqual({
      group: 'Arul and Lura',
      folder: '~/Projects',
      trigger: '@bot',
    });
  });

  it('handles bare-word param names (no --)', () => {
    const result = parseCliArgs(
      ['group', 'Arul and Lura', 'folder', '~/Projects', 'trigger', '@bot'],
      registerParams
    );
    expect(result).toEqual({
      group: 'Arul and Lura',
      folder: '~/Projects',
      trigger: '@bot',
    });
  });

  it('handles mixed bare-word and positional args', () => {
    // group is recognized as param name, rest fall through as positional
    const result = parseCliArgs(['group', 'Arul and Lura', '~/Projects', '@bot'], registerParams);
    expect(result).toEqual({
      group: 'Arul and Lura',
      folder: '~/Projects',
      trigger: '@bot',
    });
  });

  it('handles mixed --flag and bare-word args', () => {
    const result = parseCliArgs(
      ['--group', 'Arul and Lura', 'folder', '~/Projects', '--trigger', '@bot'],
      registerParams
    );
    expect(result).toEqual({
      group: 'Arul and Lura',
      folder: '~/Projects',
      trigger: '@bot',
    });
  });

  it('handles boolean bare-word param', () => {
    const result = parseCliArgs(
      ['group', 'Arul and Lura', 'folder', '~/Projects', 'trigger', '@bot', 'requiresTrigger'],
      registerParams
    );
    expect(result).toEqual({
      group: 'Arul and Lura',
      folder: '~/Projects',
      trigger: '@bot',
      requiresTrigger: true,
    });
  });

  it('handles --no- negation syntax', () => {
    const result = parseCliArgs(
      ['--group', 'Test', '--folder', '~/path', '--trigger', '@x', '--no-requiresTrigger'],
      registerParams
    );
    expect(result.requiresTrigger).toBe(false);
  });

  it('handles --key=value syntax', () => {
    const result = parseCliArgs(
      ['--group=Test Group', '--folder=~/path', '--trigger=@x'],
      registerParams
    );
    expect(result).toEqual({
      group: 'Test Group',
      folder: '~/path',
      trigger: '@x',
    });
  });

  it('maps kebab-case flags to camelCase params', () => {
    const params = [
      { name: 'pairCode', type: 'string', optional: false, description: 'Pair code' },
      { name: 'portUrl', type: 'string', optional: false, description: 'Port URL' },
      { name: 'requiresTrigger', type: 'boolean', optional: true, description: 'flag' },
    ];
    const result = parseCliArgs(
      [
        '--pair-code',
        'Y4-726-QZ',
        '--port-url=https://port.example.workers.dev',
        '--no-requires-trigger',
      ],
      params
    );
    expect(result).toEqual({
      pairCode: 'Y4-726-QZ',
      portUrl: 'https://port.example.workers.dev',
      requiresTrigger: false,
    });
  });

  it('maps kebab-case flags to snake_case params', () => {
    const params = [
      { name: 'pair_code', type: 'string', optional: false, description: 'Pair code' },
      { name: 'port_url', type: 'string', optional: true, description: 'Port URL' },
    ];
    const result = parseCliArgs(
      ['--pair-code', 'YX-YB7-62', '--port-url', 'http://localhost:3000'],
      params
    );
    expect(result).toEqual({
      pair_code: 'YX-YB7-62',
      port_url: 'http://localhost:3000',
    });
  });

  it('does not match bare words that are not param names as named args', () => {
    // "hello" is not a param name, so it's positional
    const result = parseCliArgs(['hello', '~/Projects', '@bot'], registerParams);
    expect(result).toEqual({
      group: 'hello',
      folder: '~/Projects',
      trigger: '@bot',
    });
  });
});
