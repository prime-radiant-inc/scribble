import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadSlackPrivateFile } from '../attachmentDownload.js';

describe('downloadSlackPrivateFile', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempPath(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribble-slack-download-'));
    tempDirs.push(dir);
    return path.join(dir, 'attachment.txt');
  }

  it('downloads with Slack bearer auth and writes owner-only files', async () => {
    const savePath = makeTempPath();
    const fetchImpl = vi.fn(async () => new Response('hello from slack', { status: 200 }));

    await downloadSlackPrivateFile(
      'https://files.slack.com/files-pri/T123-F123/download/file.txt',
      'xoxb-secret-token',
      savePath,
      fetchImpl as typeof fetch
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://files.slack.com/files-pri/T123-F123/download/file.txt',
      { headers: { Authorization: 'Bearer xoxb-secret-token' } }
    );
    expect(fs.readFileSync(savePath, 'utf8')).toBe('hello from slack');
    expect(fs.statSync(savePath).mode & 0o777).toBe(0o600);
  });

  it('rejects failed Slack responses without writing the response body', async () => {
    const savePath = makeTempPath();
    const fetchImpl = vi.fn(async () => new Response('private failure body', {
      status: 403,
      statusText: 'Forbidden',
    }));

    await expect(downloadSlackPrivateFile(
      'https://files.slack.com/files-pri/T123-F123/download/file.txt?token=private',
      'xoxb-secret-token',
      savePath,
      fetchImpl as typeof fetch
    )).rejects.toThrow('Slack file download failed: HTTP 403 Forbidden');

    expect(fs.existsSync(savePath)).toBe(false);
  });
});
