# -*- coding: utf-8 -*-
r"""分页拉取引流搜索词全量数据（可指定日期/页大小），保存为 API JSON

用法:
    py fetch_drainage.py [YYYY-MM-DD] [输出json路径] [pageSize]

前置环境:
    - PYTHONPATH 需包含 sycm-cli 的 .python-packages（pandas/openpyxl/xlrd/xlwt）
    - CURL_CA_BUNDLE / SSL_CERT_FILE 指向 %USERPROFILE%\.sycm-cli\cacert.pem
    - 登录态：专用 Chrome 已登录生意参谋，%LOCALAPPDATA%\sycm-cli\cdp-port 指向其 CDP 端口
"""
import json, time, sys, importlib.util, os

SYCM_CLI_PATH = os.environ.get("SYCM_CLI_PATH", r"E:\巴拉巴拉\AI\sycm-cli\sycm_cli.py")
spec = importlib.util.spec_from_file_location("sycm_cli", SYCM_CLI_PATH)
sc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sc)


def fetch_day(date_str, page_size=50, max_pages=20, order_by="uv", device="2", kw_type="se_keyword",
              index_code="uv,goodsCartByrCnt,goodsCltByrCnt,payOrderUserCnt,payConvertRate,payAmt,perByrAmt,uvValue",
              out_path=None):
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
            "orderBy": order_by,
            "device": device,
            "kwType": kw_type,
            "indexCode": index_code,
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
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({"recordCount": record_count, "rows": all_rows}, f, ensure_ascii=False)
    print(f"{date_str}: recordCount={record_count} fetched={len(all_rows)} pages={page}")
    return all_rows


if __name__ == "__main__":
    date = sys.argv[1] if len(sys.argv) > 1 else "2026-09-13"
    out = sys.argv[2] if len(sys.argv) > 2 else None
    ps = int(sys.argv[3]) if len(sys.argv) > 3 else 50
    fetch_day(date, page_size=ps, out_path=out)
