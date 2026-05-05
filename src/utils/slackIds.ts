const SLACK_CHANNEL_ID = /^[CDG][A-Z0-9]{8,20}$/;
const SLACK_THREAD_TS = /^\d+\.\d+$/;

export function isValidSlackChannelId(id: string): boolean {
  return SLACK_CHANNEL_ID.test(id);
}

export function isValidSlackThreadTs(ts: string): boolean {
  return SLACK_THREAD_TS.test(ts);
}
