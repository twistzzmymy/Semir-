import {
  buildInfoParams,
  buildListParams,
  buildPreviewParams,
  buildSearchPayload,
  normalizeLimit,
  toQueryString
} from './api.js';
import { CommandExecutionError, EmptyResultError } from './errors.js';
import { type CloudFile, normalizeCloudFile } from './files.js';
import { compact } from './rules.js';

export interface PageFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export type PageFetcher = (path: string, init?: PageFetchInit) => Promise<unknown>;

export interface FileListResult {
  total: number | null;
  count: number;
  files: CloudFile[];
}

export class SemirYunpanClient {
  constructor(private readonly fetcher: PageFetcher) {}

  async mounts(): Promise<Array<Record<string, unknown>>> {
    const data = await this.fetcher('/fengcloud/1/account/mount');
    const list = asList(data);
    return list.map((item) => ({
      mountId: Number(item.mount_id),
      orgName: item.org_name ?? '',
      memberCount: Number(item.member_count ?? 0),
      sizeUse: Number(item.size_use ?? 0),
      sizeTotal: Number(item.size_total ?? 0),
      permissions: parsePermissions(item.property)
    }));
  }

  async resolveMount(mountName: string): Promise<{ mountId: number; mountName: string }> {
    const targetName = compact(mountName);
    if (!targetName) throw new CommandExecutionError('云盘路径缺少挂载点名称');
    const mounts = await this.mounts();
    const target = mounts.find((item) => compact(item.orgName) === targetName);
    if (!target) throw new EmptyResultError(`未找到挂载点：${targetName}`);
    return {
      mountId: Number(target.mountId),
      mountName: String(target.orgName ?? targetName)
    };
  }

  async list(options: { mountId?: number | string; path?: string; limit?: number | string; start?: number | string }): Promise<FileListResult> {
    const size = normalizeLimit(options.limit, 100, 500);
    const params = buildListParams({ mountId: options.mountId, path: options.path ?? '', start: options.start ?? 0, size });
    const data = await this.fetcher(`/fengcloud/1/file/ls?${toQueryString(params)}`);
    const result = toFileListResult(data);
    if (!result.files.length) throw new EmptyResultError(`路径没有文件: ${options.path ?? '/'}`);
    return result;
  }

  async search(options: {
    query: string;
    mountId?: number | string;
    path?: string;
    allMounts?: boolean;
    scope?: string;
    ext?: string;
    limit?: number | string;
    pageSize?: number | string;
  }): Promise<FileListResult> {
    const limit = normalizeLimit(options.limit, 50, 1000);
    const pageSize = Math.min(normalizeLimit(options.pageSize, Math.min(limit, 100), 500, 'page-size'), limit);
    const files: CloudFile[] = [];
    let total: number | null = null;
    let count = 0;

    for (let start = 0; files.length < limit;) {
      const size = Math.min(pageSize, limit - files.length);
      const payload = buildSearchPayload({ ...options, start, size });
      const data = await this.fetcher('/fengcloud/2/file/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = toFileListResult(data);
      total = result.total;
      count += result.count;
      files.push(...result.files.slice(0, limit - files.length));
      if (!result.files.length || result.files.length < size) break;
      if (total !== null && files.length >= total) break;
      start += result.files.length;
    }

    if (!files.length) throw new EmptyResultError(`没有搜索到: ${options.query}`);
    return { total, count, files };
  }

  async info(options: { mountId?: number | string; path: string; includeUrl?: boolean }): Promise<Record<string, unknown>> {
    const params = buildInfoParams(options);
    const data = await this.fetcher(`/fengcloud/2/file/info?${toQueryString(params)}`);
    if (!data || typeof data !== 'object') throw new CommandExecutionError('file info returned an unexpected response');
    return data as Record<string, unknown>;
  }

  async previewUrl(options: { mountId?: number | string; path: string }): Promise<string> {
    const params = buildPreviewParams(options);
    const data = await this.fetcher(`/fengcloud/2/file/preview_url?${toQueryString(params)}`);
    const url = typeof (data as { url?: unknown })?.url === 'string' ? (data as { url: string }).url : '';
    if (!url) throw new EmptyResultError(`没有可用预览链接: ${options.path}`);
    return url;
  }

  async downloadUrl(options: { mountId?: number | string; path: string }): Promise<string> {
    const data = await this.info({ ...options, includeUrl: true });
    const url = typeof data.uri === 'string' ? data.uri : Array.isArray(data.uris) && typeof data.uris[0] === 'string' ? data.uris[0] : '';
    if (!url) throw new EmptyResultError(`没有可用下载链接: ${options.path}`);
    return url;
  }
}

function toFileListResult(data: unknown): FileListResult {
  if (!data || typeof data !== 'object') throw new CommandExecutionError('file list returned an unexpected response');
  const obj = data as { total?: unknown; count?: unknown; list?: unknown };
  const list = Array.isArray(obj.list) ? obj.list : [];
  return {
    total: obj.total === null || obj.total === undefined ? null : Number(obj.total),
    count: Number(obj.count ?? list.length),
    files: list.map((item) => normalizeCloudFile(item as Record<string, unknown>))
  };
}

function asList(data: unknown): Array<Record<string, unknown>> {
  if (!data || typeof data !== 'object') throw new CommandExecutionError('mounts returned an unexpected response');
  const list = (data as { list?: unknown }).list;
  return Array.isArray(list) ? list as Array<Record<string, unknown>> : [];
}

function parsePermissions(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value) as { permissions?: unknown; permisson?: unknown };
    const permissions = Array.isArray(parsed.permissions)
      ? parsed.permissions
      : Array.isArray(parsed.permisson)
        ? parsed.permisson
        : [];
    return permissions.map(String);
  } catch {
    return [];
  }
}
