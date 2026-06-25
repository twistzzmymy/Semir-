import { describe, expect, it } from 'vitest';
import type { FileListResult } from '../src/client.js';
import { normalizeCloudFile, type CloudFile } from '../src/files.js';
import { buildShenhuiPackagePlan, type ShenhuiPlanClient } from '../src/shenhui-plan.js';

describe('Shenhui package planning', () => {
  it('plans only selected source types and applies SOP classification', async () => {
    const client = fakeClient();

    const plan = await buildShenhuiPackagePlan(client, {
      codes: ['208226103201'],
      modelCloudPath: '巴拉营运BU-商品//模拍原图',
      stillCloudPath: '巴拉营运BU-商品//平拍原图',
      sourceTypes: ['still'],
      folderScanDepth: 1,
      includeDownloadUrls: true
    });

    expect(client.searchCalls).toEqual([{ query: '208226103201', mountId: 2023, limit: 500, pageSize: 100 }]);
    expect(client.listCalls).toEqual([{ mountId: 2023, path: '平拍原图/208226103201--静物', limit: 200 }]);
    expect(plan.rows.map((row) => row.sourceLabel)).toEqual(['静物图', '静物图', '静物图']);
    expect(plan.rows.map((row) => row.action)).toEqual(['保留静物图', '已过滤', '保留并命名为yq']);
    expect(plan.jobs).toEqual([
      {
        rowIndex: 0,
        url: 'https://download.example/%E5%B9%B3%E6%8B%8D%E5%8E%9F%E5%9B%BE%2F208226103201--%E9%9D%99%E7%89%A9%2Fstill-main.jpg',
        filename: '208226103201__still__still-main__still-main.jpg'
      },
      {
        rowIndex: 2,
        url: 'https://download.example/%E5%B9%B3%E6%8B%8D%E5%8E%9F%E5%9B%BE%2F208226103201--%E9%9D%99%E7%89%A9%2F208226103201%E6%B0%B4%E6%B4%97.jpg',
        filename: '208226103201__still__208226103201水洗__208226103201水洗.jpg'
      }
    ]);
  });

  it('can dry-run without requesting signed download URLs', async () => {
    const client = fakeClient();

    const plan = await buildShenhuiPackagePlan(client, {
      codes: ['208226103201'],
      stillCloudPath: '巴拉营运BU-商品//平拍原图',
      sourceTypes: ['still'],
      includeDownloadUrls: false
    });

    expect(client.downloadUrlCalls).toEqual([]);
    expect(plan.jobs).toEqual([]);
    expect(plan.rows[0].downloadStatus).toBe('仅规划');
  });
});

function fakeClient() {
  const searchCalls: unknown[] = [];
  const listCalls: unknown[] = [];
  const downloadUrlCalls: string[] = [];
  const client: ShenhuiPlanClient & { searchCalls: unknown[]; listCalls: unknown[]; downloadUrlCalls: string[] } = {
    searchCalls,
    listCalls,
    downloadUrlCalls,
    async resolveMount(mountName: string) {
      expect(mountName).toBe('巴拉营运BU-商品');
      return { mountId: 2023, mountName };
    },
    async search(options): Promise<FileListResult> {
      searchCalls.push(options);
      return {
        total: 2,
        count: 2,
        files: [
          folder('208226103201--模特', '模拍原图/208226103201--模特'),
          folder('208226103201--静物', '平拍原图/208226103201--静物')
        ]
      };
    },
    async list(options): Promise<FileListResult> {
      listCalls.push(options);
      return {
        total: 3,
        count: 3,
        files: [
          file('still-main.jpg', '平拍原图/208226103201--静物/still-main.jpg'),
          file('NB9A7238.psd', '平拍原图/208226103201--静物/NB9A7238.psd'),
          file('208226103201水洗.jpg', '平拍原图/208226103201--静物/208226103201水洗.jpg')
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

function file(filename: string, fullpath: string): CloudFile {
  return normalizeCloudFile({
    id: filename,
    mount_id: '2023',
    dir: '0',
    filename,
    fullpath,
    ext: filename.split('.').pop()
  });
}

function folder(filename: string, fullpath: string): CloudFile {
  return normalizeCloudFile({
    id: filename,
    mount_id: '2023',
    dir: '1',
    filename,
    fullpath
  });
}
