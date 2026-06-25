import path from 'node:path';
import type { DownloadJob, DownloadLayout, DownloadResult } from './download.js';
import { normalizeDownloadLayout } from './download.js';
import { toSafeFilename } from './rules.js';

export interface CatalogDownloadInputRow {
  inputCode?: string;
  folderPath?: string;
  filename?: string;
  cloudPath?: string;
  selected?: boolean;
  matchedRules?: string[] | string;
  downloadUrl?: string;
  mountId?: number;
  mountName?: string;
}

export interface CatalogDownloadPlanOptions {
  outputDir: string;
  selectedOnly?: boolean;
  layout?: DownloadLayout | string;
}

export interface CatalogDownloadRow {
  inputCode: string;
  filename: string;
  cloudPath: string;
  downloadStatus: string;
  localFile: string;
  note: string;
  matchedRules: string[];
  mountId?: number;
  mountName?: string;
}

export interface CatalogDownloadPlanJob extends DownloadJob {
  rowIndex: number;
}

export interface CatalogDownloadPlan {
  rows: CatalogDownloadRow[];
  jobs: CatalogDownloadPlanJob[];
}

export function buildCatalogDownloadPlan(inputRows: CatalogDownloadInputRow[], options: CatalogDownloadPlanOptions): CatalogDownloadPlan {
  const rows: CatalogDownloadRow[] = [];
  const jobs: CatalogDownloadPlanJob[] = [];
  const candidates = (Array.isArray(inputRows) ? inputRows : [])
    .filter((row) => row?.filename && row?.cloudPath)
    .filter((row) => !options.selectedOnly || row.selected === true);

  for (const input of candidates) {
    const inputCode = String(input.inputCode || 'images');
    const filename = String(input.filename || 'download');
    const destination = buildCatalogDestination({
      outputDir: options.outputDir,
      layout: options.layout,
      inputCode,
      filename
    });
    const rowIndex = rows.length;
    const row: CatalogDownloadRow = {
      inputCode,
      filename,
      cloudPath: String(input.cloudPath || ''),
      downloadStatus: input.downloadUrl ? '待下载' : '缺少下载链接',
      localFile: destination,
      note: input.downloadUrl ? '' : '请先用 inspect-images --include-download-urls 输出临时下载链接，或直接用 download-catalog 的路径参数模式',
      matchedRules: normalizeMatchedRules(input.matchedRules),
      mountId: typeof input.mountId === 'number' ? input.mountId : undefined,
      mountName: typeof input.mountName === 'string' ? input.mountName : undefined
    };

    if (input.downloadUrl) {
      jobs.push({ rowIndex, url: input.downloadUrl, destination });
    }
    rows.push(row);
  }

  return { rows, jobs };
}

export function finalizeCatalogDownloadRows(rows: CatalogDownloadRow[], results: DownloadResult[]): CatalogDownloadRow[] {
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

function buildCatalogDestination(options: { outputDir: string; layout?: DownloadLayout | string; inputCode: string; filename: string }): string {
  const layout = normalizeDownloadLayout(options.layout);
  if (layout === 'flat') {
    return path.join(options.outputDir, `${toSafeFilename(options.inputCode, 'images')}__${toSafeFilename(options.filename, 'download')}`);
  }
  return path.join(options.outputDir, toSafeFilename(options.inputCode, 'images'), toSafeFilename(options.filename, 'download'));
}

function normalizeMatchedRules(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') return value.split(/[|,，;；]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}
