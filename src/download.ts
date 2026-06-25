import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { CloudFile } from './files.js';
import { buildRuntimeFilename, toSafeFilename } from './rules.js';

export type DownloadLayout = 'by_code' | 'flat';

export interface DownloadDestinationOptions {
  outputDir: string;
  layout: DownloadLayout | string;
  code: string;
  file: CloudFile;
  index: number;
  packageFilename?: string;
}

export interface DownloadResult {
  success: boolean;
  path: string;
  bytes: number;
  error?: string;
}

export interface DownloadJob {
  url: string;
  destination: string;
  headers?: Record<string, string>;
}

export function normalizeDownloadLayout(value: unknown): DownloadLayout {
  return String(value ?? '').trim().toLowerCase() === 'flat' ? 'flat' : 'by_code';
}

export function buildDownloadDestination(options: DownloadDestinationOptions): string {
  const layout = normalizeDownloadLayout(options.layout);
  const baseDir = layout === 'by_code'
    ? path.join(options.outputDir, toSafeFilename(options.code, 'code'))
    : options.outputDir;
  const filename = options.packageFilename
    ? toSafeFilename(options.packageFilename, 'download')
    : layout === 'flat'
      ? buildRuntimeFilename(options.code, options.file, options.index)
      : toSafeFilename(options.file.filename, buildRuntimeFilename(options.code, options.file, options.index));
  return path.join(baseDir, filename);
}

export async function downloadUrlToFile(url: string, destination: string, headers: Record<string, string> = {}): Promise<DownloadResult> {
  await mkdir(path.dirname(destination), { recursive: true });
  const response = await fetch(url, { headers });
  if (!response.ok || !response.body) {
    return {
      success: false,
      path: destination,
      bytes: 0,
      error: `HTTP ${response.status} ${response.statusText}`.trim()
    };
  }

  await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(destination));
  const info = await stat(destination);
  return { success: true, path: destination, bytes: info.size };
}

export async function runDownloadJobs(jobs: DownloadJob[], concurrency: number): Promise<DownloadResult[]> {
  const limit = Math.max(1, Math.min(20, Math.floor(Number(concurrency) || 1)));
  const results: DownloadResult[] = new Array(jobs.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < jobs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const job = jobs[index];
      try {
        results[index] = await downloadUrlToFile(job.url, job.destination, job.headers);
      } catch (error) {
        results[index] = {
          success: false,
          path: job.destination,
          bytes: 0,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, () => worker()));
  return results;
}
