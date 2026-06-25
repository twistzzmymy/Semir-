import { describe, expect, it } from 'vitest';
import {
  classifyCloudFile,
  groupStyleResults,
  normalizeCloudFile,
  rankStyleResults
} from '../src/files.js';

const rawJpg = {
  id: '5619589',
  mount_id: '2023',
  dir: '0',
  hash: 'bf4675',
  fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/326包装图/新生儿/6.18/208326133201/208326133201.jpg',
  filename: '208326133201.jpg',
  ext: 'jpg',
  filesize: '3910137',
  create_member_name: '丁慕华',
  create_dateline: '1781747168',
  last_member_name: '丁慕华',
  last_dateline: '1781747168',
  property: '{"permisson":["file_history","file_link","file_list","file_preview","file_read"]}'
};

describe('cloud file normalization', () => {
  it('normalizes Semir file rows into stable agent-facing fields', () => {
    const row = normalizeCloudFile(rawJpg);

    expect(row).toMatchObject({
      id: '5619589',
      mountId: 2023,
      isDir: false,
      fullpath: rawJpg.fullpath,
      filename: '208326133201.jpg',
      ext: 'jpg',
      filesize: 3910137,
      createMemberName: '丁慕华',
      lastMemberName: '丁慕华',
      permissions: ['file_history', 'file_link', 'file_list', 'file_preview', 'file_read']
    });
    expect(row.lastTime).toMatch(/^2026-/);
  });

  it('keeps directory ext empty instead of deriving it from the folder name', () => {
    const folder = normalizeCloudFile({
      id: 'folder',
      mount_id: '2023',
      dir: '1',
      fullpath: '巴拉货控',
      filename: '巴拉货控',
      ext: '',
      filesize: '0'
    });

    expect(folder).toMatchObject({ isDir: true, ext: '' });
  });

  it('classifies paths useful for style/package/image workflows', () => {
    expect(classifyCloudFile(normalizeCloudFile(rawJpg))).toMatchObject({
      kind: 'image',
      assetRole: 'packageImage',
      isImage: true,
      isSource: false,
      isPackageCandidate: true
    });

    const psd = normalizeCloudFile({
      ...rawJpg,
      id: '5619628',
      filename: '208326133201.psd',
      fullpath: '巴拉货控/平拍原图/326包装图/208326133201/源文件/208326133201.psd',
      ext: 'psd',
      filesize: '575680653'
    });
    expect(classifyCloudFile(psd)).toMatchObject({
      kind: 'source',
      assetRole: 'sourceFile',
      isImage: false,
      isSource: true
    });
  });
});

describe('style result ranking', () => {
  it('prioritizes exact style folders, package images, source files, then PDFs', () => {
    const rows = [
      normalizeCloudFile({ ...rawJpg, id: 'pdf', filename: '货号208326133201 尺码表.pdf', fullpath: '制单/货号208326133201 尺码表.pdf', ext: 'pdf', filesize: '10' }),
      normalizeCloudFile({ ...rawJpg, id: 'folder', dir: '1', filename: '208326133201', fullpath: '巴拉货控/326包装图/208326133201', ext: '', filesize: '0' }),
      normalizeCloudFile(rawJpg),
      normalizeCloudFile({ ...rawJpg, id: 'psd', filename: '208326133201.psd', fullpath: '巴拉货控/326包装图/208326133201/源文件/208326133201.psd', ext: 'psd', filesize: '20' })
    ];

    const ranked = rankStyleResults(rows, '208326133201');

    expect(ranked.map((r) => r.file.id)).toEqual(['folder', 'psd', '5619589', 'pdf']);
    expect(ranked[0].score).toBeGreaterThan(ranked[3].score);
  });

  it('groups style results by the nearest style/package directory', () => {
    const grouped = groupStyleResults([normalizeCloudFile(rawJpg)], '208326133201');

    expect(grouped).toHaveLength(1);
    expect(grouped[0]).toMatchObject({
      styleNo: '208326133201',
      packagePath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/平拍原图/326包装图/新生儿/6.18/208326133201',
      imageCount: 1,
      sourceCount: 0
    });
  });
});
