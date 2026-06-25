import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FileListResult } from '../src/client.js';
import type { CloudFile } from '../src/files.js';
import { normalizeCloudFile } from '../src/files.js';
import {
  buildRuleImagePlan,
  parseImagePickRules,
  resolveRuleImageFolderPath,
  type RuleImagePlanClient
} from '../src/rule-image-plan.js';

describe('rule-based image planning', () => {
  it('parses compact user rules into labeled filename selectors', () => {
    expect(parseImagePickRules('全身=stem:3-1,静物=stem:{code},细节=glob:特写*')).toEqual([
      { label: '全身', mode: 'stem', pattern: '3-1' },
      { label: '静物', mode: 'stem', pattern: '{code}' },
      { label: '细节', mode: 'glob', pattern: '特写*' }
    ]);
  });

  it('uses an exact code folder path without appending the code again', () => {
    expect(resolveRuleImageFolderPath('01-拍摄企划/AI/103526124101A-80325', '103526124101A-80325')).toBe(
      '01-拍摄企划/AI/103526124101A-80325'
    );
  });

  it('plans images from a code folder using user-specified rules', async () => {
    const client = fakeClient();

    const plan = await buildRuleImagePlan(client, {
      cloudPath: '森马视觉//01-拍摄企划/AI/6-04批次 6 套',
      codes: ['103526124101A-80325'],
      rules: [
        { label: '全身', mode: 'stem', pattern: '3-1' },
        { label: '静物', mode: 'stem', pattern: '{code}' }
      ],
      outputDir: '/tmp/semir',
      includeDownloadUrls: true
    });

    expect(client.listCalls).toEqual([{
      mountId: 3283,
      path: '01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325',
      limit: 200
    }]);
    expect(plan.rows.map((row) => ({
      label: row.ruleLabel,
      filename: row.filename,
      cloudPath: row.cloudPath,
      localFile: row.localFile,
      downloadStatus: row.downloadStatus
    }))).toEqual([
      {
        label: '全身',
        filename: '3-1.jpg',
        cloudPath: '01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325/3-1.jpg',
        localFile: path.join('/tmp/semir', '103526124101A-80325', '3-1.jpg'),
        downloadStatus: '待下载'
      },
      {
        label: '静物',
        filename: '103526124101A-80325.png',
        cloudPath: '01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325/103526124101A-80325.png',
        localFile: path.join('/tmp/semir', '103526124101A-80325', '103526124101A-80325.png'),
        downloadStatus: '待下载'
      }
    ]);
    expect(plan.jobs).toEqual([
      {
        rowIndex: 0,
        url: 'https://download.example/01-%E6%8B%8D%E6%91%84%E4%BC%81%E5%88%92%2FAI%2F6-04%E6%89%B9%E6%AC%A1%206%20%E5%A5%97%2F103526124101A-80325%2F3-1.jpg',
        destination: path.join('/tmp/semir', '103526124101A-80325', '3-1.jpg')
      },
      {
        rowIndex: 1,
        url: 'https://download.example/01-%E6%8B%8D%E6%91%84%E4%BC%81%E5%88%92%2FAI%2F6-04%E6%89%B9%E6%AC%A1%206%20%E5%A5%97%2F103526124101A-80325%2F103526124101A-80325.png',
        destination: path.join('/tmp/semir', '103526124101A-80325', '103526124101A-80325.png')
      }
    ]);
  });

  it('can dry-run without requesting temporary signed URLs', async () => {
    const client = fakeClient();

    const plan = await buildRuleImagePlan(client, {
      cloudPath: '森马视觉//01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325',
      codes: ['103526124101A-80325'],
      rules: parseImagePickRules('全身=3-1,静物={code}'),
      outputDir: '/tmp/semir',
      includeDownloadUrls: false
    });

    expect(client.listCalls).toEqual([{
      mountId: 3283,
      path: '01-拍摄企划/AI/6-04批次 6 套/103526124101A-80325',
      limit: 200
    }]);
    expect(client.downloadUrlCalls).toEqual([]);
    expect(plan.jobs).toEqual([]);
    expect(plan.rows.map((row) => row.downloadStatus)).toEqual(['仅规划', '仅规划']);
  });
});

function fakeClient() {
  const listCalls: unknown[] = [];
  const downloadUrlCalls: string[] = [];
  const client: RuleImagePlanClient & { listCalls: unknown[]; downloadUrlCalls: string[] } = {
    listCalls,
    downloadUrlCalls,
    async resolveMount(mountName: string) {
      expect(mountName).toBe('森马视觉');
      return { mountId: 3283, mountName };
    },
    async list(options): Promise<FileListResult> {
      listCalls.push(options);
      return {
        total: 8,
        count: 8,
        files: [
          image('3-1.jpg', `${options.path}/3-1.jpg`),
          image('3-2.jpg', `${options.path}/3-2.jpg`),
          image('3.jpg', `${options.path}/3.jpg`),
          image('103526124101A-80325.png', `${options.path}/103526124101A-80325.png`),
          image('a.jpg', `${options.path}/a.jpg`),
          image('C23A5761.JPG', `${options.path}/C23A5761.JPG`),
          image('半身2.jpg', `${options.path}/半身2.jpg`),
          image('特写.jpg', `${options.path}/特写.jpg`)
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
