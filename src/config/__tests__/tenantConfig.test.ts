import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TENANT_CONFIG,
  parseOptionalEnv,
  parseTenantConfig,
  tenantConfigToEnv,
} from '../tenantConfig.js';

describe('parseTenantConfig', () => {
  it('uses built-in runtime defaults when env values are unset', () => {
    expect(parseTenantConfig({})).toEqual(DEFAULT_TENANT_CONFIG);
  });

  it('trims custom tenant values and builds effective aliases', () => {
    const config = parseTenantConfig({
      SCRIBBLE_ORG_NAME: ' Acme Co ',
      SCRIBBLE_BOT_NAME: ' Scout ',
      SCRIBBLE_BOT_ALIASES: ' scout,helper,SCOUT ',
      SCRIBBLE_DECISION_LOG_CHANNEL: ' #decisions ',
      SCRIBBLE_WIKI_GIT_AUTHOR_NAME: ' Scout Bot ',
      SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: ' scout@example.com ',
    });

    expect(config).toEqual({
      orgName: 'Acme Co',
      botName: 'Scout',
      botAliases: ['scout', 'helper', 'SCOUT'],
      effectiveAliases: ['Scout', 'helper'],
      decisionLogChannel: 'decisions',
      wikiGitAuthorName: 'Scout Bot',
      wikiGitAuthorEmail: 'scout@example.com',
    });
  });

  it.each([
    ['SCRIBBLE_ORG_NAME'],
    ['SCRIBBLE_BOT_NAME'],
    ['SCRIBBLE_BOT_ALIASES'],
    ['SCRIBBLE_DECISION_LOG_CHANNEL'],
    ['SCRIBBLE_WIKI_GIT_AUTHOR_NAME'],
    ['SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL'],
  ])('rejects present-but-empty %s', (key) => {
    expect(() => parseTenantConfig({ [key]: '   ' })).toThrow(key);
  });

  it('rejects alias lists with no non-empty aliases', () => {
    expect(() => parseTenantConfig({ SCRIBBLE_BOT_ALIASES: ' , , ' })).toThrow('SCRIBBLE_BOT_ALIASES');
  });

  it.each([
    ['my decision log'],
    ['#wrong#chars'],
    ['UPPERCASE'],
  ])('rejects malformed decision-log channel value %s', (value) => {
    expect(() => parseTenantConfig({ SCRIBBLE_DECISION_LOG_CHANNEL: value })).toThrow('SCRIBBLE_DECISION_LOG_CHANNEL');
  });

  it('accepts Slack channel names with periods', () => {
    expect(parseTenantConfig({ SCRIBBLE_DECISION_LOG_CHANNEL: 'team.alpha' }).decisionLogChannel).toBe('team.alpha');
  });

  it('dedupes aliases case-insensitively while preserving first spelling', () => {
    const config = parseTenantConfig({
      SCRIBBLE_BOT_NAME: 'Scribble',
      SCRIBBLE_BOT_ALIASES: 'scribble,Scrib,SCRIB,scribe',
    });

    expect(config.effectiveAliases).toEqual(['Scribble', 'Scrib', 'scribe']);
  });

  it('serializes normalized env for the MCP subprocess', () => {
    const config = parseTenantConfig({
      SCRIBBLE_ORG_NAME: 'Acme',
      SCRIBBLE_BOT_NAME: 'Scout',
      SCRIBBLE_BOT_ALIASES: 'scout,helper',
      SCRIBBLE_DECISION_LOG_CHANNEL: 'decisions',
      SCRIBBLE_WIKI_GIT_AUTHOR_NAME: 'Scout Bot',
      SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: 'scout@example.com',
    });

    expect(tenantConfigToEnv(config)).toEqual({
      SCRIBBLE_ORG_NAME: 'Acme',
      SCRIBBLE_BOT_NAME: 'Scout',
      SCRIBBLE_BOT_ALIASES: 'scout,helper',
      SCRIBBLE_DECISION_LOG_CHANNEL: 'decisions',
      SCRIBBLE_WIKI_GIT_AUTHOR_NAME: 'Scout Bot',
      SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: 'scout@example.com',
    });
  });
});

describe('parseOptionalEnv', () => {
  it('treats unset, empty, and whitespace-only optional env values as unset', () => {
    expect(parseOptionalEnv({}, 'LINEAR_API_KEY')).toBeUndefined();
    expect(parseOptionalEnv({ LINEAR_API_KEY: '' }, 'LINEAR_API_KEY')).toBeUndefined();
    expect(parseOptionalEnv({ LINEAR_API_KEY: '   ' }, 'LINEAR_API_KEY')).toBeUndefined();
  });

  it('returns trimmed optional values', () => {
    expect(parseOptionalEnv({ LINEAR_API_KEY: ' lin_api_test ' }, 'LINEAR_API_KEY')).toBe('lin_api_test');
  });
});
