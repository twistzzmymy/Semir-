#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { DEFAULT_CDP_URL, DEFAULT_LOGIN_URL, DEFAULT_MOUNT_ID, DEFAULT_URL_PREFIX } from './api.js';
import { getCapability, runCapability } from './capabilities.js';
import { extractActionArgs, extractActionCommand } from './cli-args.js';
import { CdpPage, probeSemirLogin } from './cdp.js';
import { SemirYunpanClient } from './client.js';
import { downloadUrlToFile, runDownloadJobs } from './download.js';
import { SemirCliError } from './errors.js';
import { groupStyleResults, rankStyleResults, type CloudFile, type RankedStyleResult, type StyleGroup } from './files.js';
import { buildImageDownloadPlan, finalizeImageDownloadRows, type ImageDownloadRow } from './image-plan.js';
import { type OutputFormat, pickFields, render } from './output.js';
import { readCapabilityInput } from './run-input.js';
import { normalizeCodes, toSafeFilename } from './rules.js';

const program = new Command();

program
  .name('semir-yunpan')
  .description('森马云盘 CLI：面向用户和 AI agent 的搜款、搜图包、路径解析工具')
  .option('--cdp-url <url>', 'Chrome CDP endpoint', process.env.SEMIR_YUNPAN_CDP_URL ?? DEFAULT_CDP_URL)
  .option('--url-prefix <prefix>', '森马云盘页面 URL 前缀', process.env.SEMIR_YUNPAN_URL_PREFIX ?? DEFAULT_URL_PREFIX)
  .option('--login-url <url>', '未打开森马云盘时在 9222 浏览器打开的登录页', process.env.SEMIR_YUNPAN_LOGIN_URL ?? DEFAULT_LOGIN_URL)
  .option('--login-timeout <seconds>', '等待用户完成登录的秒数', process.env.SEMIR_YUNPAN_LOGIN_TIMEOUT ?? '300')
  .option('--login-poll <seconds>', '登录状态轮询间隔秒数', process.env.SEMIR_YUNPAN_LOGIN_POLL ?? '2')
  .option('-f, --format <format>', '输出格式: table/json/ndjson/csv/md', defaultFormat());

program.command('login')
  .description('打开/复用 9222 浏览器里的森马云盘页面，等待用户登录并校验登录态')
  .action(async (...raw: unknown[]) => {
    const command = extractActionCommand<Command>(raw);
    const opts = command.optsWithGlobals<Record<string, unknown>>();
    const page = await connectPage(opts);
    try {
      write(await probeSemirLogin(page), opts.format);
    } finally {
      await page.close();
    }
  });

program.command('run')
  .argument('<capability>', '能力名，例如 path.parse / files.search / shenhui.plan-package')
  .option('--input-json <json>', 'JSON object 输入')
  .option('--input-file <path>', '从 JSON 文件读取输入；未提供时可从 stdin 读取')
  .description('用统一 JSON 输入/输出协议运行一个原子能力，供 AI agent 组合调用')
  .action(async (...raw: unknown[]) => {
    const command = extractActionCommand<Command>(raw);
    const args = extractActionArgs(raw);
    const opts = command.optsWithGlobals<Record<string, unknown>>();
    const capabilityName = args[0];
    const capability = getCapability(capabilityName);
    const input = await readCapabilityInput({
      inputJson: stringOpt(opts, 'inputJson'),
      inputFile: stringOpt(opts, 'inputFile')
    });

    if (!capability?.requiresClient && !capability?.requiresPage) {
      write(await runCapability(capabilityName, input), opts.format);
      return;
    }

    const page = await connectPage(opts);
    try {
      const client = capability.requiresClient ? new SemirYunpanClient(page.fetchJson.bind(page)) : undefined;
      write(await runCapability(capabilityName, input, { page, client }), opts.format);
    } finally {
      await page.close();
    }
  });

program.command('mounts')
  .description('列出当前账号可见的云盘库')
  .action(withClient(async (client, _args, opts) => {
    const rows = await client.mounts();
    write(rows, opts.format);
  }));

program.command('ls')
  .argument('[path]', '文件夹路径', '')
  .option('-m, --mount <id>', '云盘库 mount_id', String(DEFAULT_MOUNT_ID))
  .option('-l, --limit <n>', '返回数量', '100')
  .description('列出指定路径下的文件和文件夹')
  .action(withClient(async (client, args, opts) => {
    const result = await client.list({ mountId: stringOpt(opts, 'mount'), path: args[0] ?? '', limit: stringOpt(opts, 'limit') });
    write(fileRows(result.files), opts.format);
  }));

program.command('search')
  .argument('<query>', '关键词、货号或文件名片段')
  .option('-m, --mount <id>', '云盘库 mount_id', String(DEFAULT_MOUNT_ID))
  .option('-p, --path <path>', '限定搜索路径')
  .option('-l, --limit <n>', '返回数量', '50')
  .option('--page-size <n>', '每页请求数量', '100')
  .option('--scope <scope>', '搜索范围，默认 filename,tag')
  .option('--ext <ext>', '扩展名筛选：image/source/document 或 jpg,png')
  .option('--all-mounts', '跨全部库搜索')
  .description('搜索文件名/标签，可按路径和扩展名过滤')
  .action(withClient(async (client, args, opts) => {
    const result = await client.search({
      query: args[0],
      mountId: stringOpt(opts, 'mount'),
      path: stringOpt(opts, 'path'),
      limit: stringOpt(opts, 'limit'),
      pageSize: stringOpt(opts, 'pageSize'),
      scope: stringOpt(opts, 'scope'),
      ext: stringOpt(opts, 'ext'),
      allMounts: boolOpt(opts, 'allMounts')
    });
    write(fileRows(result.files), opts.format);
  }));

program.command('style')
  .argument('<styleNo>', '款号/货号，例如 208326133201')
  .option('-m, --mount <id>', '云盘库 mount_id', String(DEFAULT_MOUNT_ID))
  .option('-p, --path <path>', '限定搜索路径')
  .option('-l, --limit <n>', '返回数量', '80')
  .option('--groups', '按最近的款号/图包目录分组输出')
  .option('--images', '只看图片和源文件候选')
  .description('搜款：按货号查找图包、包装图、源文件、尺码表等')
  .action(withClient(async (client, args, opts) => {
    const styleNo = args[0];
    const result = await client.search({
      query: styleNo,
      mountId: stringOpt(opts, 'mount'),
      path: stringOpt(opts, 'path'),
      limit: stringOpt(opts, 'limit'),
      pageSize: 100,
      ext: boolOpt(opts, 'images') ? 'image' : undefined
    });
    if (boolOpt(opts, 'groups')) {
      write(styleGroupRows(groupStyleResults(result.files, styleNo)), opts.format);
      return;
    }
    write(styleRows(rankStyleResults(result.files, styleNo)), opts.format);
  }));

program.command('info')
  .argument('<path>', '完整云盘路径')
  .option('-m, --mount <id>', '云盘库 mount_id', String(DEFAULT_MOUNT_ID))
  .option('--url', '同时请求临时下载 URL')
  .option('--preview-url', '同时请求临时预览 URL')
  .description('解析完整路径的文件元数据')
  .action(withClient(async (client, args, opts) => {
    const info = await client.info({ mountId: stringOpt(opts, 'mount'), path: args[0], includeUrl: boolOpt(opts, 'url') });
    if (boolOpt(opts, 'previewUrl')) {
      info.previewUrl = await client.previewUrl({ mountId: stringOpt(opts, 'mount'), path: args[0] });
    }
    write(info, opts.format);
  }));

program.command('download-url')
  .argument('<path>', '完整云盘路径')
  .option('-m, --mount <id>', '云盘库 mount_id', String(DEFAULT_MOUNT_ID))
  .description('输出单个文件的临时下载 URL，不自动下载')
  .action(withClient(async (client, args, opts) => {
    write({ url: await client.downloadUrl({ mountId: stringOpt(opts, 'mount'), path: args[0] }) }, opts.format);
  }));

program.command('download')
  .argument('<path>', '完整云盘文件路径')
  .option('-m, --mount <id>', '云盘库 mount_id', String(DEFAULT_MOUNT_ID))
  .option('-o, --output <path>', '本地输出文件或目录', process.cwd())
  .description('下载单个云盘文件到本地')
  .action(withClient(async (client, args, opts) => {
    const cloudPath = args[0];
    const url = await client.downloadUrl({ mountId: stringOpt(opts, 'mount'), path: cloudPath });
    const output = stringOpt(opts, 'output') ?? process.cwd();
    const destination = path.extname(output) ? output : path.join(output, toSafeFilename(path.basename(cloudPath), 'download'));
    const result = await downloadUrlToFile(url, path.resolve(destination));
    write(result, opts.format);
  }));

program.command('download-images')
  .argument('[codes...]', '款号/款色编码；也可以用 --codes 或 --codes-file')
  .requiredOption('--cloud-path <path>', '云盘搜索范围，格式：挂载点//目录/子目录')
  .option('--codes <codes>', '款号/款色编码，支持逗号、分号、换行')
  .option('--codes-file <path>', '从文本文件读取款号/款色编码')
  .option('-o, --output <dir>', '本地导出目录', path.resolve(process.cwd(), 'semir-yunpan-downloads'))
  .option('-l, --limit <n>', '每个编码最多读取的搜索结果', '500')
  .option('--duplicate-mode <mode>', '重复图处理: first_per_stem/all', 'first_per_stem')
  .option('--spu-match-mode <mode>', '款号匹配模式: color_skc_all/representative', 'color_skc_all')
  .option('--layout <mode>', '导出结构: by_code/flat', 'by_code')
  .option('--concurrency <n>', '下载并发数', '4')
  .option('--dry-run', '只输出匹配与本地路径计划，不获取临时下载 URL，不落盘')
  .description('批量按款号/SPU 或款色/SKC 搜图并下载，复用抓虾已跑通的筛选规则')
  .action(withClient(async (client, args, opts) => {
    const codes = await collectCodes(args, opts);
    if (!codes.length) throw new SemirCliError('EX_USAGE', '请提供至少一个款号或款色编码', 64);
    const plan = await buildImageDownloadPlan(client, {
      cloudPath: stringOpt(opts, 'cloudPath') ?? '',
      codes,
      outputDir: path.resolve(stringOpt(opts, 'output') ?? 'semir-yunpan-downloads'),
      includeDownloadUrls: !boolOpt(opts, 'dryRun'),
      duplicateMode: stringOpt(opts, 'duplicateMode'),
      spuMatchMode: stringOpt(opts, 'spuMatchMode'),
      layout: stringOpt(opts, 'layout'),
      limit: Number(stringOpt(opts, 'limit') ?? 500)
    });

    if (boolOpt(opts, 'dryRun') || !plan.jobs.length) {
      write(imageDownloadRows(plan.rows), opts.format);
      return;
    }

    const downloadResults = await runDownloadJobs(plan.jobs.map((job) => ({
      url: job.url,
      destination: job.destination,
      headers: job.headers
    })), Number(stringOpt(opts, 'concurrency') ?? 4));
    write(imageDownloadRows(finalizeImageDownloadRows(plan.rows, downloadResults)), opts.format);
  }));

program.command('preview-url')
  .argument('<path>', '完整云盘路径')
  .option('-m, --mount <id>', '云盘库 mount_id', String(DEFAULT_MOUNT_ID))
  .description('输出单个文件的临时预览 URL')
  .action(withClient(async (client, args, opts) => {
    write({ url: await client.previewUrl({ mountId: stringOpt(opts, 'mount'), path: args[0] }) }, opts.format);
  }));

program.parseAsync(process.argv).catch((error: unknown) => {
  if (error instanceof SemirCliError) {
    console.error(`[${error.code}] ${error.message}`);
    process.exitCode = error.exitCode;
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function withClient(handler: (client: SemirYunpanClient, args: string[], opts: Record<string, unknown>) => Promise<void>) {
  return async (...raw: unknown[]) => {
    const command = extractActionCommand<Command>(raw);
    const args = extractActionArgs(raw);
    const opts = command.optsWithGlobals<Record<string, unknown>>();
    const page = await connectPage(opts);
    try {
      const client = new SemirYunpanClient(page.fetchJson.bind(page));
      await handler(client, args, opts);
    } finally {
      await page.close();
    }
  };
}

async function connectPage(opts: Record<string, unknown>): Promise<CdpPage> {
  return CdpPage.connect({
    cdpUrl: stringOpt(opts, 'cdpUrl') ?? DEFAULT_CDP_URL,
    urlPrefix: stringOpt(opts, 'urlPrefix') ?? DEFAULT_URL_PREFIX,
    loginUrl: stringOpt(opts, 'loginUrl') ?? DEFAULT_LOGIN_URL,
    loginTimeoutMs: secondsOpt(opts, 'loginTimeout', 300) * 1000,
    loginPollMs: secondsOpt(opts, 'loginPoll', 2) * 1000,
    onLoginWait: (status) => {
      const hint = status.onLoginPage ? '当前看起来在登录页' : `当前接口状态 HTTP ${status.status ?? 0}`;
      console.error(`请在 9222 Chrome 打开的森马云盘页面完成登录，CLI 会继续等待。${hint}`);
    }
  });
}

function stringOpt(opts: Record<string, unknown>, key: string, fallback?: string): string | undefined {
  const value = opts[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

function boolOpt(opts: Record<string, unknown>, key: string): boolean {
  return opts[key] === true;
}

function secondsOpt(opts: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(stringOpt(opts, key) ?? fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function collectCodes(args: string[], opts: Record<string, unknown>): Promise<string[]> {
  const parts: string[] = [];
  if (args.length) parts.push(args.join('\n'));
  const inline = stringOpt(opts, 'codes');
  if (inline) parts.push(inline);
  const file = stringOpt(opts, 'codesFile');
  if (file) parts.push(await readFile(path.resolve(file), 'utf8'));
  return normalizeCodes(parts.join('\n'));
}

function write(data: unknown, format: unknown) {
  process.stdout.write(render(data, normalizeFormat(format)));
}

function normalizeFormat(value: unknown): OutputFormat {
  const format = String(value ?? defaultFormat());
  if (['json', 'ndjson', 'csv', 'md', 'table'].includes(format)) return format as OutputFormat;
  return 'table';
}

function defaultFormat(): OutputFormat {
  return process.stdout.isTTY ? 'table' : 'json';
}

function fileRows(files: CloudFile[]): Record<string, unknown>[] {
  return pickFields(files as unknown as Record<string, unknown>[], [
    'filename',
    'fullpath',
    'isDir',
    'ext',
    'filesize',
    'lastTime',
    'lastMemberName',
    'mountId'
  ]);
}

function styleRows(items: RankedStyleResult[]): Record<string, unknown>[] {
  return items.map((item, index) => ({
    rank: index + 1,
    score: item.score,
    kind: item.classification.kind,
    assetRole: item.classification.assetRole,
    filename: item.file.filename,
    fullpath: item.file.fullpath,
    filesize: item.file.filesize,
    lastTime: item.file.lastTime,
    mountId: item.file.mountId
  }));
}

function styleGroupRows(groups: StyleGroup[]): Record<string, unknown>[] {
  return groups.map((group) => ({
    styleNo: group.styleNo,
    packagePath: group.packagePath,
    fileCount: group.fileCount,
    imageCount: group.imageCount,
    sourceCount: group.sourceCount,
    topFile: group.items[0]?.file.filename ?? '',
    topRole: group.items[0]?.classification.assetRole ?? ''
  }));
}

function imageDownloadRows(rows: ImageDownloadRow[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    inputCode: row.inputCode,
    matchType: row.matchType,
    filename: row.filename,
    sourceFilename: row.sourceFilename ?? '',
    cloudPath: row.cloudPath,
    downloadStatus: row.downloadStatus,
    localFile: row.localFile,
    note: row.note,
    mountId: row.mountId ?? '',
    mountName: row.mountName ?? ''
  }));
}
