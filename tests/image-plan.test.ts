import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FileListResult } from '../src/client.js';
import type { CloudFile } from '../src/files.js';
import { normalizeCloudFile } from '../src/files.js';
import { buildImageDownloadPlan, finalizeImageDownloadRows, type ImagePlanClient } from '../src/image-plan.js';

describe('image download planning', () => {
  it('resolves mount name, searches each code, filters images, and builds download jobs', async () => {
    const client = fakeClient({
      searchRows: [
        image('208226111002-00316.jpg', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/A/208226111002-00316.jpg'),
        image('208226111002.jpg', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/A/208226111002.jpg'),
        image('208226111002-99999.jpg', '巴拉货控/杂七杂八/208226111002-99999.jpg')
      ]
    });

    const plan = await buildImageDownloadPlan(client, {
      cloudPath: '巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新',
      codes: ['208226111002'],
      outputDir: '/tmp/semir',
      includeDownloadUrls: true
    });

    expect(client.searchCalls).toEqual([{ query: '208226111002', mountId: 2023, limit: 500, pageSize: 100, ext: 'image' }]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({
      inputCode: '208226111002',
      matchType: '款号',
      filename: '208226111002-00316.jpg',
      cloudPath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/A/208226111002-00316.jpg',
      downloadStatus: '待下载',
      localFile: path.join('/tmp/semir', '208226111002', '208226111002-00316.jpg')
    });
    expect(plan.jobs).toEqual([{
      rowIndex: 0,
      url: 'https://download.example/%E5%B7%B4%E6%8B%89%E8%B4%A7%E6%8E%A7%2F02%20%E4%BA%A7%E5%93%81%E4%B8%8A%E6%96%B0%E6%A8%A1%E5%9D%97%2F2-2%20%E5%B7%B4%E6%8B%89%E4%BA%A7%E5%93%81%E4%B8%8A%E6%96%B0%2FA%2F208226111002-00316.jpg',
      destination: path.join('/tmp/semir', '208226111002', '208226111002-00316.jpg')
    }]);
  });

  it('can dry-run without requesting temporary signed URLs', async () => {
    const client = fakeClient({
      searchRows: [image('208226111002-00316.jpg', '巴拉货控/A/208226111002-00316.jpg')]
    });

    const plan = await buildImageDownloadPlan(client, {
      cloudPath: '巴拉营运BU-商品//巴拉货控',
      codes: ['208226111002'],
      outputDir: '/tmp/semir',
      includeDownloadUrls: false
    });

    expect(client.downloadUrlCalls).toEqual([]);
    expect(plan.jobs).toEqual([]);
    expect(plan.rows[0].downloadStatus).toBe('仅规划');
  });

  it('records unmatched codes as user-facing rows', async () => {
    const client = fakeClient({ searchRows: [] });

    const plan = await buildImageDownloadPlan(client, {
      cloudPath: '巴拉营运BU-商品//巴拉货控',
      codes: ['208226111002'],
      outputDir: '/tmp/semir',
      includeDownloadUrls: false
    });

    expect(plan.rows).toEqual([expect.objectContaining({
      inputCode: '208226111002',
      downloadStatus: '未匹配到图片',
      note: '搜索结果 0 条，过滤后 0 条'
    })]);
  });

  it('finalizes rows without consuming results for skipped entries', () => {
    const rows = [
      { inputCode: 'missing', matchType: '款号', filename: '', cloudPath: '', downloadStatus: '未匹配到图片', localFile: '', note: 'none' },
      { inputCode: '208226111002', matchType: '款号', filename: 'a.jpg', cloudPath: 'a.jpg', downloadStatus: '待下载', localFile: '/tmp/a.jpg', note: '' }
    ];

    const result = finalizeImageDownloadRows(rows, [{ success: true, path: '/tmp/a.jpg', bytes: 5 }]);

    expect(result[0].downloadStatus).toBe('未匹配到图片');
    expect(result[1]).toMatchObject({ downloadStatus: '已下载', localFile: '/tmp/a.jpg', note: '5 bytes' });
  });
});

function fakeClient(options: { searchRows: CloudFile[] }) {
  const searchCalls: unknown[] = [];
  const downloadUrlCalls: string[] = [];
  const client: ImagePlanClient & { searchCalls: unknown[]; downloadUrlCalls: string[] } = {
    searchCalls,
    downloadUrlCalls,
    async resolveMount(mountName: string) {
      expect(mountName).toBe('巴拉营运BU-商品');
      return { mountId: 2023, mountName };
    },
    async search(searchOptions): Promise<FileListResult> {
      searchCalls.push(searchOptions);
      return { total: options.searchRows.length, count: options.searchRows.length, files: options.searchRows };
    },
    async downloadUrl(options): Promise<string> {
      downloadUrlCalls.push(options.path);
      return `https://download.example/${encodeURIComponent(options.path)}`;
    }
  };
  return client;
}

function image(filename: string, fullpath: string) {
  return normalizeCloudFile({
    id: filename,
    mount_id: '2023',
    dir: '0',
    filename,
    fullpath,
    ext: filename.split('.').pop()
  });
}
