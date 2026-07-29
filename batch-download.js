import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_PATH = path.join(__dirname, 'dist', 'cli.js');
const MOUNT_ID = '2023';
const CLOUD_BASE = '巴拉货控/02 产品上新模块/2-2 巴拉产品上新';
const OUTPUT_BASE = path.join(__dirname, 'downloads');
const MAX_PER_CODE = 10;

const CODES = [
  '209326133201',
  '208326100017',
  '208326123001',
  '208326105208',
  '208326100207',
  '208326105203',
  '208326101203',
  '208326133201',
  '208326133204',
  '208326133205',
  '208326137201',
  '208326133209',
  '208326102002',
  '208326100214',
  '208326102203',
  '208326102103',
  '208326100218',
  '208326108215',
  '208326108217',
  '208326105201',
  '208326102205',
  '208326101201',
  '208326105207',
  '208326100208',
  '208326100209',
  '208326105202',
  '208326105205',
  '208326100022',
  '208326100219',
  '208326100222',
  '208326100205',
  '208326100214',
  '208326108221',
  '208326100202',
  '208326104005',
  '208326111001',
  '208326108012',
  '208326105209',
  '208326108208',
  '208326181201',
  '208326101202',
  '208326101203',
  '208326133203',
  '208326133206',
  '208326120201',
  '208326120202',
  '208326120207',
  '208326134203',
  '208326156202',
  '208326156203',
  '208326105004',
  '208326123003',
  '208326100002',
  '208326102001',
  '208326105211',
  '208326103207',
  '208326103208',
  '208326104210',
  '208326108211',
  '208326108212',
  '208326100213',
  '208326100104',
  '208326102202',
  '208326108213',
  '208326100216',
  '208326105218',
  '208326105217',
  '208326105009',
  '208326102105',
  '208326100016',
  '208326103204',
  '208326104201',
  '208326104202',
  '208326100021',
  '208326108014',
  '208326160201',
  '208326160203',
  '208326160203',
  '208326105215',
  '208326100023',
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

function getMoPanDirectories(code) {
  const result = runCli([
    'search', code,
    '-m', MOUNT_ID,
    '-p', CLOUD_BASE,
    '--ext', 'image',
    '-l', '200',
    '-f', 'json',
  ]);

  if (!result.success) return [];

  try {
    const searchResult = JSON.parse(result.output.trim());
    const files = Array.isArray(searchResult) ? searchResult : (searchResult.files || []);
    const moPanFiles = files.filter((f) => !f.isDir && f.fullpath.includes('/模拍原图/'));
    
    const dirs = new Set();
    moPanFiles.forEach((f) => {
      const dir = f.fullpath.substring(0, f.fullpath.lastIndexOf('/'));
      dirs.add(dir);
    });
    
    // 校验目录名是否属于当前款号，防止串款
    const validDirs = [...dirs].filter((dir) => {
      const dirName = dir.substring(dir.lastIndexOf('/') + 1);
      return dirName.startsWith(code);
    });
    
    return validDirs;
  } catch (e) {
    return [];
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
  const dryRun = process.argv.includes('--dry-run');
  const report = [];

  console.log('='.repeat(60));
  console.log(`云盘路径: ${CLOUD_BASE}`);
  console.log(`输出路径: ${OUTPUT_BASE}`);
  console.log(`每款最多: ${MAX_PER_CODE} 张`);
  console.log(`优先级: yz > o > ys`);
  console.log(`模式: ${dryRun ? 'Dry-run（俅测试）' : '实际下载'}`);
  console.log(`款号数量: ${UNIQUE_CODES.length} 个`);
  console.log('='.repeat(60));

  for (const code of UNIQUE_CODES) {
    console.log(`\n=== 款号: ${code} ===`);

    const moPanDirs = getMoPanDirectories(code);
    console.log(`  找到 ${moPanDirs.length} 个模拍原图目录`);

    const allFiles = [];
    for (const dir of moPanDirs) {
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
      report.push({
        款号: code,
        目录数: moPanDirs.length,
        搜索总数: 0,
        筛选数量: 0,
        yz: 0,
        o: 0,
        ys: 0,
        下载成功: 0,
        下载失败: 0,
      });
      continue;
    }

    console.log(`  搜索到: ${allFiles.length} 张 yz/o/ys 图片`);

    const scored = scoreAndSort(allFiles);
    const selected = scored.slice(0, MAX_PER_CODE);

    const countByKeyword = { yz: 0, o: 0, ys: 0 };
    selected.forEach((s) => (countByKeyword[s.keyword] = (countByKeyword[s.keyword] || 0) + 1));

    console.log(`  筛选后: ${selected.length} 张 (yz=${countByKeyword.yz}, o=${countByKeyword.o}, ys=${countByKeyword.ys})`);

    const codeDir = path.join(OUTPUT_BASE, code);
    if (!dryRun && !fs.existsSync(codeDir)) {
      fs.mkdirSync(codeDir, { recursive: true });
    }

    let downloaded = 0;
    let failed = 0;

    for (const item of selected) {
      const destFile = path.join(codeDir, item.filename);
      if (dryRun) {
        console.log(`  [${item.keyword}] ${item.filename}`);
      } else {
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
    }

    report.push({
      款号: code,
      目录数: moPanDirs.length,
      搜索总数: allFiles.length,
      筛选数量: selected.length,
      yz: countByKeyword.yz || 0,
      o: countByKeyword.o || 0,
      ys: countByKeyword.ys || 0,
      下载成功: dryRun ? 0 : downloaded,
      下载失败: dryRun ? 0 : failed,
    });
  }

  console.log('\n' + '='.repeat(60));
  console.log('下载报告');
  console.log('='.repeat(60));

  const totalReport = {
    款号: '合计',
    目录数: report.reduce((sum, r) => sum + r.目录数, 0),
    搜索总数: report.reduce((sum, r) => sum + r.搜索总数, 0),
    筛选数量: report.reduce((sum, r) => sum + r.筛选数量, 0),
    yz: report.reduce((sum, r) => sum + r.yz, 0),
    o: report.reduce((sum, r) => sum + r.o, 0),
    ys: report.reduce((sum, r) => sum + r.ys, 0),
    下载成功: report.reduce((sum, r) => sum + r.下载成功, 0),
    下载失败: report.reduce((sum, r) => sum + r.下载失败, 0),
  };
  report.push(totalReport);

  console.table(report);

  if (!dryRun) {
    const reportPath = path.join(OUTPUT_BASE, 'download_report.csv');
    const headers = Object.keys(report[0]).join(',');
    const rows = report.map((r) => Object.values(r).join(','));
    fs.writeFileSync(reportPath, '\ufeff' + headers + '\n' + rows.join('\n'), 'utf8');
    console.log(`\n报告已保存到: ${reportPath}`);
  }
}

main();