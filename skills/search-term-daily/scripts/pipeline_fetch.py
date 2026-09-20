# -*- coding: utf-8 -*-
"""拉取指定日期引流搜索词 → 生成留档 xls（复刻生意参谋导出格式）→ 保存 API JSON

用法:
    py pipeline_fetch.py [YYYY-MM-DD ...]    缺省：昨天（T-1）

前置环境同 fetch_drainage.py：
    - PYTHONPATH 包含 sycm-cli 的 .python-packages（xlwt 等）
    - CURL_CA_BUNDLE / SSL_CERT_FILE 指向 cacert.pem
    - 登录态：专用 Chrome 已登录生意参谋，cdp-port 指向其 CDP 端口
"""
import json, time, sys, os, importlib.util, datetime
from decimal import Decimal, ROUND_HALF_UP

ARCHIVE_DIR = os.environ.get("SYCM_SEARCH_ARCHIVE_DIR", r"E:\巴拉巴拉\搜索词数据留存")
JSON_DIR = os.environ.get("SYCM_SEARCH_JSON_DIR", os.path.join(ARCHIVE_DIR, "api_json"))
SYCM_CLI_PATH = os.environ.get("SYCM_CLI_PATH", r"E:\巴拉巴拉\AI\sycm-cli\sycm_cli.py")

spec = importlib.util.spec_from_file_location("sycm_cli", SYCM_CLI_PATH)
sc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sc)

INDEX_CODE = "uv,goodsCartByrCnt,goodsCltByrCnt,payOrderUserCnt,payConvertRate,payAmt,perByrAmt,uvValue"


def fetch_day(date_str, page_size=100, max_pages=30):
    cookies = sc.load_taobao_cookies()
    all_rows = []
    record_count = None
    page = 1
    while page <= max_pages:
        params = {
            "dateRange": f"{date_str}|{date_str}",
            "dateType": "day",
            "pageSize": str(page_size),
            "page": str(page),
            "order": "desc",
            "orderBy": "uv",
            "device": "2",
            "kwType": "se_keyword",
            "indexCode": INDEX_CODE,
            "_": str(int(time.time() * 1000)),
            "token": cookies.get("_tb_token_", ""),
        }
        data = sc._api_get("/flow/v4/shop/wordAide/drainageSearch.json", params, cookies)
        d = data.get("data") or {}
        record_count = d.get("recordCount")
        rows = d.get("data") or []
        if not rows:
            break
        all_rows.extend(rows)
        if record_count is not None and len(all_rows) >= record_count:
            break
        page += 1
        time.sleep(1.2)
    return {"recordCount": record_count, "rows": all_rows, "pages": page}


# ---------- 格式化（复刻生意参谋导出显示值） ----------
def _r2(x):
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def fmt_int(v):
    if v is None:
        return "0"
    return f"{int(round(float(v))):,}"


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
    if v is None:
        return "-"
    return str(_r2(v))


def api_row_to_export(date_str, a):
    """API 行 → 导出文本行（10 列）"""
    word = a.get("seKeyword", {}).get("value", "")
    return [
        date_str,
        word,
        fmt_int(a.get("uv", {}).get("value")),
        fmt_int(a.get("goodsCartByrCnt", {}).get("value")),
        fmt_int(a.get("goodsCltByrCnt", {}).get("value")),
        fmt_int(a.get("payOrderUserCnt", {}).get("value")),
        fmt_rate(a.get("payConvertRate", {}).get("value")),
        fmt_money(a.get("payAmt", {}).get("value")),
        fmt_2dp(a.get("perByrAmt", {}).get("value")),
        fmt_2dp(a.get("uvValue", {}).get("value")),
    ]


def write_archive_xls(date_str, rows):
    """复刻生意参谋导出 xls（与页面导出同名同格式）"""
    import xlwt
    wb = xlwt.Workbook(encoding="utf-8")
    ws = wb.add_sheet("【生意参谋平台】1")
    ws.write(0, 0, "数据说明：以下数据为您所选时间周期的相关指标，如需查看其他时间周期的数据，请重新选择后下载")
    ws.write(1, 0, "收藏网址：d.alibaba.com，让数据帮您生意参谋！点此进入>>")
    hdrs = ["统计日期", "搜索词", "访客数", "加购人数", "商品收藏人数", "支付买家数", "支付转化率", "支付金额", "客单价", "UV价值"]
    for c, h in enumerate(hdrs):
        ws.write(5, c, h)
    for i, row in enumerate(rows):
        for c, v in enumerate(row):
            ws.write(6 + i, c, v)
    fname = os.path.join(ARCHIVE_DIR, f"【生意参谋】选词助手-引流搜索词-店外-无线-{date_str.replace('-', '')}.xls")
    wb.save(fname)
    return fname


if __name__ == "__main__":
    days = sys.argv[1:] or [(datetime.date.today() - datetime.timedelta(days=1)).isoformat()]
    os.makedirs(JSON_DIR, exist_ok=True)
    summary = []
    for d in days:
        res = fetch_day(d, page_size=100)
        if not res["rows"]:
            print("EMPTY", d, "recordCount", res["recordCount"], "（T+1 数据未出则跳过）")
            continue
        export_rows = [api_row_to_export(d, a) for a in res["rows"]]
        fn = write_archive_xls(d, export_rows)
        jf = os.path.join(JSON_DIR, f"api_{d.replace('-', '')}.json")
        with open(jf, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
        summary.append((d, res["recordCount"], len(res["rows"]), os.path.basename(fn)))
        print("DONE", d, "recordCount", res["recordCount"], "rows", len(res["rows"]), "->", os.path.basename(fn))
        time.sleep(1.5)
    print("SUMMARY:", json.dumps(summary, ensure_ascii=False))
