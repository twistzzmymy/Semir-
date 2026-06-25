import { buildDownloadDestination, type DownloadJob, type DownloadLayout, type DownloadResult } from './download.js';
import { EmptyResultError } from './errors.js';
import type { CloudFile } from './files.js';
import type { FileListResult } from './client.js';
import {
  compact,
  escapeRegExp,
  getFileStem,
  isImageFile,
  parseCloudPath,
  pathSegments
} from './rules.js';

export type ImagePickRuleMode = 'stem' | 'filename' | 'glob' | 'regex';

export interface ImagePickRule {
  label: string;
  mode: ImagePickRuleMode;
  pattern: string;
}

export interface RuleImagePlanClient {
  resolveMount(mountName: string): Promise<{ mountId: number; mountName: string }>;
  list(options: { mountId: number; path: string; limit: number }): Promise<FileListResult>;
  downloadUrl(options: { mountId: number; path: string }): Promise<string>;
}

export interface RuleImagePlanOptions {
  cloudPath: string;
  codes: string[];
  rules: ImagePickRule[] | string;
  outputDir: string;
  includeDownloadUrls: boolean;
  layout?: DownloadLayout | string;
  limit?: number;
}

export interface RuleImageRow {
  inputCode: string;
  ruleLabel: string;
  rulePattern: string;
  filename: string;
  cloudPath: string;
  downloadStatus: string;
  localFile: string;
  note: string;
  mountId?: number;
  mountName?: string;
}

export interface RuleImagePlanJob extends DownloadJob {
  rowIndex: number;
}

export interface RuleImagePlan {
  mountId: number;
  mountName: string;
  relativePath: string;
  rows: RuleImageRow[];
  jobs: RuleImagePlanJob[];
}

export function parseImagePickRules(rawValue: unknown): ImagePickRule[] {
  if (Array.isArray(rawValue)) return rawValue.map(normalizeRule).filter((rule) => rule.pattern);
  const raw = String(rawValue ?? '').trim();
  if (!raw) return [];
  return raw
    .split(/[\n,，;；]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseRuleToken)
    .filter((rule) => rule.pattern);
}

export async function buildRuleImagePlan(client: RuleImagePlanClient, options: RuleImagePlanOptions): Promise<RuleImagePlan> {
  const parsed = parseCloudPath(options.cloudPath);
  const mount = await client.resolveMount(parsed.mountName);
  const rules = parseImagePickRules(options.rules);
  const rows: RuleImageRow[] = [];
  const jobs: RuleImagePlanJob[] = [];
  const limit = Math.max(1, Math.min(500, Math.floor(Number(options.limit ?? 200) || 200)));

  for (const code of options.codes) {
    const folderPath = resolveRuleImageFolderPath(parsed.relativePath, code);
    const listed = await listOrEmpty(client, { mountId: mount.mountId, path: folderPath, limit });
    const images = listed.files.filter(isImageFile);

    for (const rule of rules) {
      const match = images.find((file) => matchesPickRule(file, rule, code));
      if (!match) {
        rows.push({
          inputCode: code,
          ruleLabel: rule.label,
          rulePattern: rule.pattern,
          filename: '',
          cloudPath: '',
          downloadStatus: '未匹配到图片',
          localFile: '',
          note: `目录图片 ${images.length} 张，规则未命中`,
          mountId: mount.mountId,
          mountName: mount.mountName
        });
        continue;
      }

      const rowIndex = rows.length;
      const destination = buildDownloadDestination({
        outputDir: options.outputDir,
        layout: options.layout ?? 'by_code',
        code,
        file: match,
        index: rowIndex
      });
      const row: RuleImageRow = {
        inputCode: code,
        ruleLabel: rule.label,
        rulePattern: rule.pattern,
        filename: match.filename,
        cloudPath: match.fullpath,
        downloadStatus: options.includeDownloadUrls ? '待下载' : '仅规划',
        localFile: destination,
        note: '',
        mountId: mount.mountId,
        mountName: mount.mountName
      };

      if (options.includeDownloadUrls) {
        try {
          const url = await client.downloadUrl({ mountId: mount.mountId, path: match.fullpath });
          jobs.push({ rowIndex, url, destination });
        } catch (error) {
          row.downloadStatus = '获取下载链接失败';
          row.note = error instanceof Error ? error.message : String(error);
        }
      }

      rows.push(row);
    }
  }

  return {
    mountId: mount.mountId,
    mountName: mount.mountName,
    relativePath: parsed.relativePath,
    rows,
    jobs
  };
}

export function finalizeRuleImageRows(rows: RuleImageRow[], results: DownloadResult[]): RuleImageRow[] {
  let resultIndex = 0;
  return rows.map((row) => {
    if (row.downloadStatus !== '待下载') return row;
    const result = results[resultIndex];
    resultIndex += 1;
    if (result?.success) {
      return {
        ...row,
        downloadStatus: '已下载',
        localFile: result.path,
        note: `${result.bytes} bytes`
      };
    }
    return {
      ...row,
      downloadStatus: '下载失败',
      localFile: result?.path ?? row.localFile,
      note: result?.error ?? '下载失败'
    };
  });
}

export function resolveRuleImageFolderPath(relativePath: string, code: string): string {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const segments = pathSegments(normalized);
  const last = compact(segments.at(-1)).toLowerCase();
  const target = compact(code).toLowerCase();
  if (last && target && last === target) return normalized;
  return [normalized, compact(code)].filter(Boolean).join('/');
}

export function matchesPickRule(file: CloudFile, rule: ImagePickRule, code: string): boolean {
  const pattern = expandRulePattern(rule.pattern, code);
  if (!pattern) return false;
  if (rule.mode === 'filename') return file.filename.toLowerCase() === pattern.toLowerCase();
  if (rule.mode === 'regex') return new RegExp(pattern, 'i').test(file.filename);
  if (rule.mode === 'glob') return globToRegex(pattern).test(file.filename);
  return getFileStem(file.filename).toLowerCase() === pattern.toLowerCase();
}

function parseRuleToken(token: string): ImagePickRule {
  const splitAt = firstDividerIndex(token);
  const rawLabel = splitAt >= 0 ? token.slice(0, splitAt) : token;
  const rawPattern = splitAt >= 0 ? token.slice(splitAt + 1) : token;
  return normalizeRule({
    label: rawLabel,
    pattern: rawPattern
  });
}

function normalizeRule(rawRule: unknown): ImagePickRule {
  if (!rawRule || typeof rawRule !== 'object') {
    return normalizeRule({ label: String(rawRule ?? ''), pattern: String(rawRule ?? '') });
  }
  const raw = rawRule as { label?: unknown; mode?: unknown; pattern?: unknown; stem?: unknown; filename?: unknown; glob?: unknown; regex?: unknown };
  const explicit = pickExplicitMatcher(raw);
  const pattern = compact(explicit.pattern);
  const label = compact(raw.label) || pattern;
  return {
    label,
    mode: explicit.mode,
    pattern
  };
}

function pickExplicitMatcher(raw: { mode?: unknown; pattern?: unknown; stem?: unknown; filename?: unknown; glob?: unknown; regex?: unknown }): { mode: ImagePickRuleMode; pattern: string } {
  if (raw.stem !== undefined) return { mode: 'stem', pattern: String(raw.stem ?? '') };
  if (raw.filename !== undefined) return { mode: 'filename', pattern: String(raw.filename ?? '') };
  if (raw.glob !== undefined) return { mode: 'glob', pattern: String(raw.glob ?? '') };
  if (raw.regex !== undefined) return { mode: 'regex', pattern: String(raw.regex ?? '') };
  const parsed = parseModePrefix(String(raw.pattern ?? ''));
  const requested = compact(raw.mode).toLowerCase();
  if (['stem', 'filename', 'glob', 'regex'].includes(requested)) {
    return { mode: requested as ImagePickRuleMode, pattern: parsed.pattern };
  }
  return parsed;
}

function parseModePrefix(value: string): { mode: ImagePickRuleMode; pattern: string } {
  const trimmed = value.trim();
  const match = /^(stem|filename|glob|regex):(.*)$/i.exec(trimmed);
  if (match) return { mode: match[1].toLowerCase() as ImagePickRuleMode, pattern: match[2].trim() };
  if (/[*?[\]]/.test(trimmed)) return { mode: 'glob', pattern: trimmed };
  return { mode: 'stem', pattern: trimmed };
}

function firstDividerIndex(value: string): number {
  const equals = value.indexOf('=');
  const colon = value.indexOf(':');
  if (equals < 0) return colon;
  if (colon < 0) return equals;
  return Math.min(equals, colon);
}

function expandRulePattern(pattern: string, code: string): string {
  return compact(pattern).replace(/\{code\}/gi, compact(code));
}

function globToRegex(glob: string): RegExp {
  const source = glob
    .split('*').map((part) => part.split('?').map(escapeRegExp).join('.')).join('.*');
  return new RegExp(`^${source}$`, 'i');
}

async function listOrEmpty(
  client: RuleImagePlanClient,
  options: { mountId: number; path: string; limit: number }
): Promise<FileListResult> {
  try {
    return await client.list(options);
  } catch (error) {
    if (error instanceof EmptyResultError) return { total: 0, count: 0, files: [] };
    throw error;
  }
}
