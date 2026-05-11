import { isValidSlackChannelId } from '../utils/slackIds.js';

export interface TenantConfig {
  orgName: string;
  botName: string;
  botAliases: string[];
  effectiveAliases: string[];
  decisionLogChannel: string;
  wikiGitAuthorName: string;
  wikiGitAuthorEmail: string;
}

export const DEFAULT_TENANT_CONFIG: TenantConfig = {
  orgName: 'Your Organization',
  botName: 'Scribble',
  botAliases: ['scribble', 'scrib'],
  effectiveAliases: ['Scribble', 'scrib'],
  decisionLogChannel: 'decision-log',
  wikiGitAuthorName: 'Scribble Bot',
  wikiGitAuthorEmail: 'scribble@example.com',
};

type Env = Record<string, string | undefined>;

function defaultedEnv(env: Env, key: string, fallback: string): string {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  if (!value) {
    throw new Error(`${key} cannot be empty`);
  }
  return value;
}

export function parseOptionalEnv(env: Env, key: string): string | undefined {
  const raw = env[key];
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value || undefined;
}

function parseAliases(rawAliases: string): string[] {
  const aliases = rawAliases
    .split(',')
    .map(alias => alias.trim())
    .filter(Boolean);

  if (aliases.length === 0) {
    throw new Error('SCRIBBLE_BOT_ALIASES must include at least one alias');
  }

  return aliases;
}

const SLACK_CHANNEL_NAME = /^[a-z0-9][a-z0-9._-]{0,79}$/;

function validateDecisionLogChannel(value: string): string {
  const name = value.replace(/^#/, '');
  if (isValidSlackChannelId(value)) {
    return value;
  }

  if (SLACK_CHANNEL_NAME.test(name)) {
    return name;
  }

  throw new Error("SCRIBBLE_DECISION_LOG_CHANNEL must be a Slack channel ID, or a lowercase Slack channel name using only letters, digits, '.', '_', and '-'");
}

function dedupeAliases(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(value);
  }

  return deduped;
}

export function parseTenantConfig(env: Env = process.env): TenantConfig {
  const orgName = defaultedEnv(env, 'SCRIBBLE_ORG_NAME', DEFAULT_TENANT_CONFIG.orgName);
  const botName = defaultedEnv(env, 'SCRIBBLE_BOT_NAME', DEFAULT_TENANT_CONFIG.botName);
  const botAliases = parseAliases(
    defaultedEnv(env, 'SCRIBBLE_BOT_ALIASES', DEFAULT_TENANT_CONFIG.botAliases.join(','))
  );
  const decisionLogChannel = validateDecisionLogChannel(
    defaultedEnv(
      env,
      'SCRIBBLE_DECISION_LOG_CHANNEL',
      DEFAULT_TENANT_CONFIG.decisionLogChannel
    )
  );
  const wikiGitAuthorName = defaultedEnv(
    env,
    'SCRIBBLE_WIKI_GIT_AUTHOR_NAME',
    DEFAULT_TENANT_CONFIG.wikiGitAuthorName
  );
  const wikiGitAuthorEmail = defaultedEnv(
    env,
    'SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL',
    DEFAULT_TENANT_CONFIG.wikiGitAuthorEmail
  );

  return {
    orgName,
    botName,
    botAliases,
    effectiveAliases: dedupeAliases([botName, ...botAliases]),
    decisionLogChannel,
    wikiGitAuthorName,
    wikiGitAuthorEmail,
  };
}

export function tenantConfigToEnv(config: TenantConfig): Record<string, string> {
  return {
    SCRIBBLE_ORG_NAME: config.orgName,
    SCRIBBLE_BOT_NAME: config.botName,
    SCRIBBLE_BOT_ALIASES: config.botAliases.join(','),
    SCRIBBLE_DECISION_LOG_CHANNEL: config.decisionLogChannel,
    SCRIBBLE_WIKI_GIT_AUTHOR_NAME: config.wikiGitAuthorName,
    SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: config.wikiGitAuthorEmail,
  };
}
