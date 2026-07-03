import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_DIR = path.join(__dirname, 'downloads');
const TARGET_DIR = path.join(__dirname, '326搜推图');

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

function copyDirectory(src, dest) {
  if (!fs.existsSync(src)) {
    return { success: false, count: 0, reason: '源目录不存在' };
  }

  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const files = fs.readdirSync(src);
  let count = 0;

  for (const file of files) {
    const srcFile = path.join(src, file);
    const destFile = path.join(dest, file);
    
    if (fs.statSync(srcFile).isFile()) {
      fs.copyFileSync(srcFile, destFile);
      count++;
    }
  }

  return { success: true, count };
}

function main() {
  console.log('='.repeat(60));
  console.log(`源路径: ${SOURCE_DIR}`);
  console.log(`目标路径: ${TARGET_DIR}`);
  console.log(`款号数量: ${UNIQUE_CODES.length} 个（去重后）`);
  console.log('='.repeat(60));

  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  const report = [];
  let totalCopied = 0;
  let notFound = 0;

  for (const code of UNIQUE_CODES) {
    const srcDir = path.join(SOURCE_DIR, code);
    const destDir = path.join(TARGET_DIR, code);

    console.log(`\n=== 款号: ${code} ===`);

    const result = copyDirectory(srcDir, destDir);
    
    if (result.success) {
      console.log(`  复制成功: ${result.count} 张图片`);
      totalCopied += result.count;
      report.push({ 款号: code, 状态: '成功', 图片数: result.count });
    } else {
      console.log(`  ${result.reason}`);
      notFound++;
      report.push({ 款号: code, 状态: '未找到', 图片数: 0 });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('复制报告');
  console.log('='.repeat(60));
  console.table(report);

  console.log(`\n总计: 复制 ${totalCopied} 张图片，${notFound} 个款号未找到图片`);

  const reportPath = path.join(TARGET_DIR, 'copy_report.csv');
  const headers = Object.keys(report[0]).join(',');
  const rows = report.map((r) => Object.values(r).join(','));
  fs.writeFileSync(reportPath, '\ufeff' + headers + '\n' + rows.join('\n'), 'utf8');
  console.log(`报告已保存到: ${reportPath}`);
}

main();