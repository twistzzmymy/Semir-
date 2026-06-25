import { EmptyResultError } from './errors.js';
import type { CloudFile } from './files.js';
import type { FileListResult } from './client.js';
import { parseImagePickRules, matchesPickRule, type ImagePickRule } from './rule-image-plan.js';
import {
  compact,
  escapeRegExp,
  isImageFile,
  parseCloudPath,
  pathSegments
} from './rules.js';

export type FolderPickRuleMode = 'name' | 'path' | 'glob' | 'regex';
export type FolderSource = 'exact' | 'search' | 'fallback';

export interface FolderPickRule {
  mode: FolderPickRuleMode;
  pattern: string;
}

export interface ImageCatalogClient {
  resolveMount(mountName: string): Promise<{ mountId: number; mountName: string }>;
  search(options: { query: string; mountId: number; path?: string; limit: number; pageSize: number }): Promise<FileListResult>;
  list(options: { mountId: number; path: string; limit: number }): Promise<FileListResult>;
  downloadUrl?(options: { mountId: number; path: string }): Promise<string>;
}

export interface ImageCatalogOptions {
  cloudPath: string;
  codes: string[];
  folderRule?: string | FolderPickRule;
  rules?: string | ImagePickRule[];
  searchLimit?: number;
  listLimit?: number;
  selectedOnly?: boolean;
  includeDownloadUrls?: boolean;
}

export interface ImageFolderCandidate {
  inputCode: string;
  folderPath: string;
  source: FolderSource;
}

export interface ImageCatalogRow {
  inputCode: string;
  folderPath: string;
  filename: string;
  cloudPath: string;
  ext: string;
  filesize: number;
  selected: boolean;
  matchedRules: string[];
  status: string;
  note: string;
  downloadUrl?: string;
  mountId?: number;
  mountName?: string;
}

export interface ImageCatalog {
  mountId: number;
  mountName: string;
  relativePath: string;
  folders: ImageFolderCandidate[];
  rows: ImageCatalogRow[];
}

export function parseFolderPickRule(rawValue: unknown): FolderPickRule {
  if (rawValue && typeof rawValue === 'object') {
    const raw = rawValue as { mode?: unknown; pattern?: unknown; name?: unknown; path?: unknown; glob?: unknown; regex?: unknown };
    if (raw.name !== undefined) return { mode: 'name', pattern: compact(raw.name) };
    if (raw.path !== undefined) return { mode: 'path', pattern: compact(raw.path) };
    if (raw.glob !== undefined) return { mode: 'glob', pattern: compact(raw.glob) };
    if (raw.regex !== undefined) return { mode: 'regex', pattern: compact(raw.regex) };
    const mode = compact(raw.mode).toLowerCase();
    const pattern = compact(raw.pattern);
    if (['name', 'path', 'glob', 'regex'].includes(mode)) return { mode: mode as FolderPickRuleMode, pattern };
    return parseFolderPickRule(pattern);
  }

  const raw = compact(rawValue || 'name:{code}');
  const match = /^(name|path|glob|regex):(.*)$/i.exec(raw);
  if (match) return { mode: match[1].toLowerCase() as FolderPickRuleMode, pattern: compact(match[2]) };
  if (/[*?[\]]/.test(raw)) return { mode: 'glob', pattern: raw };
  return { mode: 'name', pattern: raw || '{code}' };
}

export async function buildImageCatalog(client: ImageCatalogClient, options: ImageCatalogOptions): Promise<ImageCatalog> {
  const parsed = parseCloudPath(options.cloudPath);
  const mount = await client.resolveMount(parsed.mountName);
  const folderRule = parseFolderPickRule(options.folderRule);
  const rules = parseImagePickRules(options.rules ?? '');
  const searchLimit = Math.max(1, Math.min(1000, Math.floor(Number(options.searchLimit ?? 100) || 100)));
  const listLimit = Math.max(1, Math.min(1000, Math.floor(Number(options.listLimit ?? 500) || 500)));
  const folders: ImageFolderCandidate[] = [];
  const rows: ImageCatalogRow[] = [];

  for (const code of options.codes) {
    const candidates = await locateImageFolders(client, {
      code,
      mountId: mount.mountId,
      relativePath: parsed.relativePath,
      folderRule,
      searchLimit
    });
    folders.push(...candidates);

    if (!candidates.length) {
      rows.push(noticeRow({
        code,
        mount,
        folderPath: '',
        status: '未找到文件夹',
        note: `范围内没有按规则命中的文件夹：${folderRule.mode}:${folderRule.pattern}`
      }));
      continue;
    }

    for (const folder of candidates) {
      const listed = await listOrEmpty(client, { mountId: mount.mountId, path: folder.folderPath, limit: listLimit });
      const imageRows = listed.files
        .filter(isImageFile)
        .map((file) => toCatalogRow({
          code,
          mount,
          folderPath: folder.folderPath,
          file,
          rules
        }))
        .filter((row) => !options.selectedOnly || row.selected);

      if (options.includeDownloadUrls) {
        await addDownloadUrls(client, mount.mountId, imageRows);
      }

      if (!imageRows.length) {
        rows.push(noticeRow({
          code,
          mount,
          folderPath: folder.folderPath,
          status: options.selectedOnly ? '没有命中图片' : '文件夹无图片',
          note: `目录文件 ${listed.files.length} 条`
        }));
        continue;
      }
      rows.push(...imageRows);
    }
  }

  return {
    mountId: mount.mountId,
    mountName: mount.mountName,
    relativePath: parsed.relativePath,
    folders,
    rows
  };
}

async function addDownloadUrls(client: ImageCatalogClient, mountId: number, rows: ImageCatalogRow[]): Promise<void> {
  if (!client.downloadUrl) throw new Error('includeDownloadUrls requires a downloadUrl-capable client');
  for (const row of rows) {
    if (!row.cloudPath) continue;
    try {
      row.downloadUrl = await client.downloadUrl({ mountId, path: row.cloudPath });
    } catch (error) {
      row.status = '获取下载链接失败';
      row.note = error instanceof Error ? error.message : String(error);
    }
  }
}

async function locateImageFolders(
  client: ImageCatalogClient,
  options: { code: string; mountId: number; relativePath: string; folderRule: FolderPickRule; searchLimit: number }
): Promise<ImageFolderCandidate[]> {
  if (pathEndsWithCode(options.relativePath, options.code)) {
    return [{ inputCode: options.code, folderPath: normalizeFolderPath(options.relativePath), source: 'exact' }];
  }

  const searchResult = await searchOrEmpty(client, {
    query: options.code,
    mountId: options.mountId,
    path: normalizeFolderPath(options.relativePath),
    limit: options.searchLimit,
    pageSize: Math.min(100, options.searchLimit)
  });
  const folders = searchResult.files
    .filter((file) => file.isDir)
    .filter((file) => matchesFolderRule(file, options.folderRule, options.code))
    .map((file): ImageFolderCandidate => ({
      inputCode: options.code,
      folderPath: file.fullpath,
      source: 'search'
    }));
  if (folders.length) return dedupeFolders(folders);

  return [{
    inputCode: options.code,
    folderPath: [normalizeFolderPath(options.relativePath), compact(options.code)].filter(Boolean).join('/'),
    source: 'fallback'
  }];
}

function matchesFolderRule(file: CloudFile, rule: FolderPickRule, code: string): boolean {
  if (!file.isDir) return false;
  const pattern = expandPattern(rule.pattern, code);
  if (!pattern) return false;
  if (rule.mode === 'path') return normalizeComparable(file.fullpath).includes(normalizeComparable(pattern));
  if (rule.mode === 'glob') return globToRegex(pattern).test(file.filename);
  if (rule.mode === 'regex') return new RegExp(pattern, 'i').test(file.filename) || new RegExp(pattern, 'i').test(file.fullpath);
  return normalizeComparable(file.filename) === normalizeComparable(pattern);
}

function toCatalogRow(options: {
  code: string;
  mount: { mountId: number; mountName: string };
  folderPath: string;
  file: CloudFile;
  rules: ImagePickRule[];
}): ImageCatalogRow {
  const matchedRules = options.rules
    .filter((rule) => matchesPickRule(options.file, rule, options.code))
    .map((rule) => rule.label);
  return {
    inputCode: options.code,
    folderPath: options.folderPath,
    filename: options.file.filename,
    cloudPath: options.file.fullpath,
    ext: options.file.ext,
    filesize: options.file.filesize,
    selected: matchedRules.length > 0,
    matchedRules,
    status: '图片',
    note: '',
    mountId: options.mount.mountId,
    mountName: options.mount.mountName
  };
}

function noticeRow(options: {
  code: string;
  mount: { mountId: number; mountName: string };
  folderPath: string;
  status: string;
  note: string;
}): ImageCatalogRow {
  return {
    inputCode: options.code,
    folderPath: options.folderPath,
    filename: '',
    cloudPath: '',
    ext: '',
    filesize: 0,
    selected: false,
    matchedRules: [],
    status: options.status,
    note: options.note,
    mountId: options.mount.mountId,
    mountName: options.mount.mountName
  };
}

function pathEndsWithCode(relativePath: string, code: string): boolean {
  const last = pathSegments(relativePath).at(-1);
  return normalizeComparable(last) === normalizeComparable(code);
}

function normalizeFolderPath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function normalizeComparable(value: unknown): string {
  return compact(value).toLowerCase();
}

function expandPattern(pattern: string, code: string): string {
  return compact(pattern).replace(/\{code\}/gi, compact(code));
}

function globToRegex(glob: string): RegExp {
  const source = glob
    .split('*').map((part) => part.split('?').map(escapeRegExp).join('.')).join('.*');
  return new RegExp(`^${source}$`, 'i');
}

function dedupeFolders(folders: ImageFolderCandidate[]): ImageFolderCandidate[] {
  const result: ImageFolderCandidate[] = [];
  const seen = new Set<string>();
  for (const folder of folders) {
    const key = normalizeComparable(folder.folderPath);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(folder);
  }
  return result;
}

async function searchOrEmpty(
  client: ImageCatalogClient,
  options: { query: string; mountId: number; path?: string; limit: number; pageSize: number }
): Promise<FileListResult> {
  try {
    return await client.search(options);
  } catch (error) {
    if (error instanceof EmptyResultError) return { total: 0, count: 0, files: [] };
    throw error;
  }
}

async function listOrEmpty(
  client: ImageCatalogClient,
  options: { mountId: number; path: string; limit: number }
): Promise<FileListResult> {
  try {
    return await client.list(options);
  } catch (error) {
    if (error instanceof EmptyResultError) return { total: 0, count: 0, files: [] };
    throw error;
  }
}
