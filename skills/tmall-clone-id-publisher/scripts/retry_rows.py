# -*- coding: utf-8 -*-
"""重试指定失败行（row48/53/60/63/68/72/78/93），复用 process_row。"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, r'E:\巴拉知识库\.agents\skills\tmall-clone-id-publisher\scripts')
from clone_id_flow import process_row, open_onsale_tab, build_pre_switch_set, close_processed_tabs  # noqa: E402
import openpyxl  # noqa: E402

DEFAULT_SRC = r'E:\巴拉巴拉\ID克隆\双十一克隆ID列表AI.xlsx'  # 本机默认；他人使用请传 --excel

def load_rows(path, rows_list):
    wb = openpyxl.load_workbook(path)
    ws = wb['Sheet1']
    out = []
    for r in rows_list:
        oid = ws.cell(r, 1).value
        hh = ws.cell(r, 5).value
        if oid is None:
            continue
        out.append({'excel_row': r, 'origin_id': str(oid).strip(),
                    'huohao': str(hh).strip() if hh else '',
                    'product_line': str(ws.cell(r, 6).value or ''),
                    'feedback': str(ws.cell(r, 10).value or '')})
    return out, wb, ws

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rows', required=True, help='逗号分隔行号，如 48,53,60')
    ap.add_argument('--excel', default=DEFAULT_SRC, help='源Excel路径（默认本机路径）')
    ap.add_argument('--yes', action='store_true')
    ap.add_argument('--cdp-url', default='http://127.0.0.1:9222')
    ap.add_argument('--report', default='')
    args = ap.parse_args()
    rows_list = [int(x) for x in args.rows.split(',')]

    rows, wb, ws = load_rows(args.excel, rows_list)
    print(f'[load] {len(rows)} rows: {rows_list}')
    pre_switch = build_pre_switch_set(rows)
    print(f'[pre-switch] 频次>=5 预切货号: {sorted(pre_switch) or "无"}')
    ctx = {'brand': '巴拉巴拉', 'seq_map': {}, 'pre_switch_set': pre_switch,
           'learned_set': set(), 'dry_run': False, 'yes': args.yes,
           'cdp_url': args.cdp_url}
    tab_onsale = open_onsale_tab(args.cdp_url)
    print('[tab]', tab_onsale.url[:80])

    results = []
    for row in rows:
        print(f"\n=== {row['origin_id']} (货号 {row['huohao']}, Excel行{row['excel_row']}) ===")
        try:
            r = process_row(tab_onsale, row, ctx)
        except Exception as e:
            r = {'excel_row': row['excel_row'], 'origin_id': row['origin_id'],
                 'huohao': row['huohao'], 'status': 'exception', 'error': str(e)[:200]}
        results.append(r)
        print(f"    -> {r['status']}" + (f" | {r.get('error', '')[:80]}" if r.get('error') else ""))
        for s in r.get('steps', []):
            flag = 'OK ' if s['ok'] else 'XX '
            print(f"      {flag}{s['name']}" + (f" | {str(s.get('extra', ''))[:100]}" if s.get('extra') else ""))
        close_processed_tabs(args.cdp_url)

    if args.report:
        Path(args.report).write_text(json.dumps({
            'total': len(results),
            'success': sum(1 for r in results if r['status'] == 'success'),
            'failed': sum(1 for r in results if r['status'] in ('failed', 'exception')),
            'unknown': sum(1 for r in results if r['status'] == 'unknown_error_recorded'),
            'results': results}, ensure_ascii=False, indent=1), encoding='utf-8')
        print('[report]', args.report)

    if args.yes:
        changed = 0
        for r in results:
            idx = r['excel_row']
            st = r['status']
            if st == 'success':
                ws.cell(idx, 2).value = r.get('new_id', '')
                ws.cell(idx, 4).value = f"已发布 {__import__('datetime').datetime.now().strftime('%m-%d %H:%M')}"
            elif st == 'failed':
                ws.cell(idx, 4).value = f"失败: {r.get('error', '')[:40]}"
            elif st == 'unknown_error_recorded':
                ws.cell(idx, 4).value = f"未知错误: {r.get('error', '')[:30]}"
            changed += 1
        try:
            wb.save(args.excel)
            print(f'\n[write-back] {changed} 行写回 {args.excel}')
        except PermissionError:
            print(f'\n[write-back] 失败: {args.excel} 被占用或沙箱外无权限——新ID已保存报告')
    else:
        print('\n[write-back] 跳过（未 --yes）')

if __name__ == '__main__':
    main()
