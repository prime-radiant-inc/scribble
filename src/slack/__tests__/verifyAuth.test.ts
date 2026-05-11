import { describe, it, expect, vi } from 'vitest';
import { SlackAuthError, verifySlackAuth, type SlackAuthVerifier } from '../verifyAuth.js';

function makeVerifier(impl: SlackAuthVerifier['test']): SlackAuthVerifier {
  return { test: impl };
}

describe('verifySlackAuth', () => {
  it('resolves when auth.test succeeds', async () => {
    const verifier = makeVerifier(async () => ({ ok: true, user_id: 'U123', team_id: 'T1' }));
    await expect(verifySlackAuth(verifier)).resolves.toBeUndefined();
  });

  it('throws SlackAuthError(invalid_auth) with actionable hint when token rejected', async () => {
    const slackErr: Error & { code?: string; data?: { error?: string } } = Object.assign(
      new Error('An API error occurred: invalid_auth'),
      { code: 'slack_webapi_platform_error', data: { ok: false, error: 'invalid_auth' } },
    );
    const verifier = makeVerifier(async () => {
      throw slackErr;
    });

    await expect(verifySlackAuth(verifier)).rejects.toMatchObject({
      name: 'SlackAuthError',
      kind: 'invalid_auth',
      slackErrorCode: 'invalid_auth',
    });

    try {
      await verifySlackAuth(verifier);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SlackAuthError);
      expect((err as SlackAuthError).message).toMatch(/SLACK_BOT_TOKEN/);
      expect((err as SlackAuthError).message).toMatch(/xoxb-/);
    }
  });

  it('throws SlackAuthError(other) for non-invalid_auth slack errors', async () => {
    const slackErr: Error & { data?: { error?: string } } = Object.assign(
      new Error('An API error occurred: ratelimited'),
      { data: { ok: false, error: 'ratelimited' } },
    );
    const verifier = makeVerifier(async () => {
      throw slackErr;
    });

    await expect(verifySlackAuth(verifier)).rejects.toMatchObject({
      name: 'SlackAuthError',
      kind: 'other',
      slackErrorCode: 'ratelimited',
    });
  });

  it('throws SlackAuthError(other) when error lacks slack-shaped data', async () => {
    const verifier = makeVerifier(async () => {
      throw new Error('socket hang up');
    });

    await expect(verifySlackAuth(verifier)).rejects.toMatchObject({
      name: 'SlackAuthError',
      kind: 'other',
    });
  });

  it('passes through the verifier exactly once', async () => {
    const test = vi.fn(async () => ({ ok: true }));
    await verifySlackAuth({ test });
    expect(test).toHaveBeenCalledTimes(1);
  });
});
