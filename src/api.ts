import { ArgumentError } from './errors.js';

export const DEFAULT_CDP_URL = 'http://127.0.0.1:9222';
export const DEFAULT_URL_PREFIX = 'https://fmp.semirapp.com';
export const DEFAULT_LOGIN_URL = `${DEFAULT_URL_PREFIX}/web/index#/home/file`;
export const DEFAULT_MOUNT_ID = 2023;
export const DEFAULT_SEARCH_SCOPE = '["filename", "tag"]';

export const RASTER_IMAGE_EXTS = ['jpg', 'png', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff'];
export const SOURCE_IMAGE_EXTS = ['psd', 'ai', 'cdr'];
export const IMAGE_EXTS = [...RASTER_IMAGE_EXTS, ...SOURCE_IMAGE_EXTS];
export const DOCUMENT_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'md'];

export interface ListOptions {
  mountId?: number | string;
  path?: string;
  start?: number | string;
  size?: number | string;
  order?: string;
}

export interface SearchPayloadOptions {
  query: string;
  mountId?: number | string;
  path?: string;
  allMounts?: boolean;
  scope?: string;
  ext?: string;
  start?: number | string;
  size?: number | string;
}

export function normalizePositiveInteger(value: unknown, defaultValue: number, label = 'value'): number {
  const raw = value ?? defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ArgumentError(`${label} must be a positive integer`);
  }
  return n;
}

export function normalizeNonNegativeInteger(value: unknown, defaultValue: number, label = 'value'): number {
  const raw = value ?? defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new ArgumentError(`${label} must be a non-negative integer`);
  }
  return n;
}

export function normalizeLimit(value: unknown, defaultValue: number, maxValue: number, label = 'limit'): number {
  const n = normalizePositiveInteger(value, defaultValue, label);
  if (n > maxValue) throw new ArgumentError(`${label} must be <= ${maxValue}`);
  return n;
}

export function normalizeMountId(value: unknown = DEFAULT_MOUNT_ID): number {
  return normalizePositiveInteger(value, DEFAULT_MOUNT_ID, 'mount');
}

export function parseExtOption(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'image' || normalized === 'images') return IMAGE_EXTS;
  if (normalized === 'raster') return RASTER_IMAGE_EXTS;
  if (normalized === 'source' || normalized === 'sources') return SOURCE_IMAGE_EXTS;
  if (normalized === 'document' || normalized === 'documents' || normalized === 'doc') return DOCUMENT_EXTS;
  return normalized
    .split(',')
    .map((item) => item.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
}

export function buildListParams(options: ListOptions) {
  return {
    order: options.order ?? 'filename asc',
    size: normalizeLimit(options.size, 100, 500, 'size'),
    start: normalizeNonNegativeInteger(options.start, 0, 'start'),
    fullpath: options.path ?? '',
    mount_id: normalizeMountId(options.mountId),
    current: 1
  };
}

export function buildSearchPayload(options: SearchPayloadOptions): Record<string, unknown> {
  const keyword = normalizeKeyword(options.query);
  const payload: Record<string, unknown> = {
    keyword,
    mount_id: options.allMounts ? 0 : normalizeMountId(options.mountId),
    scope: normalizeScope(options.scope),
    start: normalizeNonNegativeInteger(options.start, 0, 'start'),
    size: normalizeLimit(options.size, 100, 500, 'size')
  };
  if (options.path) payload.fullpath = options.path;
  const exts = parseExtOption(options.ext);
  if (exts?.length) payload.ext = JSON.stringify(exts);
  return payload;
}

export function buildInfoParams(options: { mountId?: number | string; path: string; includeUrl?: boolean }) {
  const params: Record<string, unknown> = {
    mount_id: normalizeMountId(options.mountId),
    fullpath: normalizePath(options.path)
  };
  if (options.includeUrl) {
    params.ignores = 'tag,favorite,lock,preview,thumbnail';
  }
  return params;
}

export function buildPreviewParams(options: { mountId?: number | string; path: string }) {
  return {
    mount_id: normalizeMountId(options.mountId),
    fullpath: normalizePath(options.path)
  };
}

export function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    search.set(key, String(value));
  }
  return search.toString();
}

export function normalizeKeyword(value: string): string {
  const keyword = value.trim().replace(/\++/g, '+').replace(/(\+\s|\s\+)/g, ' ').replace(/\s+/g, ' ');
  if (!keyword) throw new ArgumentError('query must not be empty');
  return keyword;
}

export function normalizePath(value: string): string {
  const path = value.trim().replace(/^\/+|\/+$/g, '');
  if (!path) throw new ArgumentError('path must not be empty');
  return path;
}

function normalizeScope(value: string | undefined): string {
  if (!value) return DEFAULT_SEARCH_SCOPE;
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) return trimmed;
  const parts = trimmed.split(',').map((item) => item.trim()).filter(Boolean);
  return JSON.stringify(parts.length ? parts : ['filename', 'tag']);
}
