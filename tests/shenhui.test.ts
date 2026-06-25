import { describe, expect, it } from 'vitest';
import { normalizeCloudFile } from '../src/files.js';
import {
  classifyShenhuiAsset,
  deriveBroadSourcePrefix,
  matchesShenhuiAssetItemForCode,
  matchesShenhuiFolderItemForCode,
  normalizeShenhuiSourceTypes
} from '../src/shenhui.js';

describe('Shenhui new-arrival capabilities', () => {
  it('matches style folders and descendant assets when only parent folders contain the code', () => {
    const folder = folderRow('208326105004+AI已回5.27-导购新回齐6.3-已选', '模拍原图/期货/1P/中童/208326105004+AI已回5.27-导购新回齐6.3-已选');
    const image = fileRow('balaBR05106-72904_P.jpg', '模拍原图/期货/1P/中童/208326105004+AI已回5.27-导购新回齐6.3-已选/balaBR05106-72904_P.jpg');

    expect(matchesShenhuiFolderItemForCode(folder, '208326105004')).toBe(true);
    expect(matchesShenhuiAssetItemForCode(image, '208326105004')).toBe(true);
  });

  it('derives the broad source prefix for fallback folder search', () => {
    expect(deriveBroadSourcePrefix('巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/模拍原图/期货/1P/幼童服装', 'model')).toBe(
      '巴拉货控/02 产品上新模块/2-2 巴拉产品上新'
    );
  });

  it('classifies model package assets according to DeepDraw SOP', () => {
    expect(classifyShenhuiAsset('model', fileRow('208226103201包装图.jpg', '模拍原图/208226103201包装图.jpg'))).toMatchObject({
      role: 'skip',
      keep: false,
      action: '已过滤',
      reason: '模特图包包装图按 SOP 删除'
    });

    expect(classifyShenhuiAsset('model', fileRow('m(1).208226169001-00341 (2).jpg', '模拍原图/208226169001/m(1).208226169001-00341 (2).jpg'))).toMatchObject({
      keep: false,
      reason: '模特图包白底图按命名规则删除'
    });

    expect(classifyShenhuiAsset('model', fileRow('balaBR05106-72904_P.jpg', '模拍原图/208226103201/balaBR05106-72904_P.jpg'))).toMatchObject({
      role: 'image',
      keep: true,
      packageFilename: 'balaBR05106-72904_P.jpg'
    });
  });

  it('classifies still package yq and PDF assets according to DeepDraw SOP', () => {
    expect(classifyShenhuiAsset('still', fileRow('NB9A7238.psd', '平拍原图/NB9A7238.psd'))).toMatchObject({
      keep: false,
      reason: '.psd 文件按 SOP 删除'
    });

    expect(classifyShenhuiAsset('still', fileRow('208226103201水洗.jpg', '平拍原图/208226103201水洗.jpg'))).toMatchObject({
      role: 'yq',
      keep: true,
      packageFilename: 'yq.jpg'
    });

    expect(classifyShenhuiAsset('still', fileRow('208226103201吊牌.pdf', '平拍原图/208226103201吊牌.pdf'))).toMatchObject({
      role: 'pdf_yq',
      keep: true,
      packageFilename: '208226103201吊牌.pdf',
      pdfType: 'hang_tag'
    });

    expect(classifyShenhuiAsset('still', fileRow('208226103201尺码表.pdf', '平拍原图/208226103201尺码表.pdf'))).toMatchObject({
      role: 'skip',
      keep: false,
      reason: '非洗唛/吊牌 PDF 按 SOP 跳过'
    });
  });

  it('normalizes selected source types for package planning', () => {
    expect(normalizeShenhuiSourceTypes('')).toEqual(['model', 'still']);
    expect(normalizeShenhuiSourceTypes('model')).toEqual(['model']);
    expect(normalizeShenhuiSourceTypes('still')).toEqual(['still']);
    expect(normalizeShenhuiSourceTypes('unknown')).toEqual(['model', 'still']);
  });
});

function fileRow(filename: string, fullpath: string) {
  return normalizeCloudFile({
    id: filename,
    mount_id: '2023',
    dir: '0',
    filename,
    fullpath,
    ext: filename.split('.').pop()
  });
}

function folderRow(filename: string, fullpath: string) {
  return normalizeCloudFile({
    id: filename,
    mount_id: '2023',
    dir: '1',
    filename,
    fullpath
  });
}
