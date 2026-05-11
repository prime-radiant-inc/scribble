// Pre-flight Slack auth check.
//
// Bolt's App.start() also calls auth.test under the hood, but failures escape
// as raw uncaught exceptions before our main() can intercept them. Calling
// auth.test ourselves first lets us emit a single actionable error line and
// exit cleanly, instead of a Node stack trace.

/** Minimal slice of WebClient.auth used by verifySlackAuth (dependency injection point). */
export interface SlackAuthVerifier {
  test(): Promise<unknown>;
}

export type SlackAuthErrorKind = 'invalid_auth' | 'other';

export class SlackAuthError extends Error {
  readonly kind: SlackAuthErrorKind;
  readonly slackErrorCode?: string;

  constructor(message: string, kind: SlackAuthErrorKind, slackErrorCode?: string) {
    super(message);
    this.name = 'SlackAuthError';
    this.kind = kind;
    this.slackErrorCode = slackErrorCode;
  }
}

function readSlackErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const data = (err as { data?: unknown }).data;
  if (typeof data === 'object' && data !== null) {
    const code = (data as { error?: unknown }).error;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export async function verifySlackAuth(verifier: SlackAuthVerifier): Promise<void> {
  try {
    await verifier.test();
  } catch (err) {
    const slackErrorCode = readSlackErrorCode(err);

    if (slackErrorCode === 'invalid_auth') {
      throw new SlackAuthError(
        'SLACK_BOT_TOKEN was rejected by Slack (invalid_auth). Verify it starts with xoxb-, belongs to the installed Slack app, and has not been revoked. See README "Slack App Setup".',
        'invalid_auth',
        slackErrorCode,
      );
    }

    const detail = slackErrorCode ?? (err instanceof Error ? err.message : String(err));
    throw new SlackAuthError(
      `Slack auth.test failed: ${detail}`,
      'other',
      slackErrorCode,
    );
  }
}
