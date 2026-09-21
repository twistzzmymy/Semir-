# -*- coding: utf-8 -*-
"""生意参谋登录态自动恢复（CDP 驱动）

当 sycm-cli 接口返回 code=5810（You must login system first）时调用本脚本：
1. 读取 %LOCALAPPDATA%\\sycm-cli\\cdp-port 拿到专用 Chrome 的 CDP 端口
2. 连接 CDP，查主 tab URL
3. 若已是内部页面 → 输出 ALREADY_LOGGED_IN
4. 若是登录页（login.htm）→ 找到 havanalogin iframe → 从 config.local.json 读账号密码
   → 填入 fm-login-id / fm-login-password → 点击登录按钮
5. 等待跳转，检查是否进入生意参谋内部页
6. 若检测到滑块验证码 → 输出 NEED_MANUAL_SLIDER（需人工拖滑块）

退出码：
    0  LOGIN_OK / ALREADY_LOGGED_IN
    2  NEED_MANUAL_SLIDER（需人工处理滑块）
    3  LOGIN_FAILED（账号密码错误或未知错误）
    4  CDP_UNAVAILABLE（Chrome 未运行或端口不通）

凭据文件：同目录 config.local.json（已在 .gitignore 中），格式：
    {"sycm_account": "淘宝账号", "sycm_password": "淘宝密码"}
"""
import json, os, sys, time, urllib.request
from websocket import create_connection

CDP_PORT_FILE = os.path.join(os.environ.get("LOCALAPPDATA", ""), "sycm-cli", "cdp-port")
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.local.json")
LOGIN_URL_MARKER = "login.htm"
INTERNAL_URL_HINTS = ("sycm.taobao.com/cc/", "sycm.taobao.com/flow/", "sycm.taobao.com/portal/")


def read_cdp_port():
    if not os.path.exists(CDP_PORT_FILE):
        return None
    try:
        return int(open(CDP_PORT_FILE).read().strip())
    except Exception:
        return None


def cdp_get_main_tab(port):
    """通过 http://127.0.0.1:PORT/json 找到主 page tab"""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5) as r:
            tabs = json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"CDP_HTTP_ERR: {e}", file=sys.stderr)
        return None
    for t in tabs:
        if t.get("type") == "page" and t.get("url", "").startswith("http"):
            return t
    return None


def cdp_connect(tab_ws):
    return create_connection(tab_ws, timeout=15, origin="http://127.0.0.1")


def cdp_send(ws, mid, method, params=None):
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == mid:
            return m


def find_havanalogin_frame(ws, mid):
    """在 frame tree 里找 havanalogin iframe frameId"""
    r = cdp_send(ws, mid, "Page.getFrameTree")
    def walk(node):
        f = node["frame"]
        if "havanalogin" in f["url"]:
            return f
        for c in node.get("childFrames", []):
            found = walk(c)
            if found: return found
        return None
    return walk(r["result"]["frameTree"])


def eval_in_frame(ws, mid, frame_id, expr):
    r = cdp_send(ws, mid, "Page.createIsolatedWorld", {"frameId": frame_id, "worldName": "autologin"})
    ctx = r["result"]["executionContextId"]
    r = cdp_send(ws, mid, "Runtime.evaluate", {
        "expression": expr, "contextId": ctx, "returnByValue": True, "awaitPromise": True
    })
    res = r.get("result", {}).get("result", {})
    return res.get("value"), r.get("result", {}).get("exceptionDetails")


def load_credentials():
    if not os.path.exists(CONFIG_FILE):
        return None, None
    cfg = json.load(open(CONFIG_FILE, encoding="utf-8"))
    return cfg.get("sycm_account"), cfg.get("sycm_password")


def main():
    # 1. 读 CDP 端口
    port = read_cdp_port()
    if not port:
        print("CDP_UNAVAILABLE: cdp-port 文件不存在")
        sys.exit(4)

    # 2. 找主 tab
    tab = cdp_get_main_tab(port)
    if not tab:
        print("CDP_UNAVAILABLE: 主 tab 未找到")
        sys.exit(4)

    main_ws_url = tab["webSocketDebuggerUrl"]
    main_url = tab["url"]
    print(f"当前主 tab: {main_url}")

    # 3. 已在内部页面？
    if LOGIN_URL_MARKER not in main_url:
        if any(h in main_url for h in INTERNAL_URL_HINTS):
            print("ALREADY_LOGGED_IN")
            sys.exit(0)

    ws = cdp_connect(main_ws_url)
    mid = 0
    def next_id():
        nonlocal mid
        mid += 1
        return mid

    cdp_send(ws, next_id(), "Page.enable")
    cdp_send(ws, next_id(), "Runtime.enable")
    time.sleep(0.3)

    # 4. 找 havanalogin iframe
    hf = find_havanalogin_frame(ws, next_id())
    if not hf:
        print("LOGIN_FAILED: 未找到 havanalogin 登录 iframe")
        sys.exit(3)
    print(f"找到登录 iframe: {hf['id'][:16]}...")

    # 5. 读凭据
    account, password = load_credentials()
    if not account or not password:
        print(f"LOGIN_FAILED: 凭据文件 {CONFIG_FILE} 缺失或未配置")
        sys.exit(3)

    # 6. 填账号密码
    js_fill = f"""
    (function() {{
      function setNativeValue(el, value) {{
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', {{ bubbles: true }}));
        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
      }}
      var acc = document.getElementById('fm-login-id');
      var pwd = document.getElementById('fm-login-password');
      if (!acc || !pwd) return 'NOT_FOUND';
      setNativeValue(acc, {json.dumps(account)});
      setNativeValue(pwd, {json.dumps(password)});
      return 'FILLED';
    }})()
    """
    val, err = eval_in_frame(ws, next_id(), hf["id"], js_fill)
    print(f"填入结果: {val}")
    if val != "FILLED":
        print(f"LOGIN_FAILED: 填入失败 ({val})")
        sys.exit(3)

    time.sleep(0.5)

    # 7. 检查是否有滑块验证码输入框
    val, _ = eval_in_frame(ws, next_id(), hf["id"], """
    (function() {
      var nc = document.getElementById('nc_1_captcha_input');
      var slider = document.querySelector('.nc_iconfont, [class*=slider], [class*=nc-container]');
      return (nc && nc.offsetParent !== null) ? 'SLIDER_VISIBLE' : 'NO_SLIDER';
    })()
    """)
    print(f"滑块检测: {val}")

    # 8. 点击登录
    val, err = eval_in_frame(ws, next_id(), hf["id"], """
    (function() {
      var btn = document.querySelector('.fm-submit.password-login') || document.querySelector('button[type=submit]');
      if (!btn) return 'BTN_NOT_FOUND';
      btn.click();
      return 'CLICKED';
    })()
    """)
    print(f"点击登录: {val}")

    # 9. 等待跳转
    time.sleep(5)
    r = cdp_send(ws, next_id(), "Runtime.evaluate", {"expression": "location.href", "returnByValue": True})
    after_url = r["result"]["result"]["value"]
    print(f"登录后 URL: {after_url}")

    if LOGIN_URL_MARKER not in after_url:
        print("LOGIN_OK")
        sys.exit(0)

    # 还在登录页——可能滑块或密码错
    val, _ = eval_in_frame(ws, next_id(), hf["id"], """
    (function() {
      var nc = document.getElementById('nc_1_captcha_input');
      var err = document.querySelector('.error, [class*=error], [class*=tip]');
      return JSON.stringify({
        slider: (nc && nc.offsetParent !== null),
        errText: err ? (err.innerText||'').trim() : ''
      });
    })()
    """)
    print(f"登录后状态: {val}")

    try:
        st = json.loads(val)
        if st.get("slider"):
            print("NEED_MANUAL_SLIDER: 需人工拖滑块")
            sys.exit(2)
    except Exception:
        pass

    print("LOGIN_FAILED: 登录后仍停留在登录页")
    sys.exit(3)


if __name__ == "__main__":
    main()
