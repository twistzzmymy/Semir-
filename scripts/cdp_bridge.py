#!/usr/bin/env python3
"""CDP 浏览器操作封装（tmall-clone-id-publisher 专用）

基于 crawshrimp-skill/cdp_helper.py 的已验证能力，封装为可 import 的同步 API。
用法：
    tab = CDPTab(tab_id_prefix="190E207B")          # 按标签页 id 前缀定位
    tab = CDPTab(url_kw="sell.publish.tmall.com")    # 或按 URL 关键词定位
    v = tab.eval("document.title")                   # 执行 JS，返回 {ok, value|error}
    tab.click(966, 907)                              # CDP 原生鼠标点击（自动前置 mouseMoved）
    tab.type_text("208426107207-2")                  # 向聚焦元素插入文本
    tab.key("Ctrl+A")
    tab.shot("x.png")
    tab.rect("input#queryItemId")
"""

from __future__ import annotations

import asyncio
import base64
import json
import urllib.request

CDP_HTTP = "http://127.0.0.1:9222"


def list_tabs(cdp_url: str = CDP_HTTP) -> list[dict]:
    tabs = json.load(urllib.request.urlopen(cdp_url + "/json"))
    return [t for t in tabs if t.get("type") in ("page", "iframe")]


def find_tab(tab_id_prefix: str = None, url_kw: str = None, cdp_url: str = CDP_HTTP) -> dict:
    tabs = list_tabs(cdp_url)
    if tab_id_prefix:
        for t in tabs:
            if t.get("id", "").startswith(tab_id_prefix):
                return t
        raise RuntimeError(f"no tab matching id prefix: {tab_id_prefix}")
    if url_kw:
        for t in tabs:
            if url_kw in t.get("url", ""):
                return t
        raise RuntimeError(f"no tab matching url keyword: {url_kw}")
    raise RuntimeError("find_tab needs tab_id_prefix or url_kw")


class CDPTab:
    """对单个浏览器标签页的 CDP 操作封装（每步一个短连接，稳定优先）。"""

    def __init__(self, tab_id_prefix: str = None, url_kw: str = None, cdp_url: str = CDP_HTTP):
        target = find_tab(tab_id_prefix, url_kw, cdp_url)
        self.tab = target
        self.ws_url = target["webSocketDebuggerUrl"]
        self.url = target.get("url", "")
        self.title = target.get("title", "")

    # ---------- 底层 ----------
    def _run(self, coro):
        return asyncio.run(coro)

    async def _send(self, ws, method, params=None, _id=0):
        _id += 1
        await ws.send(json.dumps({"id": _id, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("id") == _id:
                return msg

    def _call(self, method, params=None):
        async def go():
            import websockets
            async with websockets.connect(self.ws_url, max_size=50 * 1024 * 1024) as ws:
                return await asyncio.wait_for(self._send(ws, method, params), timeout=15)
        try:
            return self._run(go())
        except asyncio.TimeoutError:
            # 页面被原生 alert/confirm 阻塞或 CDP 挂起时，防止整个流程卡死
            return {"error": "CDP timeout", "result": {"result": {"type": "object"}}}
        except Exception as e:
            return {"error": f"CDP error: {e}", "result": {"result": {"type": "object"}}}

    # ---------- 操作 ----------
    def eval(self, js: str) -> dict:
        """执行 JS，返回 {'ok': bool, 'value': ...} 或 {'ok': False, 'error': ...}"""
        r = self._call("Runtime.evaluate", {"expression": js, "returnByValue": True})
        if "error" in r:
            return {"ok": False, "error": r["error"]}
        rr = r.get("result", {}).get("result", {})
        if "value" in rr:
            return {"ok": True, "value": rr["value"]}
        if rr.get("subtype") == "error" or "exceptionDetails" in r.get("result", {}):
            return {"ok": False, "error": rr.get("description", "js error")}
        return {"ok": True, "value": None}

    def click(self, x: float, y: float):
        """CDP 原生鼠标点击（必须先 mouseMoved，否则 React 不响应）。"""
        self._call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
        for typ, extra in [("mousePressed", {"button": "left", "clickCount": 1}),
                           ("mouseReleased", {"button": "left", "clickCount": 1})]:
            self._call("Input.dispatchMouseEvent", {"type": typ, "x": x, "y": y, **extra})

    def type_text(self, text: str):
        self._call("Input.insertText", {"text": text})

    def key(self, key_name: str):
        mapping = {
            "Tab": {"key": "Tab", "code": "Tab", "windowsVirtualKeyCode": 9},
            "Enter": {"key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13},
            "Esc": {"key": "Escape", "code": "Escape", "windowsVirtualKeyCode": 27},
            "Backspace": {"key": "Backspace", "code": "Backspace", "windowsVirtualKeyCode": 8},
            "Ctrl+A": {"key": "a", "code": "KeyA", "windowsVirtualKeyCode": 65, "modifiers": 2},
        }
        p = mapping.get(key_name)
        if not p:
            raise ValueError(f"unknown key: {key_name}")
        mods = p.pop("modifiers", 0)
        for kt in ("keyDown", "keyUp"):
            self._call("Input.dispatchKeyEvent", {"type": kt, "modifiers": mods if kt == "keyDown" else 0, **p})

    def shot(self, path: str):
        r = self._call("Page.captureScreenshot", {"format": "png"})
        data = r["result"]["data"]
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        return path

    def rect(self, selector: str) -> dict | None:
        js = f"""(()=>{{const e=document.querySelector({json.dumps(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {{x:r.x,y:r.y,w:r.width,h:r.height,text:(e.innerText||'').slice(0,60)}}}})()"""
        r = self.eval(js)
        return r.get("value") if r.get("ok") else None

    # ---------- 便捷 ----------
    def scroll_to(self, y: int):
        self.eval(f"window.scrollTo(0,{y}); 'ok'")

    def scroll_by(self, dy: int):
        self.eval(f"window.scrollBy(0,{dy}); 'ok'")

    def scroll_to_element(self, text: str, offset: int = 300):
        """滚动到指定文字元素（模糊匹配），返回其当前 y 或 None。"""
        js = f"""(()=>{{const all=document.querySelectorAll('*');for(const el of all){{if(el.children.length>0)continue;const t=(el.textContent||'').trim();if(t.includes({json.dumps(text)})){{const r=el.getBoundingClientRect();window.scrollBy(0,r.y-{offset});return r.y;}}}}return null;}})()"""
        r = self.eval(js)
        return r.get("value") if r.get("ok") else None

    def find_text(self, text: str, x0: float = 0, y0: float = 0, x1: float = 2000, y1: float = 2000) -> dict | None:
        """在视口区域(x0,y0,x1,y1)内找文字元素（精确相等），返回 {x,y,w,h}。"""
        js = f"""(()=>{{const all=document.querySelectorAll('*');for(const el of all){{if(el.children.length>0)continue;const t=(el.textContent||'').trim();const r=el.getBoundingClientRect();if(t==={json.dumps(text)}&&r.width>5&&r.height>5&&r.x>={x0}&&r.x<={x1}&&r.y>={y0}&&r.y<={y1})return {{x:r.x,y:r.y,w:r.width,h:r.height}};}}return null;}})()"""
        r = self.eval(js)
        return r.get("value") if r.get("ok") else None

    def find_text_fuzzy(self, text: str, x0: float = 0, y0: float = 0, x1: float = 2000, y1: float = 2000) -> dict | None:
        """在视口区域找文字元素（includes 模糊匹配，兼容按钮文本带空白/子元素拆分）。"""
        js = f"""(()=>{{const all=document.querySelectorAll('*');for(const el of all){{if(el.children.length>0)continue;const t=(el.textContent||'').trim();const r=el.getBoundingClientRect();if(t.includes({json.dumps(text)})&&r.width>5&&r.height>5&&r.x>={x0}&&r.x<={x1}&&r.y>={y0}&&r.y<={y1})return {{x:r.x,y:r.y,w:r.width,h:r.height}};}}return null;}})()"""
        r = self.eval(js)
        return r.get("value") if r.get("ok") else None

    def click_text(self, text: str, x0: float = 0, y0: float = 0, x1: float = 2000, y1: float = 2000) -> bool:
        """点击指定文字元素（视口内）。"""
        el = self.find_text(text, x0, y0, x1, y1)
        if not el:
            return False
        self.click(el["x"] + el["w"] / 2, el["y"] + el["h"] / 2)
        return True

    def click_text_js(self, text: str) -> bool:
        """用 JS 直接 click 指定文字元素（React 拦截时可能无效，兜底用）。"""
        js = f"""(()=>{{const all=document.querySelectorAll('*');for(const el of all){{if(el.children.length>0)continue;const t=(el.textContent||'').trim();if(t==={json.dumps(text)}){{el.click();return true;}}}}return false;}})()"""
        r = self.eval(js)
        return bool(r.get("value")) if r.get("ok") else False


def find_by_class(tab: CDPTab, cls_substr: str) -> dict | None:
    """按 className 子串找第一个可见元素，返回 {x,y,w,h,cls}。"""
    js = f"""(()=>{{const all=document.querySelectorAll('*');for(const el of all){{const cls=(el.className||'').toString();const r=el.getBoundingClientRect();if(cls.includes({json.dumps(cls_substr)})&&r.width>5&&r.height>5)return {{x:r.x,y:r.y,w:r.width,h:r.height,cls:cls.slice(0,60)}};}}return null;}})()"""
    r = tab.eval(js)
    return r.get("value") if r.get("ok") else None
