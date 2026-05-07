import { describe, expect, it } from 'vitest';
import { formatSlackChannelLabel, isValidSlackChannelId, isValidSlackThreadTs } from '../slackIds.js';

describe('Slack ID validators', () => {
  it('accepts Slack-shaped channel IDs with supported prefixes', () => {
    expect(isValidSlackChannelId('C0A93A7H820')).toBe(true);
    expect(isValidSlackChannelId('D0A93A7H820')).toBe(true);
    expect(isValidSlackChannelId('G0A93A7H820')).toBe(true);
  });

  it('accepts longer channel IDs while keeping a bounded path component', () => {
    expect(isValidSlackChannelId(`C${'A'.repeat(31)}`)).toBe(true);
    expect(isValidSlackChannelId(`C${'A'.repeat(32)}`)).toBe(false);
  });

  it('rejects malformed channel IDs', () => {
    expect(isValidSlackChannelId('../wiki')).toBe(false);
    expect(isValidSlackChannelId('10A93A7H820')).toBe(false);
    expect(isValidSlackChannelId('c0a93a7h820')).toBe(false);
  });

  it('validates Slack thread timestamps', () => {
    expect(isValidSlackThreadTs('1772816645.224219')).toBe(true);
    expect(isValidSlackThreadTs('../escape')).toBe(false);
  });

  it('formats configured channel names for prompt display', () => {
    expect(formatSlackChannelLabel('decision-log')).toBe('#decision-log');
    expect(formatSlackChannelLabel('#decisions')).toBe('#decisions');
    expect(formatSlackChannelLabel('C0A93A7H820')).toBe('C0A93A7H820');
  });
});
