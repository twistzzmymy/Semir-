# -*- coding: utf-8 -*-
"""通过CDP调用生意参谋商品排行下载API，保存7日商品Excel

用法：
    python download_items_7d.py [--date-range 2026-09-16|2026-09-22] [--out output.xls]

依赖：websocket-client, openpyxl
"""
import json, os, sys, time, base64, urllib.request
from websocket import create_connection

CDP_PORT = 53850
CDP_PORT_FILE = os.path.join(os.environ.get("LOCALAPPDATA", ""), "sycm-cli", "cdp-port")


def read_cdp_port():
    if os.path.exists(CDP_PORT_FILE):
        return int(open(CDP_PORT_FILE).read().strip())
    return CDP_PORT


def get_main_tab(port):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5) as r:
        tabs = json.loads(r.read().decode("utf-8"))
    for t in tabs:
        if t.get("type") == "page" and t.get("url", "").startswith("http"):
            return t
    return None


def cdp_connect(ws_url):
    return create_connection(ws_url, timeout=30, origin="http://127.0.0.1")


def cdp_send(ws, mid, method, params=None):
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == mid:
            return m


def download_items(date_range, out_path):
    port = read_cdp_port()
    tab = get_main_tab(port)
    if not tab:
        print("ERROR: 未找到CDP主tab")
        return False

    ws = cdp_connect(tab["webSocketDebuggerUrl"])
    mid = 0
    def next_id():
        nonlocal mid
        mid += 1
        return mid

    # 确保在生意参谋域名下（fetch需要同源cookie）
    current_url = tab["url"]
    if "sycm.taobao.com" not in current_url:
        cdp_send(ws, next_id(), "Page.navigate", {"url": "https://sycm.taobao.com/cc/item_rank"})
        time.sleep(5)

    # 在页面上下文fetch下载API，拿到二进制内容
    js = f"""
    (async function() {{
        var url = '/cc/item/view/excel/top.json?dateRange={date_range}&dateType=recent7&pageSize=10&page=1&order=desc&orderBy=payAmt&dtUpdateTime=false&dtMaxAge=0&device=0&compareType=cycle&keyword=&follow=false&cateId=&cateLevel=&indexCode=payAmt,sucRefundAmt,payItmCnt,itemCartCnt,itmUv';
        var resp = await fetch(url, {{credentials: 'include'}});
        if (!resp.ok) return JSON.stringify({{error: 'HTTP ' + resp.status}});
        var blob = await resp.blob();
        var reader = new FileReader();
        return new Promise(function(resolve) {{
            reader.onloadend = function() {{
                var b64 = reader.result.split(',')[1];
                resolve(JSON.stringify({{ok: true, b64: b64, size: blob.size}}));
            }};
            reader.readAsDataURL(blob);
        }});
    }})()
    """
    r = cdp_send(ws, next_id(), "Runtime.evaluate", {
        "expression": js, "returnByValue": True, "awaitPromise": True
    })
    val = r.get("result", {}).get("result", {}).get("value")
    if not val:
        print("ERROR: 下载失败，无返回")
        ws.close()
        return False

    data = json.loads(val)
    if not data.get("ok"):
        print("ERROR:", data.get("error", "未知错误"))
        ws.close()
        return False

    # 解码base64保存文件
    file_bytes = base64.b64decode(data["b64"])
    with open(out_path, "wb") as f:
        f.write(file_bytes)

    print(f"下载成功: {out_path} ({len(file_bytes)} bytes)")
    ws.close()
    return True


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--date-range", default=None, help="日期范围，如 2026-09-16|2026-09-22")
    parser.add_argument("--out", default=None, help="输出文件路径")
    args = parser.parse_args()

    # 默认用最近7天
    if not args.date_range:
        from datetime import datetime, timedelta
        end = datetime.now().strftime("%Y-%m-%d")
        start = (datetime.now() - timedelta(days=6)).strftime("%Y-%m-%d")
        args.date_range = f"{start}|{end}"

    if not args.out:
        args.out = rf"E:\巴拉巴拉\AI\sycm-cli\data\item_rank_7d_{args.date_range.replace('|', '_').replace('-', '')}.xls"

    ok = download_items(args.date_range, args.out)
    sys.exit(0 if ok else 1)
