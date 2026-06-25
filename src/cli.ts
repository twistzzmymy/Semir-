#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Command } from 'commander';
import { DEFAULT_CDP_URL, DEFAULT_LOGIN_URL, DEFAULT_MOUNT_ID, DEFAULT_URL_PREFIX } from './api.js';
import { buildCatalogDownloadPlan, finalizeCatalogDownloadRows, type CatalogDownloadRow } from './catalog-download.js';
import { getCapability, runCapability } from './capabilities.js';
import { extractActionArgs, extractActionCommand } from './cli-args.js';
import { CdpPage, probeSemirLogin } from './cdp.js';
import { SemirYunpanClient } from './client.js';
import { downloadUrlToFile, runDownloadJobs } from './download.js';
import { SemirCliError } from './errors.js';
import { groupStyleResults, rankStyleResults, type CloudFile, type RankedStyleResult, type StyleGroup } from './files.js';
import { buildImageCatalog, type ImageCatalogRow } from './image-catalog.js';
import { buildImageDownloadPlan, finalizeImageDownloadRows, type ImageDownloadRow } from './image-plan.js';
import { type OutputFormat, pickFields, render } from './output.js';
import { readCapabilityInput } from './run-input.js';
import { buildRuleImagePlan, finalizeRuleImageRows, parseImagePickRules, type RuleImageRow } from './rule-image-plan.js';
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

program.command('download-by-rules')
  .alias('pick-images')
  .argument('[codes...]', '款号/款色编码；也可以用 --codes 或 --codes-file')
  .requiredOption('--cloud-path <path>', '云盘搜索范围，格式：挂载点//目录/子目录；可指向批次目录或具体款色目录')
  .requiredOption('--rules <rules>', '选图规则，例如：全身=stem:3-1,静物=stem:{code}')
  .option('--codes <codes>', '款号/款色编码，支持逗号、分号、换行')
  .option('--codes-file <path>', '从文本文件读取款号/款色编码')
  .option('-o, --output <dir>', '本地导出目录', path.resolve(process.cwd(), 'semir-yunpan-downloads'))
  .option('-l, --limit <n>', '每个目录最多读取的文件数', '200')
  .option('--layout <mode>', '导出结构: by_code/flat', 'by_code')
  .option('--concurrency <n>', '下载并发数', '4')
  .option('--dry-run', '只输出匹配与本地路径计划，不获取临时下载 URL，不落盘')
  .description('按路径、款号和用户指定规则挑选图片并下载')
  .action(withClient(async (client, args, opts) => {
    const codes = await collectCodes(args, opts);
    if (!codes.length) throw new SemirCliError('EX_USAGE', '请提供至少一个款号或款色编码', 64);
    const rules = parseImagePickRules(stringOpt(opts, 'rules'));
    if (!rules.length) throw new SemirCliError('EX_USAGE', '请提供至少一条选图规则，例如：全身=stem:3-1,静物=stem:{code}', 64);

    const plan = await buildRuleImagePlan(client, {
      cloudPath: stringOpt(opts, 'cloudPath') ?? '',
      codes,
      rules,
      outputDir: path.resolve(stringOpt(opts, 'output') ?? 'semir-yunpan-downloads'),
      includeDownloadUrls: !boolOpt(opts, 'dryRun'),
      layout: stringOpt(opts, 'layout'),
      limit: Number(stringOpt(opts, 'limit') ?? 200)
    });

    if (boolOpt(opts, 'dryRun') || !plan.jobs.length) {
      write(ruleImageRows(plan.rows), opts.format);
      return;
    }

    const downloadResults = await runDownloadJobs(plan.jobs.map((job) => ({
      url: job.url,
      destination: job.destination,
      headers: job.headers
    })), Number(stringOpt(opts, 'concurrency') ?? 4));
    write(ruleImageRows(finalizeRuleImageRows(plan.rows, downloadResults)), opts.format);
  }));

program.command('inspect-images')
  .argument('[codes...]', '款号/款色编码；也可以用 --codes 或 --codes-file')
  .requiredOption('--cloud-path <path>', '云盘搜索范围，格式：挂载点//目录/子目录；可指向范围目录或具体款色目录')
  .option('--folder-rule <rule>', '定位文件夹规则: name:{code}/glob:*{code}*/regex:...', 'name:{code}')
  .option('--rules <rules>', '可选选图规则，例如：全身=3-1,静物={code}')
  .option('--codes <codes>', '款号/款色编码，支持逗号、分号、换行')
  .option('--codes-file <path>', '从文本文件读取款号/款色编码')
  .option('--selected-only', '只输出命中 --rules 的图片')
  .option('--include-download-urls', '显式输出每张图片的临时下载 URL')
  .option('--search-limit <n>', '每个编码最多读取的搜索结果', '100')
  .option('--list-limit <n>', '每个文件夹最多列出的文件数', '500')
  .description('按云盘范围和款号规则定位文件夹，列出全部图片并按用户规则标记命中项')
  .action(withClient(async (client, args, opts) => {
    const codes = await collectCodes(args, opts);
    if (!codes.length) throw new SemirCliError('EX_USAGE', '请提供至少一个款号或款色编码', 64);

    const catalog = await buildImageCatalog(client, {
      cloudPath: stringOpt(opts, 'cloudPath') ?? '',
      codes,
      folderRule: stringOpt(opts, 'folderRule'),
      rules: stringOpt(opts, 'rules') ?? '',
      searchLimit: Number(stringOpt(opts, 'searchLimit') ?? 100),
      listLimit: Number(stringOpt(opts, 'listLimit') ?? 500),
      selectedOnly: boolOpt(opts, 'selectedOnly'),
      includeDownloadUrls: boolOpt(opts, 'includeDownloadUrls')
    });
    write(imageCatalogRows(catalog.rows), opts.format);
  }));

program.command('download-catalog')
  .argument('[codes...]', '款号/款色编码；也可以用 --codes 或 --codes-file')
  .option('--input-file <path>', '读取 inspect-images --include-download-urls -f json 输出的图片行')
  .option('--cloud-path <path>', '云盘搜索范围，格式：挂载点//目录/子目录；未提供 --input-file 时必填')
  .option('--folder-rule <rule>', '定位文件夹规则: name:{code}/glob:*{code}*/regex:...', 'name:{code}')
  .option('--rules <rules>', '可选选图规则，例如：全身=3-1,静物={code}')
  .option('--codes <codes>', '款号/款色编码，支持逗号、分号、换行')
  .option('--codes-file <path>', '从文本文件读取款号/款色编码')
  .option('--selected-only', '只下载命中 --rules 或 inspected rows 中 selected=true 的图片')
  .option('-o, --output <dir>', '本地导出目录', path.resolve(process.cwd(), 'semir-yunpan-downloads'))
  .option('--layout <mode>', '导出结构: by_code/flat', 'by_code')
  .option('--concurrency <n>', '下载并发数', '4')
  .option('--search-limit <n>', '每个编码最多读取的搜索结果', '100')
  .option('--list-limit <n>', '每个文件夹最多列出的文件数', '500')
  .description('批量下载 inspect-images 发现的图片清单')
  .action(async (...raw: unknown[]) => {
    const command = extractActionCommand<Command>(raw);
    const args = extractActionArgs(raw);
    const opts = command.optsWithGlobals<Record<string, unknown>>();
    const outputDir = path.resolve(stringOpt(opts, 'output') ?? 'semir-yunpan-downloads');
    const inputFile = stringOpt(opts, 'inputFile');
    let rows: ImageCatalogRow[];

    if (inputFile) {
      rows = await readCatalogRowsFile(inputFile);
    } else {
      const cloudPath = stringOpt(opts, 'cloudPath');
      if (!cloudPath) throw new SemirCliError('EX_USAGE', '请提供 --cloud-path，或用 --input-file 读取 inspect-images 的 JSON 输出', 64);
      const codes = await collectCodes(args, opts);
      if (!codes.length) throw new SemirCliError('EX_USAGE', '请提供至少一个款号或款色编码', 64);
      const page = await connectPage(opts);
      try {
        const client = new SemirYunpanClient(page.fetchJson.bind(page));
        const catalog = await buildImageCatalog(client, {
          cloudPath,
          codes,
          folderRule: stringOpt(opts, 'folderRule'),
          rules: stringOpt(opts, 'rules') ?? '',
          searchLimit: Number(stringOpt(opts, 'searchLimit') ?? 100),
          listLimit: Number(stringOpt(opts, 'listLimit') ?? 500),
          selectedOnly: boolOpt(opts, 'selectedOnly'),
          includeDownloadUrls: true
        });
        rows = catalog.rows;
      } finally {
        await page.close();
      }
    }

    const plan = buildCatalogDownloadPlan(rows, {
      outputDir,
      selectedOnly: boolOpt(opts, 'selectedOnly'),
      layout: stringOpt(opts, 'layout')
    });
    if (!plan.jobs.length) {
      write(catalogDownloadRows(plan.rows), opts.format);
      return;
    }

    const downloadResults = await runDownloadJobs(plan.jobs.map((job) => ({
      url: job.url,
      destination: job.destination,
      headers: job.headers
    })), Number(stringOpt(opts, 'concurrency') ?? 4));
    write(catalogDownloadRows(finalizeCatalogDownloadRows(plan.rows, downloadResults)), opts.format);
  });

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

async function readCatalogRowsFile(inputFile: string): Promise<ImageCatalogRow[]> {
  const text = await readFile(path.resolve(inputFile), 'utf8');
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return parsed as ImageCatalogRow[];
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)) {
    return (parsed as { rows: ImageCatalogRow[] }).rows;
  }
  throw new SemirCliError('EX_USAGE', '--input-file 必须是 inspect-images 输出的 JSON 数组，或包含 rows 数组的对象', 64);
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

function ruleImageRows(rows: RuleImageRow[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    inputCode: row.inputCode,
    ruleLabel: row.ruleLabel,
    rulePattern: row.rulePattern,
    filename: row.filename,
    cloudPath: row.cloudPath,
    downloadStatus: row.downloadStatus,
    localFile: row.localFile,
    note: row.note,
    mountId: row.mountId ?? '',
    mountName: row.mountName ?? ''
  }));
}

function imageCatalogRows(rows: ImageCatalogRow[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    inputCode: row.inputCode,
    folderPath: row.folderPath,
    filename: row.filename,
    cloudPath: row.cloudPath,
    ext: row.ext,
    filesize: row.filesize,
    selected: row.selected,
    matchedRules: row.matchedRules,
    status: row.status,
    note: row.note,
    downloadUrl: row.downloadUrl ?? '',
    mountId: row.mountId ?? '',
    mountName: row.mountName ?? ''
  }));
}

function catalogDownloadRows(rows: CatalogDownloadRow[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    inputCode: row.inputCode,
    filename: row.filename,
    cloudPath: row.cloudPath,
    downloadStatus: row.downloadStatus,
    localFile: row.localFile,
    matchedRules: row.matchedRules,
    note: row.note,
    mountId: row.mountId ?? '',
    mountName: row.mountName ?? ''
  }));
}
