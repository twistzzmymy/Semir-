import type { CloudFile } from './files.js';
import {
  classifyCode,
  compact,
  escapeRegExp,
  getExt,
  getFileStem,
  isWithinRelativePath,
  pathSegments,
  toSafeFilename
} from './rules.js';

export type ShenhuiSourceType = 'model' | 'still';
export type ShenhuiAssetRole = 'image' | 'yq' | 'pdf_yq' | 'skip';

export interface ShenhuiAssetClassification {
  role: ShenhuiAssetRole;
  keep: boolean;
  action: string;
  reason: string;
  packageFilename: string;
  pdfType?: 'wash_label' | 'hang_tag';
}

export const SHENHUI_SOURCE_LABELS: Record<ShenhuiSourceType, string> = {
  model: '模特图',
  still: '静物图'
};

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff']);
const PDF_EXTS = new Set(['pdf']);
const PSD_EXTS = new Set(['psd']);
const ASSET_EXTS = new Set([...IMAGE_EXTS, ...PDF_EXTS, ...PSD_EXTS]);
const HANG_TAG_PATTERNS = [/吊牌|吊卡|挂牌|商品标签|标签/];
const WASH_LABEL_PATTERNS = [/水洗|洗唛|洗标|洗水/];
const LABEL_IMAGE_PATTERNS = [...HANG_TAG_PATTERNS, ...WASH_LABEL_PATTERNS];
const CARD_PAPER_PATTERNS = [/卡纸|手写/];
const MODEL_REMOVABLE_LABEL_PATTERNS = [...LABEL_IMAGE_PATTERNS, /卡头|卡纸/];

export function getGroupCode(code: string): string {
  const value = compact(code);
  return value.includes('-') ? value.split('-')[0] : value;
}

export function getSourceMarker(sourceType: ShenhuiSourceType): string {
  return sourceType === 'model' ? '模拍原图' : '平拍原图';
}

export function deriveBroadSourcePrefix(relativePath: string, sourceType: ShenhuiSourceType): string {
  const segments = pathSegments(relativePath);
  let moduleIndex = -1;
  for (let index = 0; index < segments.length; index += 1) {
    if (/产品上新/.test(segments[index])) moduleIndex = index;
  }
  if (moduleIndex >= 0) return segments.slice(0, moduleIndex + 1).join('/');
  const marker = getSourceMarker(sourceType);
  const markerIndex = segments.findIndex((segment) => segment === marker);
  if (markerIndex > 0) return segments.slice(0, markerIndex).join('/');
  return String(relativePath || '').trim();
}

export function normalizeShenhuiSourceTypes(rawValue: unknown): ShenhuiSourceType[] {
  if (Array.isArray(rawValue)) {
    const sourceTypes = rawValue.filter((item): item is ShenhuiSourceType => item === 'model' || item === 'still');
    return sourceTypes.length ? sourceTypes : ['model', 'still'];
  }
  const value = compact(rawValue).toLowerCase();
  if (value === 'model') return ['model'];
  if (value === 'still') return ['still'];
  return ['model', 'still'];
}

export function normalizeShenhuiDuplicateMode(value: unknown): 'first_per_path' | 'all' {
  return compact(value).toLowerCase() === 'all' ? 'all' : 'first_per_path';
}

export function normalizeFolderScanDepth(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(0, Math.min(8, Math.floor(parsed)));
}

export function isSupportedShenhuiAssetItem(file: CloudFile): boolean {
  return !file.isDir && ASSET_EXTS.has(getExt(file));
}

export function isPackagingFolderItem(file: CloudFile): boolean {
  if (!file.isDir) return false;
  const folderName = compact(file.filename || lastPathSegment(file.fullpath));
  return /包装/.test(folderName);
}

export function isWithinBroadSourceScope(fullpath: string, sourceConfig: { broadRelativePath?: string }, sourceType: ShenhuiSourceType): boolean {
  const normalized = String(fullpath || '').replace(/\\/g, '/');
  const prefix = String(sourceConfig.broadRelativePath || '').trim();
  if (prefix && !(normalized === prefix || normalized.startsWith(`${prefix}/`))) return false;
  return pathSegments(normalized).includes(getSourceMarker(sourceType));
}

export function isSkcLikeStemForShenhuiSpu(stem: unknown, code: unknown): boolean {
  const target = compact(code);
  if (!target) return false;
  return new RegExp(`^${escapeRegExp(target)}-\\d{5}(?:$|[\\s_\\-])`, 'i').test(compact(stem));
}

export function matchesShenhuiFilenameCode(filename: unknown, code: unknown): boolean {
  const stem = compact(getFileStem(filename));
  const target = compact(code);
  if (!stem || !target) return false;
  if (classifyCode(target) === 'skc') return startsWithShenhuiCodeToken(stem, target);
  return startsWithShenhuiCodeToken(stem, target) || isSkcLikeStemForShenhuiSpu(stem, target);
}

export function pathContainsShenhuiCode(fullpath: unknown, code: unknown): boolean {
  return pathSegments(fullpath).some((segment) => matchesShenhuiFilenameCode(segment, code) || startsWithShenhuiCodeToken(segment, code));
}

export function matchesShenhuiAssetItemForCode(file: CloudFile, code: string): boolean {
  return matchesShenhuiFilenameCode(file.filename, code) || pathContainsShenhuiCode(file.fullpath, code);
}

export function matchesShenhuiFolderItemForCode(file: CloudFile, code: string): boolean {
  return file.isDir && pathContainsShenhuiCode(file.fullpath || file.filename, code);
}

export function dedupeShenhuiItemsByFullpath(files: CloudFile[], duplicateMode: unknown): CloudFile[] {
  if (normalizeShenhuiDuplicateMode(duplicateMode) === 'all') return [...files];
  const result: CloudFile[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const key = String(file.fullpath || file.filename).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(file);
  }
  return result;
}

export function classifyShenhuiAsset(sourceType: ShenhuiSourceType, file: CloudFile): ShenhuiAssetClassification {
  const ext = getExt(file);
  const text = `${file.filename} ${file.fullpath}`;
  const skip = (reason: string): ShenhuiAssetClassification => ({
    role: 'skip',
    keep: false,
    action: '已过滤',
    reason,
    packageFilename: ''
  });

  if (PSD_EXTS.has(ext)) return skip('.psd 文件按 SOP 删除');

  if (PDF_EXTS.has(ext)) {
    const pdfType = inferSopPdfType(file);
    if (!pdfType) return skip('非洗唛/吊牌 PDF 按 SOP 跳过');
    return {
      role: 'pdf_yq',
      keep: true,
      action: '保留PDF并自动截图',
      reason: pdfType === 'wash_label' ? '洗唛 PDF 将按截图模板自动生成 yq(2)' : '吊牌 PDF 将按截图模板自动生成 yq(1)',
      packageFilename: toSafeFilename(file.filename || `label.${ext}`, `label.${ext || 'pdf'}`),
      pdfType
    };
  }

  if (!IMAGE_EXTS.has(ext)) return skip(`不支持的文件类型：${ext || '未知'}`);

  if (sourceType === 'model') {
    if (isModelWhiteBackgroundFilename(file.filename)) return skip('模特图包白底图按命名规则删除');
    if (isModelMLeadingImageFilename(file.filename)) return skip('模特图包 m 开头图片按规则删除');
    if (/包装/.test(text)) return skip('模特图包包装图按 SOP 删除');
    if (/静物|平拍/.test(text)) return skip('模特图包内静物图按 SOP 删除');
    if (hasFilenameOrExplicitParentMarker(file, MODEL_REMOVABLE_LABEL_PATTERNS)) return skip('模特图包内吊牌/卡头/水洗类图片按 SOP 删除');
    return {
      role: 'image',
      keep: true,
      action: '保留模特图',
      reason: '',
      packageFilename: toSafeFilename(file.filename || `model.${ext}`, `model.${ext || 'jpg'}`)
    };
  }

  if (hasFilenameOrExplicitParentMarker(file, CARD_PAPER_PATTERNS)) return skip('静物图包内卡纸吊牌/手写水洗按 SOP 删除');
  if (/包装/.test(text)) return skip('包装图按 SOP 删除');
  if (hasFilenameOrExplicitParentMarker(file, LABEL_IMAGE_PATTERNS) || hasLabelStatusParentMarker(file)) {
    return {
      role: 'yq',
      keep: true,
      action: '保留并命名为yq',
      reason: '吊牌/水洗图片按 SOP 命名为 yq',
      packageFilename: ext ? `yq.${ext}` : 'yq.jpg'
    };
  }

  return {
    role: 'image',
    keep: true,
    action: '保留静物图',
    reason: '',
    packageFilename: toSafeFilename(file.filename || `still.${ext}`, `still.${ext || 'jpg'}`)
  };
}

export function buildShenhuiRuntimeFilename(code: string, sourceType: ShenhuiSourceType, file: CloudFile, itemIndex: number): string {
  const ext = getExt(file);
  const suffix = ext ? `.${ext}` : '';
  const itemId = getFileStem(file.id || file.hash || file.filehash || itemIndex + 1);
  const stem = toSafeFilename(`${toSafeFilename(getGroupCode(code), 'code')}__${sourceType}__${toSafeFilename(itemId)}__${getFileStem(file.filename)}`, 'download');
  return suffix && !stem.toLowerCase().endsWith(suffix) ? `${stem}${suffix}` : stem;
}

export { isWithinRelativePath };

function startsWithShenhuiCodeToken(value: unknown, code: unknown): boolean {
  const text = compact(value).toLowerCase();
  const target = compact(code).toLowerCase();
  if (!text || !target) return false;
  return new RegExp(`^${escapeRegExp(target)}(?:$|[\\s_+\\-])`, 'i').test(text);
}

function isModelWhiteBackgroundFilename(filename: unknown): boolean {
  const stem = compact(getFileStem(filename));
  return !!stem && /^(?:m\(1\)\.)?\d{12}-\d{5}(?:\s*\(\d+\))?$/i.test(stem);
}

function isModelMLeadingImageFilename(filename: unknown): boolean {
  const stem = compact(getFileStem(filename));
  return !!stem && /^m/i.test(stem);
}

function hasAny(text: unknown, patterns: RegExp[]): boolean {
  const source = String(text || '');
  return patterns.some((pattern) => pattern.test(source));
}

function parentPathSegment(fullpath: unknown): string {
  const segments = pathSegments(fullpath);
  return segments.length >= 2 ? segments[segments.length - 2] : '';
}

function lastPathSegment(fullpath: unknown): string {
  const segments = pathSegments(fullpath);
  return segments.length ? segments[segments.length - 1] : '';
}

function isStatusNoteFolderName(folderName: unknown): boolean {
  const text = compact(folderName);
  if (!text) return false;
  if (/^\d{8,}(?:$|[\s_\-])/.test(text)) return true;
  return /已补|已写|已选|回齐|回图|新回|上市|可选|导购|差\d*|缺\d*/i.test(text);
}

function hasFilenameOrExplicitParentMarker(file: CloudFile, patterns: RegExp[]): boolean {
  if (hasAny(file.filename, patterns)) return true;
  const parent = parentPathSegment(file.fullpath);
  if (!parent || isStatusNoteFolderName(parent)) return false;
  return hasAny(parent, patterns);
}

function isChatUploadImageFilename(filename: unknown): boolean {
  const name = compact(filename);
  return /^lQLP[0-9A-Za-z_-]+\.(?:png|jpe?g|webp)$/i.test(name);
}

function hasLabelStatusParentMarker(file: CloudFile): boolean {
  if (!isChatUploadImageFilename(file.filename)) return false;
  const parent = parentPathSegment(file.fullpath);
  return isStatusNoteFolderName(parent) && hasAny(parent, LABEL_IMAGE_PATTERNS);
}

function inferSopPdfType(file: CloudFile): ShenhuiAssetClassification['pdfType'] | '' {
  if (hasFilenameOrExplicitParentMarker(file, WASH_LABEL_PATTERNS)) return 'wash_label';
  if (hasFilenameOrExplicitParentMarker(file, [...HANG_TAG_PATTERNS, /合格证/])) return 'hang_tag';
  return '';
}
