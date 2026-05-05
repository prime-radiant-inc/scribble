import * as fs from 'node:fs';

export const PRIVATE_SLACK_FILE_URL_PLACEHOLDER = '[private-slack-file-url]';

export async function downloadSlackPrivateFile(
  url: string,
  botToken: string,
  savePath: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  });

  if (!response.ok) {
    const statusText = response.statusText ? ` ${response.statusText}` : '';
    throw new Error(`Slack file download failed: HTTP ${response.status}${statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(savePath, buffer, { mode: 0o600 });
}
