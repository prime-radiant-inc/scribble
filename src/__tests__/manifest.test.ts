import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

const EXPECTED_BOT_SCOPES = [
  'app_mentions:read',
  'channels:history',
  'channels:join',
  'channels:read',
  'chat:write',
  'chat:write.public',
  'files:read',
  'files:write',
  'groups:history',
  'groups:read',
  'im:history',
  'im:read',
  'im:write',
  'mpim:history',
  'mpim:read',
  'reactions:read',
  'reactions:write',
  'users:read',
  'users:read.email',
];

const EXPECTED_BOT_EVENTS = [
  'app_mention',
  'channel_left',
  'member_joined_channel',
  'message.channels',
  'message.groups',
  'message.im',
  'message.mpim',
  'reaction_added',
  'user_change',
];

describe('slack-app-manifest.yaml scope drift', () => {
  const manifestPath = path.join(__dirname, '..', '..', 'slack-app-manifest.yaml');
  const text = fs.readFileSync(manifestPath, 'utf-8');
  const parsed = yaml.parse(text);

  it('oauth_config.scopes.bot matches expected set', () => {
    const actual = parsed.oauth_config.scopes.bot.slice().sort();
    expect(actual).toEqual(EXPECTED_BOT_SCOPES.slice().sort());
  });

  it('settings.event_subscriptions.bot_events matches expected set', () => {
    const actual = parsed.settings.event_subscriptions.bot_events.slice().sort();
    expect(actual).toEqual(EXPECTED_BOT_EVENTS.slice().sort());
  });
});
