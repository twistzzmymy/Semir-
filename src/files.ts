import { RASTER_IMAGE_EXTS, SOURCE_IMAGE_EXTS } from './api.js';

export interface CloudFile {
  id: string;
  mountId: number;
  hash: string;
  isDir: boolean;
  fullpath: string;
  filename: string;
  ext: string;
  filesize: number;
  filehash: string;
  createMemberName: string | null;
  createTime: string | null;
  lastMemberName: string | null;
  lastTime: string | null;
  permissions: string[];
  raw: Record<string, unknown>;
}

export interface CloudFileClassification {
  kind: 'folder' | 'image' | 'source' | 'pdf' | 'document' | 'other';
  assetRole: 'styleFolder' | 'packageFolder' | 'packageImage' | 'flatImage' | 'modelImage' | 'creativeImage' | 'sourceFile' | 'specSheet' | 'document' | 'other';
  isImage: boolean;
  isSource: boolean;
  isPackageCandidate: boolean;
  tags: string[];
}

export interface RankedStyleResult {
  file: CloudFile;
  classification: CloudFileClassification;
  score: number;
  reasons: string[];
}

export interface StyleGroup {
  styleNo: string;
  packagePath: string;
  fileCount: number;
  imageCount: number;
  sourceCount: number;
  items: RankedStyleResult[];
}

const PACKAGE_KEYWORDS = ['包装图', '图包', '图库', '图片汇总', '平拍原图', '模拍原图', '创意拍'];
const SOURCE_KEYWORDS = ['源文件', '设计源文件'];
const SPEC_KEYWORDS = ['尺码表', '制单', '规格', 'spec'];

export function normalizeCloudFile(raw: Record<string, unknown>): CloudFile {
  const filename = stringValue(raw.filename);
  const fullpath = stringValue(raw.fullpath || filename);
  const isDir = numberValue(raw.dir) > 0;
  const rawExt = stringValue(raw.ext);
  const ext = isDir ? '' : normalizeExt(rawExt || fileExtension(filename));
  const property = parseProperty(raw.property);
  return {
    id: stringValue(raw.id || raw.hash || fullpath),
    mountId: numberValue(raw.mount_id),
    hash: stringValue(raw.hash),
    isDir,
    fullpath,
    filename,
    ext,
    filesize: numberValue(raw.filesize),
    filehash: stringValue(raw.filehash),
    createMemberName: nullableString(raw.create_member_name),
    createTime: isoFromSeconds(raw.create_dateline),
    lastMemberName: nullableString(raw.last_member_name),
    lastTime: isoFromSeconds(raw.last_dateline),
    permissions: property.permissions,
    raw
  };
}

export function classifyCloudFile(file: CloudFile): CloudFileClassification {
  const path = file.fullpath;
  const tags: string[] = [];
  const isRaster = RASTER_IMAGE_EXTS.includes(file.ext);
  const isSource = SOURCE_IMAGE_EXTS.includes(file.ext);
  const packageMatch = PACKAGE_KEYWORDS.filter((keyword) => path.includes(keyword));
  const sourceMatch = SOURCE_KEYWORDS.filter((keyword) => path.includes(keyword));
  const specMatch = SPEC_KEYWORDS.filter((keyword) => path.toLowerCase().includes(keyword.toLowerCase()));
  tags.push(...packageMatch, ...sourceMatch, ...specMatch);

  if (file.isDir) {
    return {
      kind: 'folder',
      assetRole: packageMatch.length ? 'packageFolder' : 'styleFolder',
      isImage: false,
      isSource: false,
      isPackageCandidate: packageMatch.length > 0 || looksLikeStyleNo(file.filename),
      tags
    };
  }

  if (isSource) {
    return {
      kind: 'source',
      assetRole: 'sourceFile',
      isImage: false,
      isSource: true,
      isPackageCandidate: packageMatch.length > 0 || sourceMatch.length > 0,
      tags
    };
  }

  if (isRaster) {
    return {
      kind: 'image',
      assetRole: imageRole(path),
      isImage: true,
      isSource: false,
      isPackageCandidate: packageMatch.length > 0,
      tags
    };
  }

  if (file.ext === 'pdf') {
    return {
      kind: 'pdf',
      assetRole: specMatch.length ? 'specSheet' : 'document',
      isImage: false,
      isSource: false,
      isPackageCandidate: false,
      tags
    };
  }

  return {
    kind: file.ext ? 'document' : 'other',
    assetRole: file.ext ? 'document' : 'other',
    isImage: false,
    isSource: false,
    isPackageCandidate: false,
    tags
  };
}

export function rankStyleResults(files: CloudFile[], styleNo: string): RankedStyleResult[] {
  const normalizedStyle = styleNo.trim();
  return files
    .map((file) => {
      const classification = classifyCloudFile(file);
      const reasons: string[] = [];
      let score = 0;
      if (file.fullpath.includes(normalizedStyle)) {
        score += 40;
        reasons.push('path contains style number');
      }
      if (file.filename.replace(/\.[^.]+$/, '') === normalizedStyle) {
        score += 40;
        reasons.push('filename exact match');
      }
      if (file.isDir && file.filename === normalizedStyle) {
        score += 160;
        reasons.push('exact style folder');
      }
      if (classification.isPackageCandidate) {
        score += 60;
        reasons.push('package path');
      }
      if (classification.isSource) {
        score += 90;
        reasons.push('source file');
      } else if (classification.isImage) {
        score += 75;
        reasons.push('image');
      } else if (classification.kind === 'pdf') {
        score += 20;
        reasons.push('pdf/spec');
      }
      score += recencyScore(file.lastTime);
      return { file, classification, score, reasons };
    })
    .sort((a, b) => b.score - a.score || a.file.fullpath.localeCompare(b.file.fullpath, 'zh-Hans-CN'));
}

export function groupStyleResults(files: CloudFile[], styleNo: string): StyleGroup[] {
  const groups = new Map<string, RankedStyleResult[]>();
  for (const item of rankStyleResults(files, styleNo)) {
    const key = nearestStyleDirectory(item.file.fullpath, styleNo);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([packagePath, items]) => ({
    styleNo,
    packagePath,
    fileCount: items.length,
    imageCount: items.filter((item) => item.classification.isImage).length,
    sourceCount: items.filter((item) => item.classification.isSource).length,
    items
  }));
}

export function nearestStyleDirectory(fullpath: string, styleNo: string): string {
  const parts = fullpath.split('/').filter(Boolean);
  const last = parts.at(-1) ?? '';
  const searchParts = /\.[^.]+$/.test(last) ? parts.slice(0, -1) : parts;
  const exactIndex = searchParts.lastIndexOf(styleNo);
  if (exactIndex >= 0) return searchParts.slice(0, exactIndex + 1).join('/');
  return searchParts.join('/') || fullpath;
}

function imageRole(path: string): CloudFileClassification['assetRole'] {
  if (path.includes('包装图') || path.includes('图包')) return 'packageImage';
  if (path.includes('模拍')) return 'modelImage';
  if (path.includes('创意拍')) return 'creativeImage';
  if (path.includes('平拍')) return 'flatImage';
  return 'packageImage';
}

function looksLikeStyleNo(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{5,}$/.test(value);
}

function parseProperty(value: unknown): { permissions: string[] } {
  if (!value || typeof value !== 'string') return { permissions: [] };
  try {
    const parsed = JSON.parse(value) as { permissions?: unknown; permisson?: unknown };
    const permissions = Array.isArray(parsed.permissions)
      ? parsed.permissions
      : Array.isArray(parsed.permisson)
        ? parsed.permisson
        : [];
    return { permissions: permissions.map(String) };
  } catch {
    return { permissions: [] };
  }
}

function normalizeExt(value: string): string {
  const ext = value.trim().replace(/^\./, '').toLowerCase();
  return ext === value.trim().toLowerCase() ? ext : ext;
}

function fileExtension(filename: string): string {
  const index = filename.lastIndexOf('.');
  return index > 0 && index < filename.length - 1 ? filename.slice(index + 1) : '';
}

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

function nullableString(value: unknown): string | null {
  const text = stringValue(value).trim();
  return text ? text : null;
}

function numberValue(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isoFromSeconds(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function recencyScore(value: string | null): number {
  if (!value) return 0;
  const year = new Date(value).getUTCFullYear();
  if (!Number.isFinite(year)) return 0;
  return Math.max(0, Math.min(20, year - 2020));
}
