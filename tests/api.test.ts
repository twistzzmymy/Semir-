import { describe, expect, it } from 'vitest';
import {
  IMAGE_EXTS,
  buildListParams,
  buildSearchPayload,
  normalizeLimit,
  parseExtOption
} from '../src/api.js';

describe('api request helpers', () => {
  it('builds file list params with the observed Semir cloud drive defaults', () => {
    expect(buildListParams({ mountId: 2023, path: '巴拉货控', start: 0, size: 50 })).toEqual({
      order: 'filename asc',
      size: 50,
      start: 0,
      fullpath: '巴拉货控',
      mount_id: 2023,
      current: 1
    });
  });

  it('builds search payload with filename/tag scope by default', () => {
    expect(buildSearchPayload({ query: ' 208326133201 ', mountId: 2023, start: 5, size: 10 })).toEqual({
      keyword: '208326133201',
      mount_id: 2023,
      scope: '["filename", "tag"]',
      start: 5,
      size: 10
    });
  });

  it('supports folder scoped image searches', () => {
    expect(buildSearchPayload({
      query: '208326133201',
      mountId: 2023,
      path: '巴拉货控/02 产品上新模块',
      ext: 'image',
      start: 0,
      size: 20
    })).toMatchObject({
      keyword: '208326133201',
      mount_id: 2023,
      fullpath: '巴拉货控/02 产品上新模块',
      ext: JSON.stringify(IMAGE_EXTS)
    });
  });

  it('normalizes explicit ext lists and rejects invalid limits', () => {
    expect(parseExtOption('jpg, png,.psd')).toEqual(['jpg', 'png', 'psd']);
    expect(normalizeLimit('25', 20, 100)).toBe(25);
    expect(() => normalizeLimit('0', 20, 100)).toThrow(/positive integer/);
    expect(() => normalizeLimit('101', 20, 100)).toThrow(/<= 100/);
  });
});
