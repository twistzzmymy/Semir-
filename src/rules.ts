import { RASTER_IMAGE_EXTS } from './api.js';
import type { CloudFile } from './files.js';

export type CodeType = 'spu' | 'skc';
export type DuplicateMode = 'first_per_stem' | 'all';
export type SpuMatchMode = 'color_skc_all' | 'representative';
export type New624ImageType = '' | '全身' | '静物';

export interface ParsedCloudPath {
  mountName: string;
  relativePath: string;
  relativePrefix: string;
  raw: string;
}

export interface FilterSearchOptions {
  duplicateMode?: string;
  spuMatchMode?: string;
}

export function compact(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function parseCloudPath(rawValue: unknown): ParsedCloudPath {
  const raw = String(rawValue ?? '').trim();
  if (!raw) throw new Error('请填写云盘路径');

  const divider = raw.indexOf('//');
  if (divider < 0) throw new Error('云盘路径格式不正确，需要使用“挂载点//目录/子目录”');

  const mountName = compact(raw.slice(0, divider));
  const relativeRaw = raw.slice(divider + 2).replace(/\\/g, '/');
  const relativePath = relativeRaw.split('/').map(compact).filter(Boolean).join('/');
  if (!mountName) throw new Error('云盘路径缺少挂载点名称');

  return {
    mountName,
    relativePath,
    relativePrefix: relativePath ? `${relativePath}/` : '',
    raw
  };
}

export function normalizeCodes(rawValue: unknown): string[] {
  const text = String(rawValue ?? '').replace(/[，、；;]/g, '\n');
  const result: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const value = compact(line);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function classifyCode(code: unknown): CodeType {
  return String(code ?? '').includes('-') ? 'skc' : 'spu';
}

export function normalizeDuplicateMode(rawValue: unknown): DuplicateMode {
  return compact(rawValue).toLowerCase() === 'all' ? 'all' : 'first_per_stem';
}

export function normalizeSpuMatchMode(rawValue: unknown): SpuMatchMode {
  return compact(rawValue).toLowerCase() === 'representative' ? 'representative' : 'color_skc_all';
}

export function normalizeSkcColorCode(colorCode: unknown): string {
  const color = compact(colorCode);
  if (/^\d{1,4}$/.test(color)) return color.padStart(5, '0');
  return color;
}

export function buildSkcCode(styleCode: unknown, colorCode: unknown): string {
  const style = compact(styleCode);
  const color = normalizeSkcColorCode(colorCode);
  if (!style || !color) return style || color;
  if (startsWithCodeToken(color, style)) return color;
  return `${style}-${color}`;
}

export function getFileStem(filename: unknown): string {
  const name = String(filename ?? '').trim();
  if (!name) return '';
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(0, index) : name;
}

export function getExt(itemOrFilename: CloudFile | string | unknown): string {
  if (itemOrFilename && typeof itemOrFilename === 'object') {
    const file = itemOrFilename as { ext?: unknown; filename?: unknown };
    const explicit = String(file.ext ?? '').trim().replace(/^\./, '').toLowerCase();
    if (explicit) return explicit;
    return getExt(file.filename);
  }
  const name = String(itemOrFilename ?? '').trim();
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).trim().replace(/^\./, '').toLowerCase() : '';
}

export function isImageFile(file: CloudFile): boolean {
  return !file.isDir && RASTER_IMAGE_EXTS.includes(getExt(file));
}

export function escapeRegExp(value: unknown): string {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isSkcLikeStemForSpu(stem: unknown, code: unknown): boolean {
  const target = compact(code);
  if (!target) return false;
  return new RegExp(`^${escapeRegExp(target)}-\\d{5}$`, 'i').test(compact(stem));
}

export function matchesCode(filename: unknown, code: unknown): boolean {
  const stem = getFileStem(filename);
  const target = compact(code);
  if (!stem || !target) return false;

  if (classifyCode(target) === 'skc') {
    return stem.toLowerCase() === target.toLowerCase();
  }
  return isSkcLikeStemForSpu(stem, target);
}

export function isWithinRelativePath(fullpath: unknown, relativePath: unknown): boolean {
  const target = String(relativePath ?? '').trim();
  if (!target) return true;
  const normalized = String(fullpath ?? '').replace(/\\/g, '/');
  return normalized === target || normalized.startsWith(`${target}/`);
}

export function filterSearchResults(files: CloudFile[], code: string, relativePath: string, options: FilterSearchOptions = {}): CloudFile[] {
  const scoped = (Array.isArray(files) ? files : [])
    .filter(isImageFile)
    .filter((file) => isWithinRelativePath(file.fullpath, relativePath));

  if (classifyCode(code) === 'spu' && normalizeSpuMatchMode(options.spuMatchMode) === 'representative') {
    return pickRepresentativeSpuItem(scoped, code);
  }

  const matched = scoped.filter((file) => matchesCode(file.filename, code));
  return dedupeMatchedItems(matched, options.duplicateMode);
}

export function pickRepresentativeSpuItem(files: CloudFile[], code: string): CloudFile[] {
  const candidates = (Array.isArray(files) ? files : [])
    .filter((file) => isSkcLikeStemForSpu(getFileStem(file.filename), code));
  return candidates.length ? [candidates[0]] : [];
}

export function dedupeMatchedItems(files: CloudFile[], duplicateMode: unknown): CloudFile[] {
  if (normalizeDuplicateMode(duplicateMode) === 'all') return Array.isArray(files) ? [...files] : [];

  const result: CloudFile[] = [];
  const seen = new Set<string>();
  for (const file of Array.isArray(files) ? files : []) {
    const key = (getFileStem(file.filename) || file.filename).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(file);
  }
  return result;
}

export function toSafeFilename(value: unknown, fallback = 'file'): string {
  const text = String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^_+|_+$/g, '');
  return text || fallback;
}

export function buildRuntimeFilename(code: string, file: CloudFile, index: number): string {
  const ext = getExt(file) || 'jpg';
  const suffix = `.${ext}`;
  const itemId = String(file.id || file.hash || file.filehash || index + 1);
  const stem = toSafeFilename(`${toSafeFilename(code, 'code')}__${toSafeFilename(itemId)}__${getFileStem(file.filename)}`, 'download');
  return stem.toLowerCase().endsWith(suffix.toLowerCase()) ? stem : `${stem}${suffix}`;
}

export function buildSpuPackageFilename(code: string, file: CloudFile): string {
  const ext = getExt(file);
  const safeCode = toSafeFilename(code, 'code');
  return ext ? `${safeCode}.${ext}` : safeCode;
}

export function pathSegments(fullpath: unknown): string[] {
  return String(fullpath ?? '').replace(/\\/g, '/').split('/').map(compact).filter(Boolean);
}

export function startsWithCodeToken(value: unknown, code: unknown): boolean {
  const text = compact(value).toLowerCase();
  const target = compact(code).toLowerCase();
  if (!text || !target) return false;
  return new RegExp(`^${escapeRegExp(target)}(?:$|[\\s_\\-])`, 'i').test(text);
}

export function matchesMatchBuyImageName(filename: unknown): boolean {
  const stem = compact(getFileStem(filename));
  return /^3(?:-\d+)?$/.test(stem);
}

export function getFolderCodeFromItem(file: CloudFile): string {
  const segments = pathSegments(file.fullpath || file.filename);
  if (!segments.length) return '';
  return isImageFile(file) && segments.length >= 2 ? segments[segments.length - 2] : segments[segments.length - 1];
}

export function getNew624ImageType(file: CloudFile, packageCode?: string): New624ImageType {
  const stem = compact(getFileStem(file.filename)).toLowerCase();
  const code = compact(packageCode || getFolderCodeFromItem(file)).toLowerCase();
  if (stem === '3-1') return '全身';
  if (code && stem === code) return '静物';
  return '';
}

export function matchesNew624ImageName(file: CloudFile, packageCode?: string): boolean {
  return !!getNew624ImageType(file, packageCode);
}
