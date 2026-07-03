import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_PATH = path.join(__dirname, 'dist', 'cli.js');
const MOUNT_ID = '2023';
const OUTPUT_BASE = path.join(__dirname, '326搜推图');
const MAX_PER_CODE = 10;

const CODE_DIRS = {
  '208326100222': ['巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/模拍原图/期货/0P/幼童/208326100222-缺1色6.1-已选齐6.12-已选6.15'],
  '208326120201': ['巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉秋/模拍原图/期货/1P/新生儿/208326120201-AI新回图7.1'],
};

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

function containsYzOsYs(filename) {
  const nameLower = filename.toLowerCase();
  return nameLower.includes('yz') || nameLower.includes('o(') || nameLower.includes('ys');
}

function classifyFile(filename) {
  const nameLower = filename.toLowerCase();
  
  if (nameLower.includes('yz')) {
    return { priority: 0, keyword: 'yz' };
  }
  
  if (nameLower.includes('o(')) {
    return { priority: 1, keyword: 'o' };
  }
  
  if (nameLower.includes('ys')) {
    return { priority: 2, keyword: 'ys' };
  }
  
  return { priority: 99, keyword: 'other' };
}

function scoreAndSort(files) {
  return files.map((f) => {
    const { priority, keyword } = classifyFile(f.filename);
    return { ...f, priority, keyword };
  }).sort((a, b) => a.priority - b.priority);
}

function downloadFile(cloudPath, destFile) {
  const result = runCli([
    'download', cloudPath,
    '-m', MOUNT_ID,
    '-o', destFile,
  ]);
  return result.success && fs.existsSync(destFile);
}

function main() {
  const report = [];
  let totalDownloaded = 0;

  console.log('='.repeat(60));
  console.log('补充下载5个款号的yz/o/ys图片');
  console.log(`输出路径: ${OUTPUT_BASE}`);
  console.log('='.repeat(60));

  for (const [code, dirs] of Object.entries(CODE_DIRS)) {
    console.log(`\n=== 款号: ${code} ===`);

    console.log(`  目录: ${dirs.join(', ')}`);

    const allFiles = [];
    for (const dir of dirs) {
      const dirFiles = listDirFiles(dir);
      const yzOsYsFiles = dirFiles.filter((f) => 
        !f.isDir && 
        f.filename.match(/\.(jpg|jpeg|png)$/i) && 
        containsYzOsYs(f.filename)
      );
      yzOsYsFiles.forEach((f) => {
        if (!allFiles.some((existing) => existing.fullpath === f.fullpath)) {
          allFiles.push(f);
        }
      });
    }

    if (allFiles.length === 0) {
      console.log(`  未找到 yz/o/ys 图片`);
      report.push({ 款号: code, 目录数: dirs.length, 图片数: 0, 下载成功: 0, 下载失败: 0 });
      continue;
    }

    console.log(`  搜索到: ${allFiles.length} 张 yz/o/ys 图片`);

    const scored = scoreAndSort(allFiles);
    const selected = scored.slice(0, MAX_PER_CODE);

    const countByKeyword = { yz: 0, o: 0, ys: 0 };
    selected.forEach((s) => (countByKeyword[s.keyword] = (countByKeyword[s.keyword] || 0) + 1));

    console.log(`  筛选后: ${selected.length} 张 (yz=${countByKeyword.yz}, o=${countByKeyword.o}, ys=${countByKeyword.ys})`);

    const codeDir = path.join(OUTPUT_BASE, code);
    if (!fs.existsSync(codeDir)) {
      fs.mkdirSync(codeDir, { recursive: true });
    }

    let downloaded = 0;
    let failed = 0;

    for (const item of selected) {
      const destFile = path.join(codeDir, item.filename);
      const success = downloadFile(item.fullpath, destFile);
      if (success) {
        downloaded++;
        const sizeMB = (fs.statSync(destFile).size / (1024 * 1024)).toFixed(1);
        console.log(`  [OK] ${item.filename} (${sizeMB} MB) [${item.keyword}]`);
      } else {
        failed++;
        console.log(`  [失败] ${item.filename}`);
      }
    }

    totalDownloaded += downloaded;
    report.push({
      款号: code,
      目录数: dirs.length,
      图片数: allFiles.length,
      yz: countByKeyword.yz || 0,
      o: countByKeyword.o || 0,
      ys: countByKeyword.ys || 0,
      下载成功: downloaded,
      下载失败: failed,
    });
  }

  const noMoPanCodes = ['208326120202', '208326156203', '208326160203'];
  for (const code of noMoPanCodes) {
    console.log(`\n=== 款号: ${code} ===`);
    console.log(`  未找到模拍原图目录，无 yz/o/ys 图片`);
    report.push({ 款号: code, 目录数: 0, 图片数: 0, 下载成功: 0, 下载失败: 0 });
  }

  console.log('\n' + '='.repeat(60));
  console.log('补充下载报告');
  console.log('='.repeat(60));
  console.table(report);
  console.log(`\n总计: 下载 ${totalDownloaded} 张图片`);
}

main();