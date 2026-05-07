import { describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_CONFIG } from '../../config/tenantConfig.js';
import {
  buildLeaveChannelDescription,
  buildLogDecisionDescription,
  buildRespondDirectedAtMeDescription,
  buildRespondToolDescription,
} from '../toolDescriptions.js';

describe('MCP tool descriptions', () => {
  const tenant = {
    ...DEFAULT_TENANT_CONFIG,
    orgName: 'Acme',
    botName: 'Scout',
    botAliases: ['scout', 'helper'],
    effectiveAliases: ['Scout', 'helper'],
    decisionLogChannel: 'team-decisions',
  };

  it('builds respond descriptions from tenant bot name and aliases', () => {
    const description = buildRespondDirectedAtMeDescription(tenant, { linear: true });

    expect(description).toContain('@Scout');
    expect(description).toContain('Scout/helper');
    expect(description).toContain('"thanks scout"');
    expect(description).not.toContain('@scribble');
    expect(description).not.toContain('Scribble/scrib');
  });

  it('does not advertise Linear in respond guidance when Linear is disabled', () => {
    const description = buildRespondDirectedAtMeDescription(tenant, { linear: false });

    expect(description).toContain('wiki and other configured tools');
    expect(description).not.toContain('wiki, Linear, etc.');
  });

  it('keeps the mandatory respond tool description tenant-neutral', () => {
    expect(buildRespondToolDescription()).toBe(
      'You MUST call this tool for EVERY message. This is the only way to send visible responses to Slack.'
    );
  });

  it('builds log_decision description from the configured decision-log channel', () => {
    expect(buildLogDecisionDescription(tenant)).toBe(
      'Log a business decision to #team-decisions with a link back to the source message'
    );
  });

  it('does not prefix Slack channel IDs in log_decision descriptions', () => {
    expect(buildLogDecisionDescription({
      ...tenant,
      decisionLogChannel: 'C0A93A7H820',
    })).toBe('Log a business decision to C0A93A7H820 with a link back to the source message');
  });

  it('builds leave_channel wording without claiming an enforced privacy boundary', () => {
    const description = buildLeaveChannelDescription(tenant);

    expect(description).toContain('Request that Scout leave a Slack channel');
    expect(description).toContain('operator must remove the app or implement leave handling');
    expect(description).not.toContain('stop monitoring');
    expect(description).not.toContain('privacy boundary');
  });
});
