import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCatalogDownloadPlan,
  finalizeCatalogDownloadRows,
  type CatalogDownloadInputRow
} from '../src/catalog-download.js';

describe('catalog batch download planning', () => {
  it('builds download jobs from selected inspected rows with temporary URLs', () => {
    const rows: CatalogDownloadInputRow[] = [
      row({ filename: '3-1.jpg', selected: true, matchedRules: ['全身'], downloadUrl: 'https://download.example/3-1.jpg' }),
      row({ filename: '3-2.jpg', selected: false, matchedRules: [], downloadUrl: 'https://download.example/3-2.jpg' })
    ];

    const plan = buildCatalogDownloadPlan(rows, {
      outputDir: '/tmp/semir',
      selectedOnly: true
    });

    expect(plan.rows).toEqual([
      expect.objectContaining({
        inputCode: '103526124101A-80325',
        filename: '3-1.jpg',
        matchedRules: ['全身'],
        downloadStatus: '待下载',
        localFile: path.join('/tmp/semir', '103526124101A-80325', '3-1.jpg')
      })
    ]);
    expect(plan.jobs).toEqual([{
      rowIndex: 0,
      url: 'https://download.example/3-1.jpg',
      destination: path.join('/tmp/semir', '103526124101A-80325', '3-1.jpg')
    }]);
  });

  it('reports missing URLs instead of creating invalid jobs', () => {
    const plan = buildCatalogDownloadPlan([row({ filename: '3-1.jpg', selected: true })], {
      outputDir: '/tmp/semir',
      selectedOnly: true
    });

    expect(plan.jobs).toEqual([]);
    expect(plan.rows[0]).toMatchObject({
      downloadStatus: '缺少下载链接',
      note: '请先用 inspect-images --include-download-urls 输出临时下载链接，或直接用 download-catalog 的路径参数模式'
    });
  });

  it('finalizes rows without consuming results for skipped rows', () => {
    const rows = [
      { inputCode: 'missing', filename: 'x.jpg', cloudPath: '', downloadStatus: '缺少下载链接', localFile: '', note: '', matchedRules: [] },
      { inputCode: '103526124101A-80325', filename: '3-1.jpg', cloudPath: 'folder/3-1.jpg', downloadStatus: '待下载', localFile: '/tmp/3-1.jpg', note: '', matchedRules: ['全身'] }
    ];

    const result = finalizeCatalogDownloadRows(rows, [{ success: true, path: '/tmp/3-1.jpg', bytes: 5 }]);

    expect(result[0].downloadStatus).toBe('缺少下载链接');
    expect(result[1]).toMatchObject({ downloadStatus: '已下载', localFile: '/tmp/3-1.jpg', note: '5 bytes' });
  });
});

function row(overrides: Partial<CatalogDownloadInputRow> = {}): CatalogDownloadInputRow {
  return {
    inputCode: '103526124101A-80325',
    folderPath: 'folder/103526124101A-80325',
    filename: '3-1.jpg',
    cloudPath: 'folder/103526124101A-80325/3-1.jpg',
    selected: true,
    matchedRules: [],
    ...overrides
  };
}
