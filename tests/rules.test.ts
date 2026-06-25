import { describe, expect, it } from 'vitest';
import { normalizeCloudFile } from '../src/files.js';
import {
  buildRuntimeFilename,
  buildSkcCode,
  buildSpuPackageFilename,
  classifyCode,
  filterSearchResults,
  getNew624ImageType,
  matchesMatchBuyImageName,
  normalizeCodes,
  normalizeSkcColorCode,
  parseCloudPath,
  toSafeFilename
} from '../src/rules.js';

describe('crawshrimp-compatible Semir rules', () => {
  it('parses mount-name cloud paths with normalized relative folders', () => {
    const parsed = parseCloudPath('巴拉营运BU-商品//巴拉货控\\02 产品上新模块/2-2 巴拉产品上新/');

    expect(parsed).toEqual({
      mountName: '巴拉营运BU-商品',
      relativePath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新',
      relativePrefix: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/',
      raw: '巴拉营运BU-商品//巴拉货控\\02 产品上新模块/2-2 巴拉产品上新/'
    });
  });

  it('normalizes pasted codes and dedupes while preserving order', () => {
    expect(normalizeCodes('208226111002\n208226111002-00316；208226111002，109526101005-00333')).toEqual([
      '208226111002',
      '208226111002-00316',
      '109526101005-00333'
    ]);
  });

  it('classifies codes and normalizes SKC colors like crawshrimp match-buy', () => {
    expect(classifyCode('208226111002')).toBe('spu');
    expect(classifyCode('208226111002-00316')).toBe('skc');
    expect(normalizeSkcColorCode(333)).toBe('00333');
    expect(buildSkcCode('109526101005', 333)).toBe('109526101005-00333');
    expect(buildSkcCode('109526101101', '109526101101-00510')).toBe('109526101101-00510');
  });

  it('filters SPU searches to in-scope color-code images and dedupes by filename stem', () => {
    const rows = [
      rawImage('208226111002.jpg', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/A/208226111002.jpg'),
      rawImage('208226111002-00316.jpg', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/B/208226111002-00316.jpg'),
      rawImage('208226111002-00316.jpg', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/B2/208226111002-00316.jpg'),
      rawImage('208226111002-60035.jpg', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/B3/208226111002-60035.jpg'),
      rawImage('208226111002_01.jpg', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/C/208226111002_01.jpg'),
      rawImage('208226111002-AI.jpg', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/C3/208226111002-AI.jpg'),
      normalizeCloudFile({ ...rawImage('货号208226111002 尺码表.pdf', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/D/货号208226111002 尺码表.pdf').raw, ext: 'pdf' }),
      normalizeCloudFile({ mount_id: '2023', dir: '1', filename: '208226111002', fullpath: '巴拉货控/02 产品上新模块/2-2 巴拉产品上新/F/208226111002' }),
      rawImage('208226111002-99999.jpg', '巴拉货控/杂七杂八/208226111002-99999.jpg')
    ];

    const result = filterSearchResults(rows, '208226111002', '巴拉货控/02 产品上新模块/2-2 巴拉产品上新');

    expect(result.map((item) => item.filename)).toEqual(['208226111002-00316.jpg', '208226111002-60035.jpg']);
  });

  it('filters SKC searches to exact color-code image stems', () => {
    const rows = [
      rawImage('208226111002-00316.jpg', '巴拉货控/A/208226111002-00316.jpg'),
      rawImage('208226111002-00316-1.jpg', '巴拉货控/B/208226111002-00316-1.jpg'),
      rawImage('208226111002-00316_01.jpg', '巴拉货控/C/208226111002-00316_01.jpg'),
      rawImage('208226111002-003160.jpg', '巴拉货控/D/208226111002-003160.jpg')
    ];

    const result = filterSearchResults(rows, '208226111002-00316', '巴拉货控');

    expect(result.map((item) => item.filename)).toEqual(['208226111002-00316.jpg']);
  });

  it('supports deterministic representative image mode and package filenames', () => {
    const rows = [
      rawImage('208226111002-00316.jpg', '巴拉货控/A/208226111002-00316.jpg'),
      rawImage('208226111002.jpg', '巴拉货控/A/208226111002.jpg'),
      rawImage('208226111002-60035.jpg', '巴拉货控/B/208226111002-60035.jpg')
    ];

    const result = filterSearchResults(rows, '208226111002', '巴拉货控', { spuMatchMode: 'representative' });

    expect(result.map((item) => item.filename)).toEqual(['208226111002-00316.jpg']);
    expect(buildSpuPackageFilename('208226111002', result[0])).toBe('208226111002.jpg');
  });

  it('keeps all duplicate matches when duplicate mode is all', () => {
    const rows = [
      rawImage('208226111002-00316.jpg', '巴拉货控/A/208226111002-00316.jpg'),
      rawImage('208226111002-00316.jpg', '巴拉货控/B/208226111002-00316.jpg')
    ];

    const result = filterSearchResults(rows, '208226111002', '巴拉货控', { duplicateMode: 'all' });

    expect(result.map((item) => item.fullpath)).toEqual([
      '巴拉货控/A/208226111002-00316.jpg',
      '巴拉货控/B/208226111002-00316.jpg'
    ]);
  });

  it('recognizes match-buy and new-624 image naming rules', () => {
    expect(matchesMatchBuyImageName('3 .jpg')).toBe(true);
    expect(matchesMatchBuyImageName('3-12.jpeg')).toBe(true);
    expect(matchesMatchBuyImageName('03.jpg')).toBe(false);
    expect(matchesMatchBuyImageName('4.jpg')).toBe(false);
    expect(getNew624ImageType(rawImage('3-1.jpg', 'AI/109526101005-00333/3-1.jpg'), '109526101005-00333')).toBe('全身');
    expect(getNew624ImageType(rawImage('109526101005-00333.jpg', 'AI/109526101005-00333/109526101005-00333.jpg'), '109526101005-00333')).toBe('静物');
  });

  it('builds safe runtime filenames for direct downloads', () => {
    const file = rawImage('208226111002-00316.JPG', '巴拉货控/A/208226111002-00316.JPG', { id: 'abc/def' });

    expect(toSafeFilename('bad/name:*')).toBe('bad_name');
    expect(buildRuntimeFilename('208226111002', file, 0)).toBe('208226111002__abc_def__208226111002-00316.jpg');
  });
});

function rawImage(filename: string, fullpath: string, extra: Record<string, unknown> = {}) {
  return normalizeCloudFile({
    id: filename,
    mount_id: '2023',
    dir: '0',
    filename,
    fullpath,
    ext: filename.split('.').pop(),
    filesize: '10',
    ...extra
  });
}
