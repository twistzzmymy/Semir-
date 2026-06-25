import type { FileListResult } from './client.js';
import { EmptyResultError } from './errors.js';
import type { CloudFile } from './files.js';
import { parseCloudPath } from './rules.js';
import {
  buildShenhuiRuntimeFilename,
  classifyShenhuiAsset,
  dedupeShenhuiItemsByFullpath,
  deriveBroadSourcePrefix,
  getGroupCode,
  isPackagingFolderItem,
  isSupportedShenhuiAssetItem,
  isWithinBroadSourceScope,
  isWithinRelativePath,
  matchesShenhuiAssetItemForCode,
  matchesShenhuiFolderItemForCode,
  normalizeFolderScanDepth,
  normalizeShenhuiDuplicateMode,
  normalizeShenhuiSourceTypes,
  SHENHUI_SOURCE_LABELS,
  type ShenhuiSourceType
} from './shenhui.js';

export interface ShenhuiPlanClient {
  resolveMount(mountName: string): Promise<{ mountId: number; mountName: string }>;
  search(options: { query: string; mountId: number; limit: number; pageSize: number }): Promise<FileListResult>;
  list(options: { mountId: number; path: string; limit: number }): Promise<FileListResult>;
  downloadUrl(options: { mountId: number; path: string }): Promise<string>;
}

export interface ShenhuiSourceConfig {
  mountId: number;
  mountName: string;
  relativePath: string;
  broadRelativePath: string;
}

export interface ShenhuiPackagePlanOptions {
  codes: string[];
  modelCloudPath?: string;
  stillCloudPath?: string;
  sourceTypes?: ShenhuiSourceType[] | string;
  folderScanDepth?: number | string;
  duplicateMode?: string;
  includeDownloadUrls?: boolean;
  searchLimit?: number;
}

export interface ShenhuiPackageRow {
  inputStyle: string;
  inputCode: string;
  sourceType: ShenhuiSourceType;
  sourceLabel: string;
  filename: string;
  cloudPath: string;
  action: string;
  downloadStatus: string;
  localFile: string;
  note: string;
  groupCode: string;
  assetRole: string;
  packageFilename: string;
}

export interface ShenhuiDownloadJob {
  rowIndex: number;
  url: string;
  filename: string;
  headers?: Record<string, string>;
}

export interface ShenhuiPackagePlan {
  rows: ShenhuiPackageRow[];
  jobs: ShenhuiDownloadJob[];
  sourceConfigs: Partial<Record<ShenhuiSourceType, ShenhuiSourceConfig>>;
}

export async function buildShenhuiPackagePlan(client: ShenhuiPlanClient, options: ShenhuiPackagePlanOptions): Promise<ShenhuiPackagePlan> {
  const sourceTypes = normalizeShenhuiSourceTypes(options.sourceTypes);
  const sourceConfigs = await resolveSourceConfigs(client, options, sourceTypes);
  const rows: ShenhuiPackageRow[] = [];
  const jobs: ShenhuiDownloadJob[] = [];
  const folderScanDepth = normalizeFolderScanDepth(options.folderScanDepth);
  const duplicateMode = normalizeShenhuiDuplicateMode(options.duplicateMode);
  const searchLimit = Math.max(1, Math.min(1000, Math.floor(Number(options.searchLimit ?? 500) || 500)));

  for (const code of options.codes) {
    for (const sourceType of sourceTypes) {
      const sourceConfig = sourceConfigs[sourceType];
      if (!sourceConfig) {
        rows.push(noticeRow(code, sourceType, '未配置云盘路径', '未匹配到素材', '本次未提供该素材类型的云盘路径'));
        continue;
      }

      const candidateResult = await collectCandidateAssets(client, code, sourceType, sourceConfig, {
        folderScanDepth,
        duplicateMode,
        searchLimit
      });

      if (!candidateResult.items.length) {
        rows.push(noticeRow(
          code,
          sourceType,
          '未匹配到可处理素材',
          '未匹配到素材',
          `搜索结果 ${candidateResult.searchCount} 条；款号文件夹 ${candidateResult.folderCount} 个`
        ));
        continue;
      }

      for (let index = 0; index < candidateResult.items.length; index += 1) {
        const file = candidateResult.items[index];
        const classification = classifyShenhuiAsset(sourceType, file);
        const rowIndex = rows.length;
        const row: ShenhuiPackageRow = {
          inputStyle: getGroupCode(code),
          inputCode: code,
          sourceType,
          sourceLabel: SHENHUI_SOURCE_LABELS[sourceType],
          filename: classification.packageFilename || file.filename,
          cloudPath: file.fullpath,
          action: classification.action,
          downloadStatus: classification.keep ? options.includeDownloadUrls === false ? '仅规划' : '待下载' : '已跳过',
          localFile: '',
          note: classification.reason,
          groupCode: getGroupCode(code),
          assetRole: classification.role,
          packageFilename: classification.packageFilename || file.filename
        };

        if (classification.keep && options.includeDownloadUrls !== false) {
          try {
            const url = await client.downloadUrl({ mountId: sourceConfig.mountId, path: file.fullpath });
            jobs.push({
              rowIndex,
              url,
              filename: buildShenhuiRuntimeFilename(code, sourceType, file, index)
            });
          } catch (error) {
            row.downloadStatus = '获取下载链接失败';
            row.note = error instanceof Error ? error.message : String(error);
          }
        }

        rows.push(row);
      }
    }
  }

  return { rows, jobs, sourceConfigs };
}

async function resolveSourceConfigs(
  client: ShenhuiPlanClient,
  options: ShenhuiPackagePlanOptions,
  sourceTypes: ShenhuiSourceType[]
): Promise<Partial<Record<ShenhuiSourceType, ShenhuiSourceConfig>>> {
  const configs: Partial<Record<ShenhuiSourceType, ShenhuiSourceConfig>> = {};
  for (const sourceType of sourceTypes) {
    const rawPath = sourceType === 'model' ? options.modelCloudPath : options.stillCloudPath;
    if (!rawPath) continue;
    const parsed = parseCloudPath(rawPath);
    const mount = await client.resolveMount(parsed.mountName);
    configs[sourceType] = {
      mountId: mount.mountId,
      mountName: mount.mountName,
      relativePath: parsed.relativePath,
      broadRelativePath: deriveBroadSourcePrefix(parsed.relativePath, sourceType)
    };
  }
  return configs;
}

async function collectCandidateAssets(
  client: ShenhuiPlanClient,
  code: string,
  sourceType: ShenhuiSourceType,
  sourceConfig: ShenhuiSourceConfig,
  options: { folderScanDepth: number; duplicateMode: string; searchLimit: number }
): Promise<{ searchCount: number; folderCount: number; directAssetCount: number; items: CloudFile[] }> {
  const searchResult = await searchOrEmpty(client, { query: code, mountId: sourceConfig.mountId, limit: options.searchLimit, pageSize: 100 });
  const primaryScoped = searchResult.files.filter((file) => isWithinRelativePath(file.fullpath, sourceConfig.relativePath));
  const fallbackScoped = searchResult.files.filter((file) => isWithinBroadSourceScope(file.fullpath, sourceConfig, sourceType));
  const folderFilter = (file: CloudFile) => matchesShenhuiFolderItemForCode(file, code) && !(sourceType === 'model' && isPackagingFolderItem(file));
  const primaryMatchedFolders = primaryScoped.filter(folderFilter);
  const fallbackMatchedFolders = fallbackScoped.filter(folderFilter);
  const matchedFolders = primaryMatchedFolders.length ? primaryMatchedFolders : fallbackMatchedFolders;

  const directAssets = (primaryScoped.length ? primaryScoped : fallbackScoped)
    .filter((file) => isSupportedShenhuiAssetItem(file) && matchesShenhuiAssetItemForCode(file, code));
  const expandedAssets: CloudFile[] = [];
  if (options.folderScanDepth > 0) {
    for (const folder of matchedFolders) {
      expandedAssets.push(...await collectDescendantAssets(client, sourceConfig.mountId, folder, sourceType, options.folderScanDepth));
    }
  }

  const candidateItems = expandedAssets.length ? expandedAssets : directAssets;
  return {
    searchCount: searchResult.files.length,
    folderCount: matchedFolders.length,
    directAssetCount: directAssets.length,
    items: dedupeShenhuiItemsByFullpath(candidateItems, options.duplicateMode)
  };
}

async function collectDescendantAssets(
  client: ShenhuiPlanClient,
  mountId: number,
  folder: CloudFile,
  sourceType: ShenhuiSourceType,
  depth: number
): Promise<CloudFile[]> {
  if (depth <= 0) return [];
  if (sourceType === 'model' && isPackagingFolderItem(folder)) return [];
  const listed = await listOrEmpty(client, { mountId, path: folder.fullpath, limit: 200 });
  const assets: CloudFile[] = [];
  for (const file of listed.files) {
    if (file.isDir) {
      if (sourceType === 'model' && isPackagingFolderItem(file)) continue;
      assets.push(...await collectDescendantAssets(client, mountId, file, sourceType, depth - 1));
      continue;
    }
    if (isSupportedShenhuiAssetItem(file)) assets.push(file);
  }
  return assets;
}

function noticeRow(code: string, sourceType: ShenhuiSourceType, action: string, downloadStatus: string, note: string): ShenhuiPackageRow {
  return {
    inputStyle: getGroupCode(code),
    inputCode: code,
    sourceType,
    sourceLabel: SHENHUI_SOURCE_LABELS[sourceType],
    filename: '',
    cloudPath: '',
    action,
    downloadStatus,
    localFile: '',
    note,
    groupCode: getGroupCode(code),
    assetRole: 'notice',
    packageFilename: ''
  };
}

async function searchOrEmpty(
  client: ShenhuiPlanClient,
  options: { query: string; mountId: number; limit: number; pageSize: number }
): Promise<FileListResult> {
  try {
    return await client.search(options);
  } catch (error) {
    if (error instanceof EmptyResultError) return { total: 0, count: 0, files: [] };
    throw error;
  }
}

async function listOrEmpty(
  client: ShenhuiPlanClient,
  options: { mountId: number; path: string; limit: number }
): Promise<FileListResult> {
  try {
    return await client.list(options);
  } catch (error) {
    if (error instanceof EmptyResultError) return { total: 0, count: 0, files: [] };
    throw error;
  }
}
