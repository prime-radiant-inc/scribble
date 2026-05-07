import { describe, expect, it } from 'vitest';
import { buildEngagementConfig } from '../engagement.js';
import type { TenantConfig } from '../tenantConfig.js';

function tenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    orgName: 'Acme',
    botName: 'Scout',
    botAliases: ['scout', 'helper'],
    effectiveAliases: ['Scout', 'helper'],
    decisionLogChannel: 'decisions',
    wikiGitAuthorName: 'Scout Bot',
    wikiGitAuthorEmail: 'scout@example.com',
    ...overrides,
  };
}

describe('buildEngagementConfig', () => {
  it('uses effective aliases for name mentions', () => {
    const config = buildEngagementConfig(tenant());

    expect(config.nameMentions).toEqual(['Scout', 'helper']);
    expect(config.trackActiveThreads).toBe(true);
    expect(config.threadTimeout).toBe(30 * 60 * 1000);
  });

  it('matches dismissal phrases with bot name and aliases', () => {
    const config = buildEngagementConfig(tenant());

    expect(config.dismissalPatterns.some(pattern => pattern.test('thanks Scout'))).toBe(true);
    expect(config.dismissalPatterns.some(pattern => pattern.test('got it, helper'))).toBe(true);
    expect(config.dismissalPatterns.some(pattern => pattern.test('Scout be quiet'))).toBe(true);
  });

  it('escapes alias regex metacharacters', () => {
    const config = buildEngagementConfig(tenant({
      botName: 'S.crib',
      botAliases: ['s.crib'],
      effectiveAliases: ['S.crib'],
    }));

    expect(config.dismissalPatterns.some(pattern => pattern.test('thanks S.crib'))).toBe(true);
    expect(config.dismissalPatterns.some(pattern => pattern.test('thanks Sxcrib'))).toBe(false);
  });
});
