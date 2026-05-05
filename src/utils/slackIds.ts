// Slack warns that object identifiers can grow, so keep the cap generous while
// still bounding path component size for defensive filesystem use.
const SLACK_CHANNEL_ID = /^[CDG][A-Z0-9]{8,31}$/;
const SLACK_THREAD_TS = /^\d+\.\d+$/;

export function isValidSlackChannelId(id: string): boolean {
  return SLACK_CHANNEL_ID.test(id);
}

export function isValidSlackThreadTs(ts: string): boolean {
  return SLACK_THREAD_TS.test(ts);
}
