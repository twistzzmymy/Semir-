import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_PATH = path.join(__dirname, 'dist', 'cli.js');
const MOUNT_ID = '1863';
const CLOUD_ROOT = '品牌视觉部/服饰包装组/巴拉服饰产品包装/01-产品包装';
const OUTPUT_BASE = path.join(__dirname, '326搜推图');

const CODES = [
  '208326146203',
  '208326141008',
  '208326141010',
  '208326146201',
  '208326146202',
  '208326141011',
  '208326146209',
  '208326140202',
  '2083261402H3',
  '2083261402H8',
  '208326140011',
  '208326146207',
  '208326140010',
];

const UNIQUE_CODES = [...new Set(CODES)];

function runCli(args) {
  try {
    const output = execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024,
    });
    return { success: true, output };
  } catch (err) {
    return { success: false, output: err.stdout || '', stderr: err.stderr || '' };
  }
}

function listDirFiles(dirPath) {
  const result = runCli(['ls', dirPath, '-m', MOUNT_ID, '-l', '200', '-f', 'json']);
  
  if (!result.success) return [];
  
  try {
    const data = JSON.parse(result.output.trim());
    return Array.isArray(data) ? data : (data.files || []);
  } catch (e) {
    return [];
  }
}

function downloadFile(cloudPath, destFile) {
  const result = runCli([
    'download', cloudPath,
    '-m', MOUNT_ID,
    '-o', destFile,
  ]);
  return result.success && fs.existsSync(destFile);
}

function findCodePackageDir(code) {
  const quarters = ['2026Q3', '2026Q2', '2026Q1', '2025Q4', '2025Q3', '2025Q2', '2025Q1'];
  
  for (const quarter of quarters) {
    const shoesDir = `${CLOUD_ROOT}/${quarter}/鞋品`;
    const codeDir = `${shoesDir}/${code}`;
    
    const codeFiles = listDirFiles(codeDir);
    if (codeFiles.length > 0) {
      return codeDir;
    }
  }
  
  return null;
}

function findMainAndColorDirs(packageDir) {
  const mainDirs = [];
  const colorDirs = [];
  const creativeDirs = [];
  
  const items = listDirFiles(packageDir);
  for (const item of items) {
    if (item.isDir) {
      if (item.filename === '主图') {
        mainDirs.push(packageDir + '/' + item.filename);
      } else if (item.filename === '颜色') {
        colorDirs.push(packageDir + '/' + item.filename);
      } else if (item.filename === '创意拍') {
        creativeDirs.push(packageDir + '/' + item.filename);
      }
    }
  }
  
  return { mainDirs, colorDirs, creativeDirs };
}

function download1440Images(dirs, code, skipExisting = true) {
  const allImages = [];
  
  for (const dir of dirs) {
    const files = listDirFiles(dir);
    for (const f of files) {
      if (!f.isDir && f.filename.includes('1440_1440') && f.filename.match(/\.(jpg|jpeg|png)$/i)) {
        allImages.push({ ...f, sourceDir: dir });
      }
    }
  }
  
  if (allImages.length === 0) {
    return 0;
  }

  console.log(`  找到 ${allImages.length} 张 1440_1440 图片`);
  
  const codeDir = path.join(OUTPUT_BASE, code);
  if (!fs.existsSync(codeDir)) {
    fs.mkdirSync(codeDir, { recursive: true });
  }

  // 获取已下载文件数量
  const existingFiles = fs.existsSync(codeDir) ? fs.readdirSync(codeDir).filter(f => f.includes('1440_1440')) : [];
  const existingCount = existingFiles.length;
  
  let downloaded = 0;
  for (const item of allImages) {
    // 如果已下载10张以上，跳过
    if (skipExisting && existingCount + downloaded >= 10) {
      console.log(`  已达到10张，跳过剩余图片`);
      break;
    }
    
    const destFile = path.join(codeDir, item.filename);
    // 如果文件已存在，跳过
    if (skipExisting && fs.existsSync(destFile)) {
      continue;
    }
    
    const success = downloadFile(item.fullpath, destFile);
    if (success) {
      downloaded++;
      const sizeMB = (fs.statSync(destFile).size / (1024 * 1024)).toFixed(1);
      console.log(`  [OK] ${item.filename} (${sizeMB} MB)`);
    } else {
      console.log(`  [失败] ${item.filename}`);
    }
  }
  
  return downloaded;
}

function main() {
  const report = [];
  let totalDownloaded = 0;

  console.log('='.repeat(60));
  console.log('鞋品图包下载（1440_1440）');
  console.log(`挂载点: ${MOUNT_ID} (巴拉巴拉品牌事业部-市场系统)`);
  console.log(`云盘根路径: ${CLOUD_ROOT}`);
  console.log(`输出路径: ${OUTPUT_BASE}`);
  console.log('='.repeat(60));

  for (const code of UNIQUE_CODES) {
    console.log(`\n=== 款号: ${code} ===`);

    const packageDir = findCodePackageDir(code);
    if (!packageDir) {
      console.log(`  未找到款号 ${code} 的鞋品目录`);
      report.push({ 款号: code, 状态: '未找到鞋品目录', 下载数量: 0 });
      continue;
    }

    console.log(`  鞋品目录: ${packageDir}`);

    const { mainDirs, colorDirs, creativeDirs } = findMainAndColorDirs(packageDir);
    console.log(`  主图: ${mainDirs.length} 个, 颜色: ${colorDirs.length} 个, 创意拍: ${creativeDirs.length} 个`);
    
    const allDirs = [...mainDirs, ...colorDirs];
    if (allDirs.length === 0) {
      console.log(`  未找到主图/颜色文件夹`);
      report.push({ 款号: code, 状态: '无主图/颜色文件夹', 下载数量: 0 });
      continue;
    }

    const downloaded = download1440Images(allDirs, code);
    totalDownloaded += downloaded;
    
    // 检查是否不足10张，如果不足且有创意拍文件夹，补充下载
    const codeDir = path.join(OUTPUT_BASE, code);
    const currentCount = fs.existsSync(codeDir) ? fs.readdirSync(codeDir).filter(f => f.includes('1440_1440')).length : 0;
    
    if (currentCount < 10 && creativeDirs.length > 0) {
      console.log(`  当前仅 ${currentCount} 张，补充下载创意拍图片...`);
      const creativeDownloaded = download1440Images(creativeDirs, code);
      totalDownloaded += creativeDownloaded;
    }
    
    const finalCount = fs.existsSync(codeDir) ? fs.readdirSync(codeDir).filter(f => f.includes('1440_1440')).length : 0;
    
    if (finalCount === 0) {
      report.push({ 款号: code, 状态: '无1440_1440图片', 下载数量: 0 });
    } else {
      report.push({ 款号: code, 状态: '完成', 下载数量: finalCount });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('下载报告');
  console.log('='.repeat(60));
  console.table(report);
  console.log(`\n总计: 下载 ${totalDownloaded} 张 1440_1440 图片`);
}

main();