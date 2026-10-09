---
name: sycm-jhs-dashboard
description: 拉取生意参谋（sycm.taobao.com）聚划算与全店支付数据，计算聚划算渗透率（渗透率=聚划算支付金额/全店支付金额），拉取7日商品排行数据，生成/更新可视化看板 HTML 与 CSV。支持按任意日期补拉历史渗透率（全店=month/trend相邻日差值法，聚划算=statistics.json逐日接口）。当用户要求更新聚划算渗透率看板、拉取聚划算或全店支付金额数据、补拉历史几天渗透率、查看渗透率趋势、执行每日数据更新、或提及"聚划算数据/渗透率看板/生意参谋数据"时使用。
---

# Sycm JHS Dashboard（聚划算渗透率看板）

## Overview

通过 CDP 连接 Chrome 浏览器，拉取店铺每日的**全店支付金额**与**聚划算支付金额**，计算渗透率，同时拉取7日商品排行数据，输出：
- 看板 HTML（ECharts，本地 + 线上双份）
- 历史数据 JSON（持续累积）
- 7日商品 Excel（用于补报推荐）
- 预测验证记录

核心口径：**渗透率 = 聚划算支付金额 ÷ 全店支付金额**（每日快照，T+1 数据）。

## 前置条件

- Chrome 已启动并开启 CDP 调试端口（9222 或 53850）
- 生意参谋已登录（如未登录，按下方"CDP登录流程"自动登录）
- Python 环境已安装：websocket-client, openpyxl, xlrd
- **账密配置**：`scripts/config.local.json`（已被 .gitignore 排除，永不提交；格式见 `scripts/config.local.json.example`）

## Quick Start（标准更新流程）

### Step 1: 启动 CDP Chrome

```powershell
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$profileDir = "E:\巴拉巴拉\AI\crawshrimp-skill\chrome-profile"
Start-Process -FilePath $chromePath -ArgumentList "--remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=`"$profileDir`" --no-first-run"
Start-Sleep -Seconds 8
```

验证：访问 `http://127.0.0.1:9222/json` 能看到 tabs。

### Step 2: CDP自动登录生意参谋

若 CDP 主 tab URL 包含 `login.htm`，执行自动登录。**账密从 `scripts/config.local.json` 读取，禁止硬编码到代码/文档**：

```python
import json, urllib.request, websocket, time

port = 9222
with urllib.request.urlopen(f"http://127.0.0.1:{port}/json") as r:
    tabs = json.loads(r.read())
page_tab = [t for t in tabs if t["type"] == "page"][0]
ws = websocket.create_connection(page_tab["webSocketDebuggerUrl"], timeout=15)
mid = 0
def send(method, params=None):
    global mid
    mid += 1
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == mid:
            return m

# 读取账密（本地配置，不提交）
_cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripts", "config.local.json")
with open(_cfg_path, "r", encoding="utf-8") as f:
    _cfg = json.load(f)
ACCOUNT = _cfg["sycm_account"]
PASSWORD = _cfg["sycm_password"]

# 找havanalogin iframe
r = send("Page.getFrameTree")
def walk(node):
    f = node["frame"]
    if "havanalogin" in f["url"]:
        return f
    for c in node.get("childFrames", []):
        found = walk(c)
        if found: return found
    return None
hf = walk(r["result"]["frameTree"])

# 在iframe中创建隔离世界
r = send("Page.createIsolatedWorld", {"frameId": hf["id"], "worldName": "autologin"})
ctx_id = r["result"]["executionContextId"]

# 填账号密码
js_fill = """
(function() {
    function setNativeValue(el, value) {
        var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
    }
    var acc = document.getElementById('fm-login-id');
    var pwd = document.getElementById('fm-login-password');
    setNativeValue(acc, ACCOUNT);
    setNativeValue(pwd, PASSWORD);
    return 'FILLED';
})()
"""
send("Runtime.evaluate", {"expression": js_fill, "contextId": ctx_id, "returnByValue": True})
time.sleep(0.5)

# 点登录按钮
js_login = """
(function() {
    var btn = document.querySelector('.fm-submit.password-login') || document.querySelector('button[type=submit]');
    btn.click();
    return 'CLICKED';
})()
"""
send("Runtime.evaluate", {"expression": js_login, "contextId": ctx_id, "returnByValue": True})
time.sleep(5)

# 检查是否有滑块（截图确认）
# 若有滑块，用CDP Input拖拽：
# send("Input.dispatchMouseEvent", {"type": "mousePressed", "x": 1230, "y": 255, "button": "left", "clickCount": 1})
# 分步移动鼠标到右侧
# send("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": 1480, "y": 255, "button": "left", "clickCount": 1})
```

### Step 3: 拉全店支付金额

导航到生意参谋首页，提取昨日全天支付金额：

```python
send("Page.navigate", {"url": "https://sycm.taobao.com/portal/home.htm"})
time.sleep(5)

r = send("Runtime.evaluate", {"expression": "document.body.innerText", "returnByValue": True})
text = r["result"]["result"]["value"]

import re
m = re.search(r'昨日全天\s*([\d,]+)', text)
shop_amt = int(m.group(1).replace(',', ''))
```

### Step 4: 拉聚划算支付金额

```python
send("Page.navigate", {"url": "https://sycm.taobao.com/xsite/frame/jhs"})
time.sleep(3)

# 关闭优惠竞争力下降提醒弹窗
js_close = """
(function() {
    var closeBtn = document.querySelector('.ant-modal-close');
    if (closeBtn) { closeBtn.click(); return 'CLOSED'; }
    return 'NO_MODAL';
})()
"""
send("Runtime.evaluate", {"expression": js_close, "returnByValue": True})
time.sleep(1)

# 若页面停留在业务专区菜单，点击"聚划算数据中心"
js_click_menu = """
(function() {
    var links = document.querySelectorAll('a, span, div');
    for (var i = 0; i < links.length; i++) {
        if (links[i].innerText.trim() === '聚划算数据中心' && links[i].offsetParent !== null) {
            links[i].click();
            return 'CLICKED';
        }
    }
    return 'NOT_FOUND';
})()
"""
send("Runtime.evaluate", {"expression": js_click_menu, "returnByValue": True})
time.sleep(5)

# 提取聚划算支付金额
r = send("Runtime.evaluate", {"expression": "document.body.innerText", "returnByValue": True})
text = r["result"]["result"]["value"]
m = re.search(r'支付金额\s*([\d,.]+)', text)
jhs_amt = float(m.group(1).replace(',', ''))
```

### Step 5: 拉7日商品排行数据（API直连）

```python
import base64

# 导航到商品排行页（确保同源cookie）
send("Page.navigate", {"url": "https://sycm.taobao.com/cc/item_rank?dateRange=2026-09-16|2026-09-22&dateType=recent7"})
time.sleep(5)

# 在页面上下文fetch下载API
js_download = """
(async function() {
    var url = '/cc/item/view/excel/top.json?dateRange=2026-09-16|2026-09-22&dateType=recent7&pageSize=10&page=1&order=desc&orderBy=payAmt&dtUpdateTime=false&dtMaxAge=0&device=0&compareType=cycle&keyword=&follow=false&cateId=&cateLevel=&indexCode=payAmt,sucRefundAmt,payItmCnt,itemCartCnt,itmUv';
    var resp = await fetch(url, {credentials: 'include'});
    var blob = await resp.blob();
    var reader = new FileReader();
    return new Promise(function(resolve) {
        reader.onloadend = function() {
            var b64 = reader.result.split(',')[1];
            resolve(JSON.stringify({ok: true, b64: b64, size: blob.size}));
        };
        reader.readAsDataURL(blob);
    });
})()
"""
r = send("Runtime.evaluate", {"expression": js_download, "returnByValue": True, "awaitPromise": True})
data = json.loads(r["result"]["result"]["value"])

# 解码保存
file_bytes = base64.b64decode(data["b64"])
out_path = r"E:\巴拉巴拉\AI\sycm-cli\data\item_rank_7d.xls"
with open(out_path, "wb") as f:
    f.write(file_bytes)
```

**下载API说明**：
- 路径：`/cc/item/view/excel/top.json`
- 参数：dateRange（起止日期用|分隔）、dateType=recent7、orderBy=payAmt、indexCode=指标列表
- 返回：.xls 格式二进制文件，第5行开始是表头，共约20000行商品数据
- 必须在生意参谋页面上下文 fetch（带cookie）

### Step 6: 写入历史数据

```python
import json
from datetime import datetime

today = datetime.now().strftime("%Y-%m-%d")
hist_path = r"E:\巴拉巴拉\AI\sycm-cli\data\penetration_history.json"

hist = json.load(open(hist_path, encoding="utf-8"))
# 检查当天是否已存在
if not any(h["date"] == today for h in hist):
    hist.append({
        "date": today,
        "shop": shop_amt,
        "jhs": jhs_amt,
        "pen": round(jhs_amt / shop_amt, 4)
    })
    hist.sort(key=lambda x: x["date"])
    json.dump(hist, open(hist_path, "w", encoding="utf-8"), ensure_ascii=False)
```

### Step 6.5: 历史多日补拉（全店单日差值法）

当历史 JSON 存在缺失日期需要补拉时（如"拉下这几天的渗透率"），用以下已验证接口按任意日期拉取：

**全店侧（任意日期单日值）**：`/portal/month/trend.json` 返回的是**月度累计** payAmt，**相邻日 diff 即单日全店支付金额**（已用历史数据 7 天逐一验证完全吻合）：

```python
# 页面上下文 fetch（带cookie）
js = """
(async function() {
    var resp = await fetch('/portal/month/trend.json?dateType=day&dateRange=2026-10-06%7C2026-10-06&sellerType=online&_=1&token=<token>', {credentials: 'include'});
    return await resp.text();
})()
"""
# 响应 content.data.statDate[]（毫秒时间戳）+ payAmt[]（月度累计）
# 单日 = 当日累计 − 前一日累计
# 新月首日（如10-01）为新序列第一点，单日 = 当日累计本身
```

关键要点：
- 一次请求返回约30天序列（如 9/7~10/6），跨月时 9 月与 10 月是两条独立累计序列
- dateRange 任填结束日即可，返回序列从月初到该日
- 9/16~9/22、9/27~9/29 等历史值已与 JSON 对账一致（如 9/22 diff=3,939,179 与历史 3,939,179 吻合）

**聚划算侧（任意日期）**：`/mc/jhs/sellerData/businessOverview/statistics.json` 支持任意 dateRange：

```python
js = """
(async function() {
    var resp = await fetch('/mc/jhs/sellerData/businessOverview/statistics.json?dateType=day&dateRange=2026-09-23%7C2026-09-23&indexCodes=bybtPayAmt%2ConlineItemBreakRate%2CbybtItemUv%2CbybtCvr%2CbybtGmvPerPerson&token=<token>', {credentials: 'include'});
    return await resp.text();
})()
"""
# 响应 data.bybtPayAmt.value 即该日聚划算支付金额（注意：值在顶层 data，不是 data.data）
```

补拉流程：
1. 读历史 JSON 找出缺失日期
2. 全店侧一次拉 month/trend → diff 得全部缺失日单日值
3. 聚划算侧逐日 fetch statistics.json（间隔0.5s）
4. 按现有历史格式 `{date, all_pay, jhs_pay, penetration_rate}`（pen 为百分数值如 70.25）追加写入
5. 渲染 + 部署（同 Step 7/8）

### Step 7: 渲染看板

```powershell
& "C:\Users\smadmin\AppData\Local\Doubao\User Data\sandbox_runtime\bases\c98c5042338ed152c6f10ecd8591889f\python\python.exe" "E:\巴拉巴拉\AI\sycm-cli\scripts\render_dashboard.py"
```

脚本自动：
- 读历史 JSON + 补报商品 JSON
- 替换全部 20 个占位符（集中在 `replacements` dict 里）
- **正则检查 `__XXX__` 残留，有残留直接 exit 1 报错**

### Step 8: 部署到线上

```powershell
cd "E:\巴拉知识库\巴拉知识库\wiki\活动\规则监控"
lark-cli apps +deploy --file-path "./聚划算渗透率看板.html" --app-id app_17ebj41sfaa
# 轮询发布状态
lark-cli apps +release-get --app-id app_17ebj41sfaa --release-id <上一步返回的release_id>
```

## 关键路径

| 项目 | 路径 |
|---|---|
| sycm-cli 根目录 | `E:\巴拉巴拉\AI\sycm-cli` |
| 下载脚本 | `E:\巴拉巴拉\AI\sycm-cli\scripts\download_items_7d.py` |
| 渲染脚本 | `E:\巴拉巴拉\AI\sycm-cli\scripts\render_dashboard.py` |
| 看板模板 | `E:\巴拉巴拉\AI\sycm-cli\dashboard\template.html` |
| 历史数据 | `E:\巴拉巴拉\AI\sycm-cli\data\penetration_history.json` |
| 7日商品数据 | `E:\巴拉巴拉\AI\sycm-cli\data\item_rank_7d.xls` |
| 预测记录 | `E:\巴拉巴拉\AI\sycm-cli\data\penetration_predictions.json` |
| 本地看板 | `E:\巴拉知识库\巴拉知识库\wiki\活动\规则监控\聚划算渗透率看板.html` |
| 线上 app_id | `app_17ebj41sfaa` |
| CDP Chrome profile | `E:\巴拉巴拉\AI\crawshrimp-skill\chrome-profile` |

## 常见问题

| 问题 | 处理 |
|---|---|
| CDP连接失败 | 先启动Chrome带--remote-debugging-port=9222 --remote-allow-origins=* |
| 登录页出现滑块 | 用CDP Input.dispatchMouseEvent拖拽滑块（mousedown→分步mousemove→mouseup） |
| 优惠竞争力提醒弹窗挡住 | 点 `.ant-modal-close` 关闭 |
| 聚划算页面停在业务专区菜单 | 用JS点击文本为"聚划算数据中心"的元素 |
| 看板图表空白 | 检查 `__DATA__` 占位符是否替换（不是 `__DATA_JSON__`） |
| 线上看板不更新 | 跑 `lark-cli apps +deploy` 重新部署 |
| 商品下载按钮点不动 | 直接调API `/cc/item/view/excel/top.json`，不用点按钮 |
| 旧版.xls读不了 | 用 xlrd 而非 openpyxl |
| config.local.json 缺失 | 按 scripts/config.local.json.example 复制并填入账密（本地文件，不提交） |

## 已验证API清单

| API | 用途 |
|---|---|
| `/cc/item/view/top.json` | 商品排行分页列表 |
| `/cc/item/view/excel/top.json` | 商品排行Excel下载 |
| `/portal/gmv/rank/list.json` | GMV排行 |
| `/xsite/frame/jhs` | 聚划算数据中心页面 |
| `/portal/month/trend.json` | 全店月度累计序列（**相邻日diff=单日全店支付**，支持任意日期补拉） |
| `/mc/jhs/sellerData/businessOverview/statistics.json` | 聚划算任意日期单日值（data.bybtPayAmt.value） |
| `/portal/month/overview.json` | 月度累计口径（单日不可用，勿用于补拉） |
| `/portal/board/grow/factor/overview.json` | 增长因子（会员支付口径，非全店，勿用于渗透率） |
