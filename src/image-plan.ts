import type { FileListResult } from './client.js';
import { buildDownloadDestination, type DownloadJob, type DownloadLayout, type DownloadResult } from './download.js';
import {
  buildSpuPackageFilename,
  classifyCode,
  filterSearchResults
} from './rules.js';
import { parseCloudPath, normalizeDuplicateMode, normalizeSpuMatchMode } from './rules.js';

export interface ImagePlanClient {
  resolveMount(mountName: string): Promise<{ mountId: number; mountName: string }>;
  search(options: { query: string; mountId: number; limit: number; pageSize: number; ext: string }): Promise<FileListResult>;
  downloadUrl(options: { mountId: number; path: string }): Promise<string>;
}

export interface ImageDownloadPlanOptions {
  cloudPath: string;
  codes: string[];
  outputDir: string;
  includeDownloadUrls: boolean;
  duplicateMode?: string;
  spuMatchMode?: string;
  layout?: DownloadLayout | string;
  limit?: number;
}

export interface ImageDownloadRow {
  inputCode: string;
  matchType: '款号' | '款色编码';
  filename: string;
  sourceFilename?: string;
  cloudPath: string;
  downloadStatus: string;
  localFile: string;
  note: string;
  mountId?: number;
  mountName?: string;
}

export interface ImageDownloadPlanJob extends DownloadJob {
  rowIndex: number;
}

export interface ImageDownloadPlan {
  mountId: number;
  mountName: string;
  relativePath: string;
  rows: ImageDownloadRow[];
  jobs: ImageDownloadPlanJob[];
}

export async function buildImageDownloadPlan(client: ImagePlanClient, options: ImageDownloadPlanOptions): Promise<ImageDownloadPlan> {
  const parsed = parseCloudPath(options.cloudPath);
  const mount = await client.resolveMount(parsed.mountName);
  const rows: ImageDownloadRow[] = [];
  const jobs: ImageDownloadPlanJob[] = [];
  const duplicateMode = normalizeDuplicateMode(options.duplicateMode);
  const spuMatchMode = normalizeSpuMatchMode(options.spuMatchMode);
  const limit = Math.max(1, Math.min(1000, Math.floor(Number(options.limit ?? 500) || 500)));

  for (const code of options.codes) {
    const result = await searchOrEmpty(client, { query: code, mountId: mount.mountId, limit, pageSize: 100, ext: 'image' });
    const matched = filterSearchResults(result.files, code, parsed.relativePath, { duplicateMode, spuMatchMode });

    if (!matched.length) {
      rows.push({
        inputCode: code,
        matchType: classifyCode(code) === 'skc' ? '款色编码' : '款号',
        filename: '',
        cloudPath: '',
        downloadStatus: '未匹配到图片',
        localFile: '',
        note: `搜索结果 ${result.files.length} 条，过滤后 0 条`,
        mountId: mount.mountId,
        mountName: mount.mountName
      });
      continue;
    }

    for (let index = 0; index < matched.length; index += 1) {
      const file = matched[index];
      const representativeSpu = classifyCode(code) === 'spu' && spuMatchMode === 'representative';
      const packageFilename = representativeSpu ? buildSpuPackageFilename(code, file) : undefined;
      const destination = buildDownloadDestination({
        outputDir: options.outputDir,
        layout: options.layout ?? 'by_code',
        code,
        file,
        packageFilename,
        index
      });
      const rowIndex = rows.length;
      const row: ImageDownloadRow = {
        inputCode: code,
        matchType: classifyCode(code) === 'skc' ? '款色编码' : '款号',
        filename: packageFilename ?? file.filename,
        sourceFilename: file.filename,
        cloudPath: file.fullpath,
        downloadStatus: options.includeDownloadUrls ? '待下载' : '仅规划',
        localFile: destination,
        note: packageFilename && packageFilename !== file.filename ? `代表图来源：${file.filename}` : '',
        mountId: mount.mountId,
        mountName: mount.mountName
      };

      if (options.includeDownloadUrls) {
        try {
          const url = await client.downloadUrl({ mountId: mount.mountId, path: file.fullpath });
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

export function finalizeImageDownloadRows(rows: ImageDownloadRow[], results: DownloadResult[]): ImageDownloadRow[] {
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

async function searchOrEmpty(
  client: ImagePlanClient,
  options: { query: string; mountId: number; limit: number; pageSize: number; ext: string }
): Promise<FileListResult> {
  try {
    return await client.search(options);
  } catch (error) {
    if (error && typeof error === 'object' && 'exitCode' in error && (error as { exitCode?: unknown }).exitCode === 66) {
      return { total: 0, count: 0, files: [] };
    }
    throw error;
  }
}
