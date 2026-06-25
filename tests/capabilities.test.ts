import { describe, expect, it } from 'vitest';
import { listCapabilities, runCapability } from '../src/capabilities.js';
import { normalizeCloudFile } from '../src/files.js';

describe('capability registry', () => {
  it('lists atomic capabilities for agent composition', () => {
    const names = listCapabilities().map((capability) => capability.name);

    expect(names).toEqual(expect.arrayContaining([
      'session.probe',
      'path.parse',
      'codes.normalize',
      'mount.resolve',
      'images.inspect',
      'files.search',
      'files.info',
      'urls.download',
      'downloads.plan-images',
      'downloads.plan-by-rules',
      'downloads.plan-catalog',
      'shenhui.classify-asset',
      'shenhui.plan-package'
    ]));
  });

  it('runs pure capabilities without a browser client', async () => {
    await expect(runCapability('path.parse', {
      cloudPath: '巴拉营运BU-商品//巴拉货控/02 产品上新模块/'
    })).resolves.toMatchObject({
      capability: 'path.parse',
      ok: true,
      data: {
        mountName: '巴拉营运BU-商品',
        relativePath: '巴拉货控/02 产品上新模块'
      }
    });

    await expect(runCapability('codes.normalize', {
      codes: '208226111002，208226111002-00316；208226111002'
    })).resolves.toMatchObject({
      ok: true,
      data: { codes: ['208226111002', '208226111002-00316'] }
    });
  });

  it('runs client-backed capabilities through the supplied context', async () => {
    const client = {
      async resolveMount(mountName: string) {
        return { mountId: 2023, mountName };
      },
      async list(options: { path: string }) {
        return {
          total: 2,
          count: 2,
          files: [
            normalizeCloudFile({ mount_id: '2023', dir: '0', filename: '3-1.jpg', fullpath: `${options.path}/3-1.jpg`, ext: 'jpg' }),
            normalizeCloudFile({ mount_id: '2023', dir: '0', filename: '103526124101A-80325.png', fullpath: `${options.path}/103526124101A-80325.png`, ext: 'png' })
          ]
        };
      },
      async downloadUrl(options: { path: string }) {
        return `https://download.example/${encodeURIComponent(options.path)}`;
      },
      async search() {
        return { total: 0, count: 0, files: [] };
      }
    };

    await expect(runCapability('mount.resolve', { mountName: '巴拉营运BU-商品' }, { client })).resolves.toMatchObject({
      ok: true,
      data: { mountId: 2023, mountName: '巴拉营运BU-商品' }
    });

    await expect(runCapability('downloads.plan-by-rules', {
      cloudPath: '巴拉营运BU-商品//AI',
      codes: ['103526124101A-80325'],
      rules: '全身=3-1,静物={code}',
      includeDownloadUrls: false
    }, { client })).resolves.toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({ ruleLabel: '全身', filename: '3-1.jpg' }),
          expect.objectContaining({ ruleLabel: '静物', filename: '103526124101A-80325.png' })
        ],
        jobs: []
      }
    });

    await expect(runCapability('images.inspect', {
      cloudPath: '巴拉营运BU-商品//AI/103526124101A-80325',
      codes: ['103526124101A-80325'],
      rules: '全身=3-1,静物={code}',
      includeDownloadUrls: true
    }, { client })).resolves.toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({ filename: '3-1.jpg', selected: true, matchedRules: ['全身'], downloadUrl: expect.stringMatching(/^https:\/\/download\.example/) }),
          expect.objectContaining({ filename: '103526124101A-80325.png', selected: true, matchedRules: ['静物'], downloadUrl: expect.stringMatching(/^https:\/\/download\.example/) })
        ]
      }
    });

    await expect(runCapability('downloads.plan-catalog', {
      rows: [
        {
          inputCode: '103526124101A-80325',
          filename: '3-1.jpg',
          cloudPath: 'AI/103526124101A-80325/3-1.jpg',
          selected: true,
          matchedRules: ['全身'],
          downloadUrl: 'https://download.example/3-1.jpg'
        }
      ],
      outputDir: '/tmp/semir',
      selectedOnly: true
    })).resolves.toMatchObject({
      ok: true,
      data: {
        rows: [
          expect.objectContaining({ filename: '3-1.jpg', downloadStatus: '待下载' })
        ],
        jobs: [
          expect.objectContaining({ url: 'https://download.example/3-1.jpg' })
        ]
      }
    });
  });

  it('returns a structured unknown-capability result', async () => {
    await expect(runCapability('missing.capability', {})).resolves.toMatchObject({
      ok: false,
      capability: 'missing.capability',
      error: expect.stringMatching(/Unknown capability/)
    });
  });
});
