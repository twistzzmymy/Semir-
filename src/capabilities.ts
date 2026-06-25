import type { CdpPage } from './cdp.js';
import { probeSemirLogin } from './cdp.js';
import type { SemirYunpanClient } from './client.js';
import { runDownloadJobs } from './download.js';
import { normalizeCloudFile } from './files.js';
import { buildImageDownloadPlan } from './image-plan.js';
import { buildShenhuiPackagePlan } from './shenhui-plan.js';
import { classifyShenhuiAsset, normalizeShenhuiSourceTypes } from './shenhui.js';
import { filterSearchResults, normalizeCodes, parseCloudPath } from './rules.js';

export interface CapabilityContext {
  client?: SemirYunpanClient | Record<string, unknown>;
  page?: CdpPage;
}

export interface CapabilityDefinition {
  name: string;
  description: string;
  requiresClient?: boolean;
  requiresPage?: boolean;
  input: Record<string, string>;
}

export interface CapabilityResult {
  capability: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

type CapabilityRunner = (input: Record<string, unknown>, context: CapabilityContext) => Promise<unknown> | unknown;
type InternalCapabilityDefinition = CapabilityDefinition & { run: CapabilityRunner };

const CAPABILITIES: InternalCapabilityDefinition[] = [
  {
    name: 'capabilities.list',
    description: '列出森马云盘 CLI 当前可供 AI agent 调用的原子能力',
    input: {},
    run: () => listCapabilities()
  },
  {
    name: 'session.probe',
    description: '探测 9222 森马云盘页面登录态，不读取 cookie/token',
    requiresPage: true,
    input: {},
    run: async (_input, context) => {
      if (!context.page) throw new Error('session.probe requires page context');
      return await probeSemirLogin(context.page);
    }
  },
  {
    name: 'path.parse',
    description: '解析“挂载点//目录/子目录”云盘路径',
    input: { cloudPath: 'string' },
    run: (input) => parseCloudPath(String(input.cloudPath ?? input.path ?? ''))
  },
  {
    name: 'codes.normalize',
    description: '规范化款号/SKC 输入，支持换行、逗号、顿号、分号并去重',
    input: { codes: 'string|string[]' },
    run: (input) => ({ codes: normalizeCodes(Array.isArray(input.codes) ? input.codes.join('\n') : input.codes ?? input.text ?? '') })
  },
  {
    name: 'mount.resolve',
    description: '按挂载点名称解析 mount_id',
    requiresClient: true,
    input: { mountName: 'string', cloudPath: 'string optional' },
    run: async (input, context) => {
      const client = requiredClient(context);
      const mountName = input.mountName ? String(input.mountName) : parseCloudPath(String(input.cloudPath ?? '')).mountName;
      return await client.resolveMount(mountName);
    }
  },
  {
    name: 'files.list',
    description: '列出指定 mount/path 下的文件',
    requiresClient: true,
    input: { mountId: 'number', path: 'string optional', limit: 'number optional' },
    run: async (input, context) => await requiredClient(context).list({
      mountId: scalar(input.mountId),
      path: stringOrUndefined(input.path),
      limit: scalar(input.limit ?? 100)
    })
  },
  {
    name: 'files.search',
    description: '调用森马云盘搜索接口，返回标准 CloudFile 列表',
    requiresClient: true,
    input: { query: 'string', mountId: 'number', path: 'string optional', ext: 'string optional', limit: 'number optional' },
    run: async (input, context) => await requiredClient(context).search({
      query: String(input.query ?? ''),
      mountId: scalar(input.mountId),
      path: stringOrUndefined(input.path),
      ext: stringOrUndefined(input.ext),
      scope: stringOrUndefined(input.scope),
      allMounts: input.allMounts === true,
      limit: scalar(input.limit ?? 50),
      pageSize: scalar(input.pageSize ?? 100)
    })
  },
  {
    name: 'files.info',
    description: '读取单个云盘文件元数据，可选临时下载 URL 字段',
    requiresClient: true,
    input: { mountId: 'number', path: 'string', includeUrl: 'boolean optional' },
    run: async (input, context) => await requiredClient(context).info({
      mountId: scalar(input.mountId),
      path: String(input.path ?? ''),
      includeUrl: input.includeUrl === true
    })
  },
  {
    name: 'urls.download',
    description: '获取单个文件临时下载 URL',
    requiresClient: true,
    input: { mountId: 'number', path: 'string' },
    run: async (input, context) => ({ url: await requiredClient(context).downloadUrl({ mountId: scalar(input.mountId), path: String(input.path ?? '') }) })
  },
  {
    name: 'urls.preview',
    description: '获取单个文件临时预览 URL',
    requiresClient: true,
    input: { mountId: 'number', path: 'string' },
    run: async (input, context) => ({ url: await requiredClient(context).previewUrl({ mountId: scalar(input.mountId), path: String(input.path ?? '') }) })
  },
  {
    name: 'rules.filter-images',
    description: '按抓虾 SPU/SKC 搜图规则过滤搜索结果',
    input: { files: 'CloudFile[]', code: 'string', relativePath: 'string optional' },
    run: (input) => ({
      files: filterSearchResults(normalizeFiles(input.files), String(input.code ?? ''), String(input.relativePath ?? ''), {
        duplicateMode: stringOrUndefined(input.duplicateMode),
        spuMatchMode: stringOrUndefined(input.spuMatchMode)
      })
    })
  },
  {
    name: 'downloads.plan-images',
    description: '解析路径、搜索、按 SPU/SKC 规则过滤并生成图片下载计划',
    requiresClient: true,
    input: { cloudPath: 'string', codes: 'string|string[]', includeDownloadUrls: 'boolean optional' },
    run: async (input, context) => await buildImageDownloadPlan(requiredClient(context), {
      cloudPath: String(input.cloudPath ?? ''),
      codes: Array.isArray(input.codes) ? input.codes.map(String) : normalizeCodes(input.codes),
      outputDir: String(input.outputDir ?? 'semir-yunpan-downloads'),
      includeDownloadUrls: input.includeDownloadUrls === true,
      duplicateMode: stringOrUndefined(input.duplicateMode),
      spuMatchMode: stringOrUndefined(input.spuMatchMode),
      layout: stringOrUndefined(input.layout),
      limit: Number(input.limit ?? 500)
    })
  },
  {
    name: 'downloads.run',
    description: '执行本地 URL 下载任务，输入 jobs=[{url,destination,headers}]',
    input: { jobs: 'DownloadJob[]', concurrency: 'number optional' },
    run: async (input) => await runDownloadJobs(Array.isArray(input.jobs) ? input.jobs as never : [], Number(input.concurrency ?? 4))
  },
  {
    name: 'shenhui.classify-asset',
    description: '按“整理深绘上新图包”SOP 判断单个素材保留/过滤/命名',
    input: { sourceType: 'model|still', file: 'CloudFile' },
    run: (input) => classifyShenhuiAsset(normalizeShenhuiSourceTypes(input.sourceType)[0], normalizeCloudFile(input.file as Record<string, unknown>))
  },
  {
    name: 'shenhui.plan-package',
    description: '整理深绘上新图包能力：定位款号文件夹、递归列目录、SOP 过滤并生成下载计划',
    requiresClient: true,
    input: { codes: 'string|string[]', modelCloudPath: 'string optional', stillCloudPath: 'string optional' },
    run: async (input, context) => await buildShenhuiPackagePlan(requiredClient(context), {
      codes: Array.isArray(input.codes) ? input.codes.map(String) : normalizeCodes(input.codes),
      modelCloudPath: stringOrUndefined(input.modelCloudPath),
      stillCloudPath: stringOrUndefined(input.stillCloudPath),
      sourceTypes: Array.isArray(input.sourceTypes) ? input.sourceTypes as never : stringOrUndefined(input.sourceTypes),
      folderScanDepth: scalar(input.folderScanDepth ?? 3),
      duplicateMode: stringOrUndefined(input.duplicateMode),
      includeDownloadUrls: input.includeDownloadUrls === true,
      searchLimit: Number(input.searchLimit ?? 500)
    })
  }
];

export function listCapabilities(): CapabilityDefinition[] {
  return CAPABILITIES.map(({ run: _run, ...definition }) => definition);
}

export function getCapability(name: string): CapabilityDefinition | undefined {
  const found = CAPABILITIES.find((capability) => capability.name === name);
  if (!found) return undefined;
  const { run: _run, ...definition } = found;
  return definition;
}

export async function runCapability(name: string, input: Record<string, unknown>, context: CapabilityContext = {}): Promise<CapabilityResult> {
  const capability = CAPABILITIES.find((item) => item.name === name);
  if (!capability) {
    return { capability: name, ok: false, error: `Unknown capability: ${name}` };
  }
  try {
    const data = await capability.run(input ?? {}, context);
    return { capability: name, ok: true, data };
  } catch (error) {
    return {
      capability: name,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function requiredClient(context: CapabilityContext): SemirYunpanClient {
  if (!context.client) throw new Error('capability requires SemirYunpanClient context');
  return context.client as SemirYunpanClient;
}

function normalizeFiles(value: unknown) {
  return Array.isArray(value) ? value.map((item) => normalizeCloudFile(item as Record<string, unknown>)) : [];
}

function scalar(value: unknown): number | string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return String(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value);
}
