# -*- coding: utf-8 -*-
"""ZIP 级 XML 拼接：复制基准主表 → 在末尾追加指定日期数据行 → 原内容逐字节保留
新行：A/B 用 YEAR/MONTH 公式+缓存值（同原表 9 月区块），C-L 用 inlineStr 文本（同导出格式）

⚠️ 禁用 openpyxl load+save 整表重存：原表 80222 行起年份/月份为公式，
   openpyxl 重存会丢失公式缓存值（80,222 行受影响，文件 8.17MB→6.39MB）。
   本脚本只改 sheet1.xml 的 dimension 与 </sheetData> 前的追加行，其余 zip 条目逐字节复制。

用法:
    py zip_merge.py --base <基准主表.xlsx> --out <新主表.xlsx>
                    [--json-dir <api_json目录>] [--archive-dir <留档目录>] [--days 2026-09-14,2026-09-15]
    未传 --days 时自动收集 json-dir 下所有 api_YYYYMMDD.json（按日期升序）。
    某日有 api JSON 用 API；没有则回退读 archive-dir 下同名留档 xls。
"""
import zipfile, os, json, sys, re, argparse
from decimal import Decimal, ROUND_HALF_UP

DEFAULT_ARCHIVE_DIR = os.environ.get("SYCM_SEARCH_ARCHIVE_DIR", r"E:\巴拉巴拉\搜索词数据留存")


# ---------- 格式化（同生意参谋导出显示值） ----------
def _r2(x):
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def fmt_int(v):
    return "0" if v is None else f"{int(round(float(v))):,}"


def fmt_rate(v):
    if v is None:
        return "-"
    pct = Decimal(str(v)) * 100
    return str(pct.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)) + "%"


def fmt_money(v):
    if v is None or float(v) == 0:
        return "0.00"
    return f"{_r2(v):,}"


def fmt_2dp(v):
    return "-" if v is None else str(_r2(v))


def api_to_cols10(a):
    return [
        a.get("seKeyword", {}).get("value", ""),
        fmt_int(a.get("uv", {}).get("value")),
        fmt_int(a.get("goodsCartByrCnt", {}).get("value")),
        fmt_int(a.get("goodsCltByrCnt", {}).get("value")),
        fmt_int(a.get("payOrderUserCnt", {}).get("value")),
        fmt_rate(a.get("payConvertRate", {}).get("value")),
        fmt_money(a.get("payAmt", {}).get("value")),
        fmt_2dp(a.get("perByrAmt", {}).get("value")),
        fmt_2dp(a.get("uvValue", {}).get("value")),
    ]


def rows_from_api(json_path, date_str):
    """API JSON → [[日期, 词, 指标...] x N]"""
    res = json.load(open(json_path, encoding="utf-8"))
    return [[date_str] + api_to_cols10(a) for a in res["rows"]]


def rows_from_archive(archive_dir, date_str):
    """已有留档 xls → [[日期, 词, 指标...] x N]（第6行起为数据）"""
    import xlrd
    fn = os.path.join(archive_dir, f"【生意参谋】选词助手-引流搜索词-店外-无线-{date_str.replace('-', '')}.xls")
    book = xlrd.open_workbook(fn)
    sh = book.sheet_by_index(0)
    return [[str(sh.cell_value(r, c)) for c in range(10)] for r in range(6, sh.nrows)]


# ---------- XML 构建 ----------
def xml_esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def build_row_xml(r, cols10, year_label, month_label):
    date_v, word, uv, cart, fav, buyer, rate, amt, per, uvv = cols10
    cells = [
        f'<c r="A{r}" s="4" t="str"><f>YEAR(C{r})&amp;&quot;年&quot;</f><v>{year_label}</v></c>',
        f'<c r="B{r}" s="4" t="str"><f>MONTH(C{r})&amp;&quot;月&quot;</f><v>{month_label}</v></c>',
        f'<c r="C{r}" s="19" t="inlineStr"><is><t>{xml_esc(date_v)}</t></is></c>',
        f'<c r="D{r}" s="20" t="inlineStr"><is><t>{xml_esc(word)}</t></is></c>',
        f'<c r="E{r}" s="20" t="inlineStr"><is><t>{xml_esc(uv)}</t></is></c>',
        f'<c r="F{r}" s="20" t="inlineStr"><is><t>{xml_esc(cart)}</t></is></c>',
        f'<c r="G{r}" s="20" t="inlineStr"><is><t>{xml_esc(fav)}</t></is></c>',
        f'<c r="H{r}" s="20" t="inlineStr"><is><t>{xml_esc(buyer)}</t></is></c>',
        f'<c r="I{r}" s="20" t="inlineStr"><is><t>{xml_esc(rate)}</t></is></c>',
        f'<c r="J{r}" s="20" t="inlineStr"><is><t>{xml_esc(amt)}</t></is></c>',
        f'<c r="K{r}" s="20" t="inlineStr"><is><t>{xml_esc(per)}</t></is></c>',
        f'<c r="L{r}" s="20" t="inlineStr"><is><t>{xml_esc(uvv)}</t></is></c>',
    ]
    return f'<row r="{r}" spans="1:12">' + "".join(cells) + "</row>"


def detect_last_row(sheet_xml):
    m = re.search(r'<dimension ref="A1:L(\d+)"', sheet_xml)
    if not m:
        raise RuntimeError("未能在 sheet1.xml 中找到 <dimension ref=\"A1:L...\">")
    return int(m.group(1))


def main():
    ap = argparse.ArgumentParser(description="ZIP 级 XML 拼接主表（保留原表公式缓存）")
    ap.add_argument("--base", required=True, help="基准主表 xlsx")
    ap.add_argument("--out", required=True, help="输出新主表 xlsx")
    ap.add_argument("--json-dir", default=os.path.join(DEFAULT_ARCHIVE_DIR, "api_json"), help="API JSON 目录（api_YYYYMMDD.json）")
    ap.add_argument("--archive-dir", default=DEFAULT_ARCHIVE_DIR, help="留档 xls 目录（无 JSON 时回退）")
    ap.add_argument("--days", default="", help="逗号分隔的日期列表，如 2026-09-14,2026-09-15；缺省自动扫描 json-dir")
    args = ap.parse_args()

    if args.days:
        days = [d.strip() for d in args.days.split(",") if d.strip()]
    else:
        days = sorted(
            f[4:8] + "-" + f[8:10] + "-" + f[10:12]
            for f in os.listdir(args.json_dir)
            if re.fullmatch(r"api_\d{8}\.json", f)
        )
    if not days:
        print("没有找到任何日期（--days 为空且 json-dir 无 api_*.json）")
        sys.exit(1)

    # ---------- 组装 10 列数据行（[日期, 词, uv, 加购, 收藏, 买家, 率, 金额, 客单价, UV价值]） ----------
    rows10 = []
    for d in days:
        jf = os.path.join(args.json_dir, f"api_{d.replace('-', '')}.json")
        if os.path.exists(jf):
            rows10.extend(rows_from_api(jf, d))
            print(d, "来自 API JSON，累计:", len(rows10))
        else:
            rows10.extend(rows_from_archive(args.archive_dir, d))
            print(d, "来自留档 xls，累计:", len(rows10))

    # ---------- 读取原 sheet1.xml，做两处修改 ----------
    zin = zipfile.ZipFile(args.base, "r")
    sheet_xml = zin.read("xl/worksheets/sheet1.xml").decode("utf-8")
    last = detect_last_row(sheet_xml)
    start = last + 1
    end_row = start + len(rows10) - 1
    print("基准末行:", last, "新增范围:", start, "~", end_row, "新增行数:", len(rows10))

    year_label = f"{days[0][:4]}年"
    month_label = f"{int(days[0][5:7])}月"
    new_rows_xml = "".join(build_row_xml(start + i, r10, year_label, month_label) for i, r10 in enumerate(rows10))

    # 1) 更新 dimension
    sheet_xml = re.sub(r'<dimension ref="A1:L\d+"', f'<dimension ref="A1:L{end_row}"', sheet_xml, count=1)
    # 2) 在 </sheetData> 前插入新行
    marker = "</sheetData>"
    idx = sheet_xml.rindex(marker)
    new_sheet_xml = sheet_xml[:idx] + new_rows_xml + sheet_xml[idx:]

    # ---------- 写出新 zip（其他条目逐字节复制） ----------
    if os.path.exists(args.out):
        os.remove(args.out)
    zout = zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename == "xl/worksheets/sheet1.xml":
            data = new_sheet_xml.encode("utf-8")
            item.compress_size = 0
            item.file_size = len(data)
        zout.writestr(item, data)
    zout.close()
    zin.close()
    print("已写出:", args.out, os.path.getsize(args.out), "bytes")


if __name__ == "__main__":
    main()
