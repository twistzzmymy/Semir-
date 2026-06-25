import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeCloudFile } from '../src/files.js';
import { buildDownloadDestination, downloadUrlToFile } from '../src/download.js';

describe('download helpers', () => {
  it('builds by-code destinations with package filenames when provided', () => {
    const file = normalizeCloudFile({
      id: '1',
      mount_id: '2023',
      dir: '0',
      filename: '208226111002-00316.jpg',
      fullpath: '巴拉货控/A/208226111002-00316.jpg',
      ext: 'jpg'
    });

    expect(buildDownloadDestination({
      outputDir: '/tmp/semir',
      layout: 'by_code',
      code: '208226111002',
      file,
      packageFilename: '208226111002.jpg',
      index: 0
    })).toBe(path.join('/tmp/semir', '208226111002', '208226111002.jpg'));
  });

  it('builds flat destinations with runtime filenames to avoid collisions', () => {
    const file = normalizeCloudFile({
      id: 'id:1',
      mount_id: '2023',
      dir: '0',
      filename: '208226111002-00316.jpg',
      fullpath: '巴拉货控/A/208226111002-00316.jpg',
      ext: 'jpg'
    });

    expect(buildDownloadDestination({
      outputDir: '/tmp/semir',
      layout: 'flat',
      code: '208226111002',
      file,
      index: 0
    })).toBe(path.join('/tmp/semir', '208226111002__id_1__208226111002-00316.jpg'));
  });

  it('downloads a data URL to a local file for deterministic smoke coverage', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'semir-yunpan-download-'));
    const destination = path.join(dir, 'hello.txt');
    try {
      const result = await downloadUrlToFile('data:text/plain;base64,aGVsbG8=', destination);

      expect(result).toEqual({ success: true, path: destination, bytes: 5 });
      await expect(readFile(destination, 'utf8')).resolves.toBe('hello');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
