import { describe, expect, it } from 'vitest';
import { buildBotToolkitConfig } from '../config/buildBotToolkitConfig.js';

describe('buildBotToolkitConfig', () => {
  it('disables Claude Agent SDK auto-memory; Scribble owns memory via wiki + _scribble/', () => {
    // Use the loadConfig path's existing minimal-env test pattern from
    // src/config/__tests__/config.test.ts to produce a scribbleConfig fixture,
    // or hand-construct the minimal { dataDirectory, timezone, ... } object.
    const scribbleConfig = {
      dataDirectory: '/tmp/scribble-test',
      timezone: 'Etc/UTC',
      slack: { botToken: 'xoxb-test', appToken: 'xapp-test' },
      tenant: {
        orgName: 'Test',
        botName: 'Test',
        botAliases: ['test'],
        decisionLogChannel: 'decision-log',
        wikiGitAuthorName: 'Test',
        wikiGitAuthorEmail: 'test@example.com',
      },
      telemetry: { enabled: false, prometheusPort: 9464 },
    } as unknown as Parameters<typeof buildBotToolkitConfig>[0];

    const config = buildBotToolkitConfig(scribbleConfig, '/tmp/cfg');
    expect(config.autoMemory).toBe('disabled');
  });
});
