import type { EngagementConfig } from '@primeradiant/bot-toolkit';
import { escapeRegExp } from '../utils/regex.js';
import type { TenantConfig } from './tenantConfig.js';

export function buildEngagementConfig(tenant: TenantConfig): EngagementConfig {
  const aliases = tenant.effectiveAliases.map(escapeRegExp).join('|');
  const addressedBot = `(?:${aliases})`;

  return {
    nameMentions: tenant.effectiveAliases,
    trackActiveThreads: true,
    dismissalPatterns: [
      new RegExp(`thanks,?\\s*${addressedBot}`, 'i'),
      new RegExp(`thank you,?\\s*${addressedBot}`, 'i'),
      new RegExp(`got it,?\\s*${addressedBot}`, 'i'),
      new RegExp(`${addressedBot}\\s+be quiet`, 'i'),
      /that's all/i,
      /never\s*mind/i,
      /dismiss/i,
      /go away/i,
    ],
    threadTimeout: 30 * 60 * 1000,
  };
}
