import { describe, expect, it } from 'vitest';
import type { FileListResult } from '../src/client.js';
import type { CloudFile } from '../src/files.js';
import { normalizeCloudFile } from '../src/files.js';
import {
  buildImageCatalog,
  parseFolderPickRule,
  type ImageCatalogClient
} from '../src/image-catalog.js';

describe('image catalog inspection', () => {
  it('parses folder rules for locating code folders inside a cloud path', () => {
    expect(parseFolderPickRule('name:{code}')).toEqual({ mode: 'name', pattern: '{code}' });
    expect(parseFolderPickRule('glob:*{code}*')).toEqual({ mode: 'glob', pattern: '*{code}*' });
  });

  it('finds a code folder, lists all images, and marks user-rule matches', async () => {
    const client = fakeClient();

    const catalog = await buildImageCatalog(client, {
      cloudPath: '森马视觉//01-拍摄企划/AI/6-04批次 6 套',
      codes: ['103526124101A-80325'],
      folderRule: 'name:{code}',
      rules: '全身=3-1,静物={code}'
    });

    expect(client.searchCalls).toEqual([{
      query: '103526124101A-80325',
      mountId: 3283,
      path: '01-拍摄企划/AI/6-04批次 6 套',
      limit: 100,
      pageSize: 100
    }]);
    expect(client.listCalls).toEqual([{
      mountId: 3283,
      path: '01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325',
      limit: 500
    }]);
    expect(catalog.folders).toEqual([{
      inputCode: '103526124101A-80325',
      folderPath: '01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325',
      source: 'search'
    }]);
    expect(catalog.rows.map((row) => ({
      filename: row.filename,
      selected: row.selected,
      matchedRules: row.matchedRules,
      cloudPath: row.cloudPath
    }))).toEqual([
      {
        filename: '3-1.jpg',
        selected: true,
        matchedRules: ['全身'],
        cloudPath: '01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325/3-1.jpg'
      },
      {
        filename: '3-2.jpg',
        selected: false,
        matchedRules: [],
        cloudPath: '01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325/3-2.jpg'
      },
      {
        filename: '103526124101A-80325.png',
        selected: true,
        matchedRules: ['静物'],
        cloudPath: '01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325/103526124101A-80325.png'
      }
    ]);
  });

  it('uses an exact code folder directly instead of searching again', async () => {
    const client = fakeClient();

    const catalog = await buildImageCatalog(client, {
      cloudPath: '森马视觉//01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325',
      codes: ['103526124101A-80325'],
      rules: '全身=3-1'
    });

    expect(client.searchCalls).toEqual([]);
    expect(client.listCalls[0]).toMatchObject({
      path: '01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325'
    });
    expect(catalog.folders[0]).toMatchObject({ source: 'exact' });
  });

  it('adds temporary download URLs only when explicitly requested', async () => {
    const client = fakeClient();

    const catalog = await buildImageCatalog(client, {
      cloudPath: '森马视觉//01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325',
      codes: ['103526124101A-80325'],
      rules: '全身=3-1',
      selectedOnly: true,
      includeDownloadUrls: true
    });

    expect(client.downloadUrlCalls).toEqual(['01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325/3-1.jpg']);
    expect(catalog.rows).toEqual([
      expect.objectContaining({
        filename: '3-1.jpg',
        downloadUrl: 'https://download.example/01-%E6%8B%8D%E6%91%84%E4%BC%81%E5%88%92%2FAI%2F6-04%E6%89%B9%E6%AC%A1%206%20%E5%A5%97%2F103526124101A-80325%2F3-1.jpg'
      })
    ]);
  });
});

function fakeClient() {
  const searchCalls: unknown[] = [];
  const listCalls: unknown[] = [];
  const downloadUrlCalls: string[] = [];
  const client: ImageCatalogClient & { searchCalls: unknown[]; listCalls: unknown[]; downloadUrlCalls: string[] } = {
    searchCalls,
    listCalls,
    downloadUrlCalls,
    async resolveMount(mountName: string) {
      expect(mountName).toBe('森马视觉');
      return { mountId: 3283, mountName };
    },
    async search(options): Promise<FileListResult> {
      searchCalls.push(options);
      return {
        total: 2,
        count: 2,
        files: [
          folder('103526124101A-80325', '01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325'),
          image('103526124101A-80325.png', '01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325.png')
        ]
      };
    },
    async list(options): Promise<FileListResult> {
      listCalls.push(options);
      return {
        total: 3,
        count: 3,
        files: [
          image('3-1.jpg', `${options.path}/3-1.jpg`),
          image('3-2.jpg', `${options.path}/3-2.jpg`),
          image('103526124101A-80325.png', `${options.path}/103526124101A-80325.png`)
        ]
      };
    },
    async downloadUrl(options): Promise<string> {
      downloadUrlCalls.push(options.path);
      return `https://download.example/${encodeURIComponent(options.path)}`;
    }
  };
  return client;
}

function image(filename: string, fullpath: string): CloudFile {
  return normalizeCloudFile({
    id: filename,
    mount_id: '3283',
    dir: '0',
    filename,
    fullpath,
    ext: filename.split('.').pop()
  });
}

function folder(filename: string, fullpath: string): CloudFile {
  return normalizeCloudFile({
    id: filename,
    mount_id: '3283',
    dir: '1',
    filename,
    fullpath
  });
}
