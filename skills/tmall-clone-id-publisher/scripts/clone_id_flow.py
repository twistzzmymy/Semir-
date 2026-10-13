#!/usr/bin/env python3
"""克隆ID发布主流程（tmall-clone-id-publisher）

整链路固化（2026-09-22/23 生产实测通过）：
  在售页搜原ID → 关SKU弹窗 → 发布相似品 → [同类宝贝预判→切类目] → 图文描述(旧版文本编辑)
  → 销售信息(放入仓库) → 身高排序(调 tmall-height-sorter) → 提交
  → 错误学习库（命中方案自动应用 / 未命中记录等待人工）→ 成功回填Excel B列

用法：
  python clone_id_flow.py --excel "E:/巴拉巴拉/ID克隆/上新ID-9.22.xlsx" \
      --brand 巴拉巴拉 [--start-row 2] [--end-row 182] [--dry-run] [--yes]

说明：
  --dry-run  只执行到"打开编辑页+预判"阶段并输出计划，不点击提交
  --yes      提交动作授权（提交属外部生效动作，crawshrimp 契约要求显式授权）
  未带 --yes 时每个待提交行会打印计划并跳过提交
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from cdp_bridge import CDPTab, find_tab, list_tabs  # noqa: E402
from category_switch import switch_category, wait  # noqa: E402
import error_knowledge  # noqa: E402

# ---------- 路径配置 ----------
# 身高排序依赖优先使用本 skill 内置 deps/（可移植），缺失时回退本机既有目录（兼容旧环境）。
HERE = Path(__file__).resolve().parent
SKILL_DIR = HERE.parent
DEPS_DIR = SKILL_DIR / "deps"
CRAWSHRIMP = DEPS_DIR if DEPS_DIR.exists() else Path(r"E:\巴拉知识库\技能\crawshrimp-skill")
TMAIL_HEIGHT_SORTER = (DEPS_DIR / "tmall_height_sorter.py") if DEPS_DIR.exists() else Path(r"E:\巴拉知识库\技能\tmall-height-sorter\scripts\tmall_height_sorter.py")

# ---------- 已跑通的关键 JS ----------

JS_SEARCH_INPUT = "input#queryItemId"
JS_SEARCH_BTN = r"""
(() => {
  const btns = document.querySelectorAll('button');
  for (const b of btns) {
    const t = (b.textContent || '').trim();
    if (t === '搜索' && b.getBoundingClientRect().width > 20) {
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }
  }
  return null;
})()
"""

JS_CLOSE_SKU = r"""
(() => {
  const el = document.querySelector('.closeHotspot');
  if (el) { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }
  return null;
})()
"""

JS_MORE_BTN = r"""
(() => {
  const all = document.querySelectorAll('button, a, span, div');
  for (const el of all) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').trim();
    const r = el.getBoundingClientRect();
    // "更多"按钮位置随页签/商品行变化（出售中页签 x≈1700、全部页签 x≈1730），不限定 x
    if (t === '更多' && r.width > 5 && r.height > 5) return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  return null;
})()
"""

JS_SIMILAR_MENU = r"""
(() => {
  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').trim();
    const r = el.getBoundingClientRect();
    if (t === '发布相似品' && r.width > 5 && r.height > 5) return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  return null;
})()
"""

JS_HAS_TEXT = lambda text: f"""(()=>{{const b=document.body.innerText||'';return b.includes({json.dumps(text)});}})()"""

JS_EDITOR_IMGS = r"""
(() => {
  const fs = document.querySelectorAll('iframe');
  let best = null;
  for (const f of fs) {
    if (!(f.className || '').toString().includes('ks-editor-iframe')) continue;
    try {
      const doc = f.contentDocument;
      if (!doc || !doc.body) continue;
      const imgs = doc.querySelectorAll('img').length;
      const htmlLen = (doc.body.innerHTML || '').length;
      const rr = f.getBoundingClientRect();
      // 页面多个 ks-editor-iframe（隐藏/空初始化 iframe），取内容最多的真实编辑器
      if (!best || htmlLen > best.htmlLen) {
        best = { imgs, htmlLen, w: Math.round(rr.width), y: Math.round(rr.y) };
      }
    } catch (e) { /* 跨域 iframe 跳过 */ }
  }
  return best || { imgs: 0, htmlLen: 0, notFound: true };
})()
"""

JS_WAREHOUSE_CHECKED = r"""
(() => {
  const radios = document.querySelectorAll('input[type=radio]');
  for (const r of radios) {
    const rect = r.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.y > 300 && rect.y < 600) {
      const label = r.closest('label') ? (r.closest('label').textContent || '').trim() : '';
      if (label.includes('放入仓库') || label === '') {
        // 靠近"放入仓库"文字的上架 radio
        const all = document.querySelectorAll('*');
        for (const el of all) {
          if (el.children.length > 0) continue;
          const t = (el.textContent || '').trim();
          const er = el.getBoundingClientRect();
          if (t === '放入仓库' && er.width > 5) {
            if (Math.abs(er.y - rect.y) < 30 && Math.abs(er.x - rect.x) < 300) return { checked: r.checked, x: rect.x, y: rect.y };
          }
        }
      }
    }
  }
  return null;
})()
"""

JS_SUBMIT_BTN = r"""
(() => {
  // 优先：页面底部浮动栏的提交按钮（参考 tmall-size_rank-publisher）
  const fb = document.querySelector('.sell-float-bottom button.next-btn-primary');
  if (fb && fb.offsetParent !== null) {
    const r = fb.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'float-bottom' };
  }
  // 备用：找文字"提交"且可见的按钮
  const btns = document.querySelectorAll('button');
  for (const b of btns) {
    const t = (b.textContent || '').trim();
    const r = b.getBoundingClientRect();
    if (t === '提交' && b.offsetParent !== null && r.width > 20 && r.height > 10) return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'text' };
  }
  return null;
})()
"""

# 弹窗自动处理（参考 tmall-size_rank-publisher：属性更新→取消；详情升级→确认提交；其他→确定/知道了）
JS_DISMISS_DIALOGS = r"""
(() => {
  const dismissed = [];
  const dialogs = document.querySelectorAll('.next-dialog, .next-modal, [class*=dialog], [class*=modal]');
  for (const dialog of dialogs) {
    if (dialog.offsetParent === null) continue;
    const dText = dialog.textContent || '';
    const btns = dialog.querySelectorAll('button, .next-btn, .dialog-btn');
    if (dText.includes('商品属性信息更新')) {
      for (const b of btns) { if ((b.textContent || '').trim() === '取消') { b.click(); dismissed.push('属性更新-取消'); break; } }
    } else if (dText.includes('图文详情编辑器升级')) {
      for (const b of btns) { if ((b.textContent || '').trim() === '确认提交') { b.click(); dismissed.push('详情升级-确认提交'); break; } }
    } else {
      for (const b of btns) {
        const t = (b.textContent || '').trim();
        if (['确定', '确认', '知道了', '好的', '继续'].includes(t)) { b.click(); dismissed.push(t); break; }
      }
    }
  }
  return { dismissed };
})()
"""

JS_CHECK_SUCCESS = r"""
(() => {
  const u = location.href;
  // 跳转到成功页（success.htm + isSuccess=true）→ 新ID在 primaryId 参数
  if (u.includes('success.htm') && u.includes('isSuccess=true')) {
    const m = u.match(/[?&]primaryId=(\d+)/);
    return { success: true, via: 'success_page', primaryId: m ? m[1] : '' };
  }
  const b = document.body ? (document.body.innerText || '') : '';
  for (const kw of ['提交成功', '保存成功', '发布成功', '操作成功']) {
    if (b.includes(kw)) return { success: true, via: 'text', primaryId: '' };
  }
  return { success: false, via: '', primaryId: '' };
})()
"""

JS_PAGE_ERRORS = r"""
(() => {
  const b = document.body.innerText || '';
  const errs = [];
  if (b.includes('同类宝贝') || b.includes('不允许再发布')) errs.push('同类宝贝5个');
  if (b.includes('操作码')) {
    const m = b.match(/操作码[是：:\s]*([0-9a-f]{10,})/);
    if (m) errs.push('opcode=' + m[1]);
  }
  if (b.includes('旺铺') && (b.includes('必填') || b.includes('详情'))) errs.push('旺铺PC详情');
  if (b.includes('标题过长')) errs.push('标题过长(非阻断)');
  if (b.includes('不能为空') || b.includes('必填项')) {
    const m = b.match(/必填项([^\n，。、]+?)不能为空/);
    errs.push(m ? ('必填项缺失:' + m[1]) : '必填项缺失');
  }
  const op = b.match(/213e[0-9a-f]{10,}/);
  if (op) {
    if (op[0].startsWith('213e05')) errs.push('同类宝贝5个');
    if (op[0].startsWith('213e04')) errs.push('旺铺PC详情');
    errs.push('opcode=' + op[0]);
  }
  return errs.join('|');
})()
"""

JS_SUCCESS_SIGNAL = r"""
(() => {
  const u = location.href;
  const b = document.body ? (document.body.innerText || '') : '';
  if (b.includes('发布成功') || b.includes('保存成功') || b.includes('已提交') || b.includes('提交成功')) return 'success_text';
  if (!u.includes('publish.htm')) return 'left_publish_page';
  return '';
})()
"""

JS_EDIT_READY = r"""
(() => {
  const b = document.body ? (document.body.innerText || '') : '';
  const u = location.href;
  if (!u.includes('publish.htm')) return { ready: false, why: 'not publish page' };
  return { ready: b.includes('图文描述') && (b.includes('基础信息') || b.includes('当前类目')), why: '' };
})()
"""


JS_EDIT_PAGE_ID = r"""
(() => {
  const m = location.href.match(/[?&]id=(\d+)/);
  return m ? m[1] : '';
})()
"""


JS_ENSURE_ONSALE = r"""
(() => {
  const u = location.href;
  if (u.includes('on_sale')) return { state: 'already_onsale' };
  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').trim();
    const r = el.getBoundingClientRect();
    if (t === '出售中' && r.width > 5 && r.height > 5 && r.x < 600 && r.y < 200) {
      el.click();
      return { state: 'clicked_onsale', x: r.x, y: r.y };
    }
  }
  return { state: 'onsale_tab_not_found' };
})()
"""


# ---------- 节点实现 ----------

def open_onsale_tab(cdp_url: str = "http://127.0.0.1:9222") -> CDPTab:
    """定位在售页标签，并确保在"出售中"页签。"""
    tab = CDPTab(url_kw="myseller.taobao.com", cdp_url=cdp_url)
    r = tab.eval(JS_ENSURE_ONSALE).get("value") or {}
    if r.get("state") == "clicked_onsale":
        wait(2500)
    return tab


def ensure_tab(tab: CDPTab, name: str) -> str:
    """确保在售页当前页签为 name（出售中/全部/仓库中等）。点击页签后轮询 URL 切换（最多3轮点击）。"""
    def url_ok(name: str, url: str) -> bool:
        if name == "出售中":
            return "on_sale" in url
        if name == "全部":
            return "/all" in url
        if name == "仓库中":
            return "in_warehouse" in url or "warehouse" in url
        return False
    url = tab.eval("location.href").get("value") or ""
    if url_ok(name, url):
        return "already"
    js = f"""(()=>{{const all=document.querySelectorAll('*');for(const el of all){{if(el.children.length>0)continue;const t=(el.textContent||'').trim();const r=el.getBoundingClientRect();if(t==={json.dumps(name)}&&r.width>5&&r.height>5&&r.x<600&&r.y<200){{el.click();return 'clicked';}}}}return 'not_found';}})()"""
    for attempt in range(3):
        r = tab.eval(js).get("value")
        if r != "clicked":
            break
        # 轮询 URL 切换（页签切换为异步重载，最多等 20s）
        for _ in range(20):
            url = tab.eval("location.href").get("value", "")
            if url_ok(name, url):
                wait(2500)
                return "switched"
            wait(1000)
        # 未切换：可能是上次搜索残留/弹窗遮挡，刷新页面后重试
        if attempt < 2:
            tab.eval("location.reload(); 'ok'")
            wait(3500)
    return "not_switched"


def search_origin_id(tab: CDPTab, origin_id: str, tab_name: str = "出售中") -> bool:
    """在指定页签搜索原ID。返回列表是否命中（URL 参数 + 列表正文双验证）。"""
    st = ensure_tab(tab, tab_name)
    if st in ("switched",):
        wait(1500)
    # 移除 Fusion overlay backdrop 遮罩（2026-10-12 实测：页面加载后残留透明遮罩拦截点击，
    # 导致 queryItemId 点击后 activeElement 仍为 BODY、type_text 写不进去；移除后点击聚焦正常）
    tab.eval("""(() => {
      const m = document.querySelectorAll('.next-overlay-backdrop');
      let n = 0;
      for (const el of m) { el.remove(); n++; }
      return n;
    })()""")
    wait(300)
    # 定位搜索输入框（找不到时刷新页面重试一次——页签切换后 DOM 可能未就绪）
    rect = tab.rect(JS_SEARCH_INPUT)
    if not rect:
        tab.eval("location.reload(); 'ok'")
        wait(4000)
        rect = tab.rect(JS_SEARCH_INPUT)
    if not rect:
        # 滚动到列表顶部再试
        tab.scroll_to(0)
        wait(500)
        rect = tab.rect(JS_SEARCH_INPUT)
    if not rect:
        raise RuntimeError("queryItemId input not found")
    tab.click(rect["x"] + rect["w"] / 2, rect["y"] + rect["h"] / 2)
    wait(400)
    tab.key("Ctrl+A")
    wait(200)
    tab.type_text(origin_id)
    wait(400)
    # 点搜索
    btn = tab.eval(JS_SEARCH_BTN).get("value")
    if not btn:
        raise RuntimeError("search button not found")
    tab.click(btn["x"] + btn["w"] / 2, btn["y"] + btn["h"] / 2)
    wait(2500)
    # 双验证：URL 参数 + 列表正文命中
    r = tab.eval("location.href")
    url = r.get("value", "")
    hit = tab.eval(f"""(()=>{{const b=document.body.innerText||'';return {{noData: b.includes('没有数据'), hit: b.includes({json.dumps(origin_id)})}};}})()""").get("value") or {}
    return f"queryItemId={origin_id}" in url and bool(hit.get("hit")) and not hit.get("noData")


def close_sku_popup(tab: CDPTab) -> bool:
    """关闭在售页 SKU 弹窗。"""
    el = tab.eval(JS_CLOSE_SKU).get("value")
    if not el:
        return True  # 无弹窗
    tab.click(el["x"] + el["w"] / 2, el["y"] + el["h"] / 2)
    wait(800)
    return not bool(tab.eval(JS_CLOSE_SKU).get("value"))


def open_similar_publish(tab: CDPTab, origin_id: str, cdp_url: str = "http://127.0.0.1:9222") -> CDPTab:
    """打开"发布相似品"编辑页。

    优先直接点操作列的"发布相似品"（部分商品直出该按钮）；
    否则点"更多"→菜单"发布相似品"。返回新编辑页标签。
    """
    before_ids = {t["id"] for t in list_tabs(cdp_url)}
    # 优先：操作列直出"发布相似品"
    sim = tab.eval(JS_SIMILAR_MENU).get("value")
    if sim:
        tab.click(sim["x"] + sim["w"] / 2, sim["y"] + sim["h"] / 2)
    else:
        # 兜底：更多 → 发布相似品
        btn = tab.eval(JS_MORE_BTN).get("value")
        if not btn:
            raise RuntimeError("更多 button not found")
        tab.click(btn["x"] + btn["w"] / 2, btn["y"] + btn["h"] / 2)
        wait(1200)
        menu = tab.eval(JS_SIMILAR_MENU).get("value")
        if not menu:
            raise RuntimeError("发布相似品 menu not found")
        tab.click(menu["x"] + menu["w"] / 2, menu["y"] + menu["h"] / 2)
    # 点击"发布相似品"后等待新标签页出现
    for _ in range(10):
        wait(1000)
        for t in list_tabs(cdp_url):
            if t["id"] not in before_ids and "sell.publish.tmall.com" in t.get("url", ""):
                edit_tab = CDPTab(tab_id_prefix=t["id"][:8], cdp_url=cdp_url)
                # 关键：等待编辑页完全加载（body 出现"图文描述/基础信息"），
                # 否则后续 desc 步骤在未就绪页面上找不到按钮而静默跳过（row2/3 根因）
                for _ in range(15):
                    r = edit_tab.eval(JS_EDIT_READY).get("value") or {}
                    if r.get("ready"):
                        wait(1500)
                        return edit_tab
                    wait(2000)
                # 超时也返回（由后续节点自行验证），但记录警告
                print(f"  [warn] edit page not ready in 30s: {t.get('url', '')[:80]}")
                return edit_tab
    raise RuntimeError("publish edit tab did not open")


JS_FIND_EXPAND_BTN = r"""
(() => {
  // 优先：图文描述模块的"展开补充更多信息"（用户修正方案的正解按钮）
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').trim();
    const r = el.getBoundingClientRect();
    if (t.includes('展开补充更多信息') && r.width > 5 && r.height > 5 && r.y > 150 && r.y < 1600) {
      return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'expand-more' };
    }
  }
  // 兜底：模糊"展开"（排除顶部 tab 区 y<300）
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').trim();
    const r = el.getBoundingClientRect();
    if (t === '展开' && r.width > 5 && r.height > 5 && r.y > 300 && r.y < 1600) {
      return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'expand' };
    }
  }
  return null;
})()
"""


def goto_desc_old_mode(tab: CDPTab) -> dict:
    """图文描述 → [用户方案] 下滑→展开→使用文本编辑；兜底返回旧版→使用文本编辑。

    返回旧描述统计。按钮位置随滚动/商品变化，一律全视口动态定位；
    视口外元素点击前必须 scroll_to_element（row2/3"未返回旧版"根因）。
    用户修正（2026-09-24）："旺铺PC详情"错误的正解是
    "图文描述 - 下滑 - 寻找展开按钮 - 点击展开 - 再选择使用文本编辑"，
    而非先返回旧版；展开后仍无"使用文本编辑"的特殊类目（发育内衣/抹胸等）
    标记人工处理（PC 详情在跨域 iframe 装修编辑器内）。
    """
    # 双保险：确保编辑页已就绪
    for _ in range(10):
        r = tab.eval(JS_EDIT_READY).get("value") or {}
        if r.get("ready"):
            break
        wait(1500)
    def _find_textedit_label():
        return tab.eval(r"""(() => {
          const labels = document.querySelectorAll('label');
          for (const l of labels) {
            const t = (l.textContent || '').trim();
            if (t === '使用文本编辑') {
              let inp = l.querySelector('input[type=radio]');
              if (!inp && l.htmlFor) inp = document.getElementById(l.htmlFor);
              const r = l.getBoundingClientRect();
              return {checked: inp ? inp.checked : null, hasInput: !!inp,
                      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)};
            }
          }
          return null;
        })()""").get('value')

    tab.eval("window.scrollTo(0,0); 'ok'")
    wait(500)
    # 点图文描述 tab（顶部 tab 栏 x 随商品/类目变化，范围放宽到全宽，y 限顶部）
    if not tab.click_text("图文描述", 0, 0, 2000, 300):
        tab.click_text_js("图文描述")
    wait(1200)
    # 验证 tab 切换：若页面无"图文描述"字样则重试 JS 兜底
    vis = tab.eval(JS_HAS_TEXT("图文描述")).get("value")
    if not vis:
        tab.click_text_js("图文描述")
        wait(1500)

    # ---- 主路径 A：点"编辑电脑端详情"打开旺铺PC详情编辑器（2026-09-29 row60 实测）----
    # 旺铺PC详情模块"编辑电脑端详情"按钮 y≈838 在视口内；点击后编辑器出现，
    # "使用文本编辑" LABEL 才渲染（row60 的"返回旧版"按钮在页面横向滚动区，点击无效）
    JS_FIND_EDIT_PC = r"""
    (() => {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (el.children.length > 0) continue;
        const t = (el.textContent || '').trim();
        if (t === '编辑电脑端详情' || t === '编辑电脑详情') {
          const r = el.getBoundingClientRect();
          return {x: r.x, y: r.y, w: r.width, h: r.height};
        }
      }
      return null;
    })()
    """
    epc = tab.eval(JS_FIND_EDIT_PC).get('value')
    if epc:
        if epc["y"] > 900 or epc["y"] < 0:
            tab.eval(f"window.scrollTo(0, window.scrollY + {epc['y']} - 350); 'ok'")
            wait(1200)
            epc = tab.eval(JS_FIND_EDIT_PC).get('value')
        if epc and 0 <= epc["y"] <= 900:
            tab.click(epc["x"] + epc["w"] / 2, epc["y"] + epc["h"] / 2)
            wait(4000)
    lab = _find_textedit_label()

    # ---- 主路径 B：返回旧版图文描述 → 弹窗确定 → 使用文本编辑（2026-09-29 实测；row48 有效）----
    # 注意：勿用"展开补充更多信息"路径——那是基础信息tab的商品属性展开按钮，与图文描述无关
    if not lab or lab.get("w", 0) <= 5 or lab.get("h", 0) <= 5:
        tab.eval("window.scrollTo(0,0); 'ok'")
        wait(500)
        # 返回旧版按钮在页面横向滚动区（x≈1487>视口宽）+ 纵向视口外（y≈2856），
        # 必须 scrollIntoView(block:center, inline:center) 同时横纵向滚动，再点击
        el = tab.eval(r"""(() => {
          const all = document.querySelectorAll('*');
          for (const el of all) {
            if (el.children.length > 0) continue;
            const t = (el.textContent || '').trim();
            if (t.includes('返回旧版')) {
              el.scrollIntoView({block: 'center', inline: 'center'});
              const r = el.getBoundingClientRect();
              return {x: r.x, y: r.y, w: r.width, h: r.height};
            }
          }
          return null;
        })()""").get('value')
        if el and el["w"] > 5 and 0 <= el["y"] <= 900:
            tab.click(el["x"] + el["w"] / 2, el["y"] + el["h"] / 2)
            wait(1500)
            # 弹窗：确认返回旧版吗 → 确定（兜底：任何"确定/确认"）
            for kw in ("确认返回旧版吗", "确定", "确认"):
                d = tab.find_text_fuzzy(kw, 0, 0, 2000, 2000)
                if d and d["w"] > 5:
                    tab.click(d["x"] + d["w"] / 2, d["y"] + d["h"] / 2)
                    wait(1500)
                    break
            wait(2500)
            lab = _find_textedit_label()
    # 使用文本编辑：点击 LABEL 祖先（radio-item 可点击区）选中 radio——点击 leaf 文本不会选中 radio！
    # （测试9：LABEL 点击后 checked=false→true；这是提交通过旺铺校验的关键）
    JS_EXPAND_FIND = r"""
(() => {
  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').trim();
    const r = el.getBoundingClientRect();
    if (t === '展开' && r.width > 5 && r.height > 5 && r.y > 100 && r.y < 2000) {
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }
  }
  return null;
})()
"""


    lab = _find_textedit_label()
    # 展开兜底：LABEL 未渲染（0 尺寸 / 无 offsetParent）时，点"展开"按钮再找
    # （row78 实测：图文描述 tab 激活后电脑端描述区折叠，"展开"在 y≈1314）
    if not lab or lab.get("w", 0) <= 5 or lab.get("h", 0) <= 5:
        # 展开兜底：选 y 最大者（图文描述区底部"展开"；勿点售后区 y<0 的展开）
        ex_all = tab.eval(r"""(() => {
          const out = [];
          const all = document.querySelectorAll('*');
          for (const el of all) {
            if (el.children.length > 0) continue;
            const t = (el.textContent || '').trim();
            if (t === '展开') {
              const r = el.getBoundingClientRect();
              out.push({x: r.x, y: r.y, w: r.width, h: r.height});
            }
          }
          return out;
        })()""").get('value') or []
        if ex_all:
            ex = max(ex_all, key=lambda e: e['y'])
            if ex["y"] > 900 or ex["y"] < 0:
                tab.eval(f"window.scrollTo(0, window.scrollY + {ex['y']} - 400); 'ok'")
                wait(1200)
                ex_all = tab.eval(r"""(() => {
                  const out = [];
                  const all = document.querySelectorAll('*');
                  for (const el of all) {
                    if (el.children.length > 0) continue;
                    const t = (el.textContent || '').trim();
                    if (t === '展开') {
                      const r = el.getBoundingClientRect();
                      out.push({x: r.x, y: r.y, w: r.width, h: r.height});
                    }
                  }
                  return out;
                })()""").get('value') or []
                ex = max(ex_all, key=lambda e: e['y']) if ex_all else None
            if ex and 0 <= ex["y"] <= 900:
                tab.click(ex["x"] + ex["w"] / 2, ex["y"] + ex["h"] / 2)
                wait(3500)
                lab = _find_textedit_label()
    if lab:
        # 0 尺寸 LABEL（隐藏 radio 组）：直接对 .next-radio 组件元素派发事件选中
        # （2026-10-12 实测：坐标点击 (0,0) 无效；Fusion 组件监听 mousedown/mouseup/click，
        #  即使元素 0 尺寸也能响应，aria/checked false→true）
        if lab["w"] <= 5 or lab["h"] <= 5:
            for _try in range(3):
                if lab.get("checked"):
                    break
                tab.eval(r"""(() => {
                  for (const l of document.querySelectorAll('label')) {
                    const t = (l.textContent || '').trim();
                    if (t === '使用文本编辑') {
                      const radio = l.querySelector('.next-radio') || l.querySelector('.next-radio-wrapper');
                      if (!radio) return false;
                      radio.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true, view: window}));
                      radio.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, cancelable: true, view: window}));
                      radio.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, view: window}));
                      return true;
                    }
                  }
                  return false;
                })()""")
                wait(1500)
                lab = _find_textedit_label()
        else:
            if lab["y"] > 900 or lab["y"] < 0:
                tab.eval(f"window.scrollTo(0, window.scrollY + {lab['y']} - 300); 'ok'")
                wait(1200)
                lab = _find_textedit_label()
            if lab and 0 <= lab["y"] <= 900:
                for _try in range(3):
                    if lab.get("checked"):
                        break
                    tab.click(lab["x"] + lab["w"] / 2, lab["y"] + lab["h"] / 2)
                    wait(2500)
                    lab = _find_textedit_label()
    stats0 = {"radio_checked": lab.get("checked") if lab else None,
              "label_found": bool(lab),
              "expand_used": not lab or lab.get("w", 0) <= 5 or lab.get("h", 0) <= 5}
    wait(2000)
    # 编辑器懒渲染：滚动到编辑器区域（0.5 / 0.65）再统计
    stats = tab.eval(JS_EDITOR_IMGS).get("value") or {}
    if not stats.get("imgs"):
        tab.eval("window.scrollTo(0, document.body.scrollHeight * 0.5); 'ok'")
        wait(1200)
        stats = tab.eval(JS_EDITOR_IMGS).get("value") or {}
        if not stats.get("imgs"):
            tab.eval("window.scrollTo(0, document.body.scrollHeight * 0.65); 'ok'")
            wait(1200)
            stats = tab.eval(JS_EDITOR_IMGS).get("value") or {}
    stats["via"] = "fallback" if stats.get("imgs", 0) > 0 else "none"
    stats.update(stats0)
    return stats


# ---------- 旧描述模块淘金币促销图清理（2026-09-29 生产实测） ----------

JS_DELETE_ALL_PROMO = r"""
(() => {
  const fs = document.querySelectorAll('iframe');
  for (const f of fs) {
    if (!(f.className || '').toString().includes('ks-editor-iframe')) continue;
    try {
      const doc = f.contentDocument;
      if (!doc || !doc.body) continue;
      const imgs = doc.querySelectorAll('img');
      const hits = [];
      for (const img of imgs) {
        const src = img.src || '';
        const nw = img.naturalWidth || 0;
        const nh = img.naturalHeight || 0;
        if (src.includes('tps-1240-450') || src.includes('6000000007501') || src.includes('vWMf4v25HV') ||
            (nw === 1240 && nh === 450)) {
          hits.push({src: src.slice(-80), nw, nh});
          img.remove();
        }
      }
      return {ok: hits.length > 0, removed: hits.length,
              remaining: doc.querySelectorAll('img').length, hits};
    } catch (e) { return {ok: false, error: e.message}; }
  }
  return {ok: false, removed: 0, remaining: 0, notFound: true};
})()
"""

JS_FIND_OLDDESC_EDIT = r"""
(() => {
  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').trim();
    if (t.startsWith('旧描述')) {  // 兼容'旧描述(选填)'
      const rr = el.getBoundingClientRect();
      // 同一行(y差<40)右侧(x差>300)最近的"编辑"或"展开"按钮（旧描述模块两种文案）
      let best = null;
      for (const el2 of document.querySelectorAll('*')) {
        if (el2.children.length > 0) continue;
        const t2 = (el2.textContent || '').trim();
        if (t2 === '编辑' || t2 === '展开') {
          const r2 = el2.getBoundingClientRect();
          if (Math.abs(r2.y - rr.y) < 40 && r2.x > rr.x + 300 && r2.width > 5) {
            if (!best || r2.x < best.x) best = {x: r2.x, y: r2.y, w: r2.width, h: r2.height, via: t2};
          }
        }
      }
      return {descY: rr.y, edit: best};
    }
  }
  return null;
})()
"""

JS_SCAN_OLD_DESC_IMGS = r"""
(() => {
  const out = {imgs: [], editors: []};
  const fs = document.querySelectorAll('iframe');
  for (const f of fs) {
    if (!((f.className || '').toString().includes('ks-editor-iframe'))) continue;
    const rr = f.getBoundingClientRect();
    out.editors.push({w: Math.round(rr.width), h: Math.round(rr.height), y: Math.round(rr.y)});
    if (rr.width < 50 || rr.height < 50) continue;
    try {
      const doc = f.contentDocument;
      if (!doc || !doc.body) continue;
      doc.querySelectorAll('img').forEach((img, i) => {
        out.imgs.push({i, nw: img.naturalWidth || 0, nh: img.naturalHeight || 0, src: (img.src || '').slice(-70)});
      });
    } catch (e) { out.editors.push({err: e.message}); }
  }
  return out;
})()
"""

JS_DELETE_OLD_DESC_IMG = r"""
(idx) => {
  const fs = document.querySelectorAll('iframe');
  for (const f of fs) {
    if (!((f.className || '').toString().includes('ks-editor-iframe'))) continue;
    const rr = f.getBoundingClientRect();
    if (rr.width < 50) continue;
    try {
      const doc = f.contentDocument;
      const imgs = doc.querySelectorAll('img');
      if (imgs[idx]) {
        const src = imgs[idx].src;
        imgs[idx].remove();
        doc.body.dispatchEvent(new Event('input', {bubbles: true}));
        doc.body.dispatchEvent(new Event('change', {bubbles: true}));
        return {ok: true, removed: src.slice(0, 70), remaining: doc.querySelectorAll('img').length};
      }
    } catch (e) { return {ok: false, err: e.message}; }
  }
  return {ok: false};
}
"""


def clean_old_desc_promo(tab: CDPTab, via: str = "") -> dict:
    """清理旧描述模块的淘金币促销图（克隆相似品常见，ERR-006）。

    背景（2026-09-29 生产实测，用户指引）：淘金币图**只在"返回旧版"路径
    （goto_desc_old_mode via=fallback）出现**；位置为**旧描述模块点"编辑/展开"
    后的首图 img[0]**（src 含 `tps-1240-450.png`，1240x450"点击享大额补贴"）。
    展开路径（via=expand）无此图，无需清理。

    逻辑（单一路径）：
      1. via 非 fallback → 直接跳过（返回 why='via not fallback'）
      2. 定位"旧描述"行右侧"编辑/展开"按钮（找不到 → 切图文描述 tab + 滚动重找 2 轮）
      3. 点按钮 → 旧描述编辑器打开 → 扫描可见 ks-editor-iframe
      4. 只判断**首图 imgs[0]** 是否淘金币图（src 含 tps-1240-450 或 natural 1240x450）
      5. 命中即删除（JS_DELETE_OLD_DESC_IMG）

    返回 {scanned, found, deleted, remaining, via, why}
    """
    def _find_edit():
        return tab.eval(JS_FIND_OLDDESC_EDIT).get("value")
    r = _find_edit()
    if not r or not r.get("edit"):
        tab.eval("window.scrollTo(0,0); 'ok'")
        wait(500)
        tab.click_text("图文描述", 0, 0, 2000, 300) or tab.click_text_js("图文描述")
        wait(1500)
        r = _find_edit()
    if not r or not r.get("edit"):
        # 滚动到"旧描述"文本可见（模块在图文描述区域底部）
        tab.scroll_to_element("旧描述", offset=400)
        wait(1000)
        r = _find_edit()
    if not r or not r.get("edit"):
        tab.eval("window.scrollTo(0, document.body.scrollHeight * 0.7); 'ok'")
        wait(1000)
        r = _find_edit()
    if not r or not r.get("edit"):
        # 兜底（row60 实证）：已返回旧版（via=fallback）时旧描述图在 ks-editor-iframe 内，
        # 即使主文档找不到"旧描述编辑"按钮，也直接扫描所有编辑器 iframe 删除淘金币特征图
        scan = tab.eval(JS_SCAN_OLD_DESC_IMGS).get("value") or {}
        imgs = scan.get("imgs") or []
        promo = [i for i in imgs
                 if ("tps" in (i.get("src") or "") and "1240-450" in (i.get("src") or ""))
                 or "6000000007501" in (i.get("src") or "")
                 or "vWMf4v25HV" in (i.get("src") or "")
                 or (i.get("nw") == 1240 and i.get("nh") == 450)]
        if promo:
            del_r = tab.eval(JS_DELETE_ALL_PROMO).get("value") or {}
            wait(2500)
            scan2 = tab.eval(JS_SCAN_OLD_DESC_IMGS).get("value") or {}
            imgs2 = scan2.get("imgs") or []
            promo2 = [i for i in imgs2
                      if ("tps" in (i.get("src") or "") and "1240-450" in (i.get("src") or ""))
                      or "6000000007501" in (i.get("src") or "")
                      or "vWMf4v25HV" in (i.get("src") or "")
                      or (i.get("nw") == 1240 and i.get("nh") == 450)]
            return {"scanned": len(imgs), "found": True, "deleted": bool(del_r.get("ok")),
                    "removed_count": del_r.get("removed", 0),
                    "remaining_promo": len(promo2),
                    "remaining": del_r.get("remaining"),
                    "via": "iframe-direct", "why": "direct-iframe-fallback"}
        return {"scanned": len(imgs), "found": False, "deleted": False, "why": "old desc edit/expand btn not found"}
    e = r["edit"]
    if e["y"] > 900 or e["y"] < 0:
        # 滚动到"旧描述"模块可见（勿用"编辑"——页面多个"编辑"按钮会误滚到售后模块）
        tab.scroll_to_element("旧描述", offset=400)
        wait(1000)
        r = _find_edit()
        if not r or not r.get("edit"):
            return {"scanned": 0, "found": False, "deleted": False, "why": "old desc btn lost after scroll"}
        e = r["edit"]
    tab.click(e["x"] + e["w"] / 2, e["y"] + e["h"] / 2)
    wait(3000)
    # 点击后滚动页面让旧描述编辑器进入视口（懒渲染：视口外 iframe 不渲染 img），等待渲染再扫描
    tab.eval("window.scrollTo(0, document.body.scrollHeight * 0.55); 'ok'")
    wait(1500)
    scan = tab.eval(JS_SCAN_OLD_DESC_IMGS).get("value") or {}
    # 若编辑器仍在视口外（懒渲染未出图），再滚到 0.75 区域重扫
    if not scan.get("imgs"):
        tab.eval("window.scrollTo(0, document.body.scrollHeight * 0.75); 'ok'")
        wait(1500)
        scan = tab.eval(JS_SCAN_OLD_DESC_IMGS).get("value") or {}
    imgs = scan.get("imgs") or []
    # 统计所有淘金币特征图（旧描述里可能存在多张不同 CDN 变体，如 HVyn/HVym——只删首图不够）
    promo = [i for i in imgs
             if ("tps" in (i.get("src") or "") and "1240-450" in (i.get("src") or ""))
             or "6000000007501" in (i.get("src") or "")
             or "vWMf4v25HV" in (i.get("src") or "")
             or (i.get("nw") == 1240 and i.get("nh") == 450)]
    if not promo:
        return {"scanned": len(imgs), "found": False, "deleted": False,
                "why": "未发现淘金币图", "editors": scan.get("editors")}
    del_r = tab.eval(JS_DELETE_ALL_PROMO).get("value") or {}
    wait(2500)
    # 删除后再次扫描确认剩余淘金币图数量
    scan2 = tab.eval(JS_SCAN_OLD_DESC_IMGS).get("value") or {}
    imgs2 = scan2.get("imgs") or []
    promo2 = [i for i in imgs2
              if ("tps" in (i.get("src") or "") and "1240-450" in (i.get("src") or ""))
              or "6000000007501" in (i.get("src") or "")
              or "vWMf4v25HV" in (i.get("src") or "")
              or (i.get("nw") == 1240 and i.get("nh") == 450)]
    return {"scanned": len(imgs), "found": True, "deleted": bool(del_r.get("ok")),
            "removed_count": del_r.get("removed", 0),
            "remaining_promo": len(promo2),
            "remaining": del_r.get("remaining"),
            "via": "old-desc-all-promo", "why": ""}

def ensure_warehouse(tab: CDPTab) -> bool:
    """销售信息：点击"放入仓库"并验证选中（点击文字本身，验证旁侧 radio）。

    旧版 JS_WAREHOUSE_CHECKED 会误匹配其他 radio（label 为空判定过宽），
    已改为：点击"放入仓库"文字 → 找同 y 最近 radio → 校验 checked。
    """
    tab.click_text("销售信息", 0, 0, 2000, 300)
    wait(1500)
    tab.scroll_to_element("放入仓库", offset=400)
    wait(800)
    el = tab.find_text_fuzzy("放入仓库", 0, 0, 2000, 2000)
    if not el:
        return False
    tab.click(el["x"] + el["w"] / 2, el["y"] + el["h"] / 2)
    wait(1200)
    # 验证：同 y 最近 radio 是否 checked
    r = tab.eval("""(()=>{
      const all=document.querySelectorAll('*');let wh=null;
      for(const e of all){if(e.children.length>0)continue;const t=(e.textContent||'').trim();if(t==='放入仓库'){const r=e.getBoundingClientRect();if(r.width>5)wh={x:r.x,y:r.y};}}
      if(!wh)return null;
      const radios=document.querySelectorAll('input[type=radio]');
      let best=null;
      for(const rd of radios){const rect=rd.getBoundingClientRect();if(Math.abs(rect.y-wh.y)<40){if(!best||Math.abs(rect.x-wh.x)<Math.abs(best.x-wh.x))best={checked:rd.checked,x:rect.x,y:rect.y};}}
      return best;
    })()""").get("value")
    return bool(r and r.get("checked"))


JS_CHECK_SIZE_ORDER = r"""
(() => {
  const out = [];
  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').trim();
    const m = t.match(/^(\d{1,3})(?:cm|\(|（|脚长|鞋长|码)/);
    const r = el.getBoundingClientRect();
    if (m && r.width > 5 && r.height > 5 && r.x > 700 && r.x < 950) out.push({n: parseInt(m[1], 10), y: Math.round(r.y)});
  }
  // 按 DOM 顺序（y 从上到下）取第一组尺码（同颜色第一个出现的一组）
  out.sort((a, b) => a.y - b.y);
  const first = [];
  const seen = new Set();
  for (const it of out) {
    if (seen.has(it.n)) { if (first.length) break; }
    else { seen.add(it.n); first.push(it.n); }
  }
  const sorted = [...first].sort((a, b) => a - b);
  return { order: first, sorted: sorted, ok: first.length > 0 && JSON.stringify(first) === JSON.stringify(sorted) };
})()
"""


def sort_height(tab: CDPTab, edit_url: str, cdp_url: str = "http://127.0.0.1:9222") -> dict:
    """身高排序：调用 crawshrimp-skill 的 tmall_height_sorter（依赖同目录 browser_executor）。

    注意：
    - .user_skills/tmall-height-sorter/scripts 下没有 browser_executor.py，
      直接调那里会 ImportError；crawshrimp-skill/scripts 下两者齐全，以它为准。
    - 传 --tab-id 精确定位编辑页（支持多个 publish 页并存，如批量不提交时
      多行编辑页同时存在供人工检查；url-prefix 多匹配会抛错）。
    - 脚本 --json 模式 returncode 恒为 0，不能作为成功判据；
      须解析 stdout JSON，且最终以流程自行验证页面尺码顺序为准
      （脚本 Step7 的 cm 正则对童鞋尺码格式适配后仍以页面实测兜底）。
    """
    sorter = CRAWSHRIMP / "scripts" / "tmall_height_sorter.py"
    if not sorter.exists():
        sorter = TMAIL_HEIGHT_SORTER
    cmd = [
        sys.executable, str(sorter),
        "--tab-id", tab.tab.get("id", ""),
        "--url-prefix", edit_url.split("?")[0] + "?" + edit_url.split("?")[1],
        "--cdp-url", cdp_url,
        "--json",
    ]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180,
                           encoding="utf-8", cwd=str(CRAWSHRIMP))
        out = (r.stdout or "") + (r.stderr or "")
        # 解析 JSON（--json 输出为多行 indent JSON，取第一个 { 到最后一个 }）
        parsed = {}
        start, end = out.find("{"), out.rfind("}")
        if start != -1 and end > start:
            try:
                parsed = json.loads(out[start:end + 1])
            except Exception:
                parsed = {}
        # 脚本判定：Step1-6 全 ok 视为"排序动作已执行"（Step7 验证仅参考）
        steps = parsed.get("steps", [])
        exec_ok = bool(steps) and all(s.get("ok") for s in steps)
        # 流程自行验证页面顺序（权威）
        verify = {}
        if exec_ok:
            tab.click_text("尺码信息", 0, 0, 2000, 300)
            wait(1500)
            verify = tab.eval(JS_CHECK_SIZE_ORDER).get("value") or {}
        return {"returncode": r.returncode, "exec_ok": exec_ok, "verify_ok": verify.get("ok", False),
                "order": verify.get("order", []), "parsed_success": parsed.get("success", False),
                "parsed_errors": parsed.get("errors", []), "stdout": out[-400:]}
    except Exception as e:
        return {"error": str(e)}


JS_FIND_AUD_TRIGGER = r"""
(() => {
  // 方案A：错误行"必填项适用人群不能为空"定位（首选）
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').trim();
    const r = el.getBoundingClientRect();
    if (t.includes('适用人群') && t.includes('不能为空') && r.x > 300 && r.x < 900 && r.width > 5 && r.height > 5) {
      const errY = r.y;
      for (const sel of document.querySelectorAll('.next-select')) {
        const sr = sel.getBoundingClientRect();
        if (sr.x > 300 && sr.x < 900 && Math.abs(sr.x - r.x) < 60 && sr.y >= errY - 140 && sr.y <= errY - 25) {
          return {x: sr.x, y: sr.y, w: sr.width, h: sr.height};
        }
      }
    }
  }
  // 方案B："适用人群"标签行定位（兜底，布局/错误位置不同时）
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').trim();
    const r = el.getBoundingClientRect();
    if (t === '适用人群' && r.width > 5 && r.height > 5 && r.x > 300 && r.x < 900) {
      for (const sel of document.querySelectorAll('.next-select')) {
        const sr = sel.getBoundingClientRect();
        if (sr.x > 300 && sr.x < 900 && Math.abs(sr.x - r.x) < 60 && sr.y >= r.y - 20 && sr.y <= r.y + 100) {
          return {x: sr.x, y: sr.y, w: sr.width, h: sr.height};
        }
      }
    }
  }
  return null;
})()
"""

JS_FILL_RONGZI = r"""
(() => { const els = document.querySelectorAll('input');
  for (const el of els) { const r = el.getBoundingClientRect();
    if (r.width > 5 && r.height > 5 && r.x > 1150 && r.x < 1550 && r.y > 200 && r.y < 600) {
      const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      s.call(el, '90');
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      el.dispatchEvent(new Event('blur', {bubbles: true}));
      el.blur();
      return {ok: true, id: el.id || ''}; } }
  return {ok: false}; })()
"""


def _select_any(tab: CDPTab, field: str, candidates: tuple = ()) -> bool:
    """修复单个 next-select 必填字段：错误行定位→同列 trigger→展开→容器滚顶→选候选/首选项。"""
    # 1. 错误行"必填项{field}不能为空" → 同列 next-select（x 差<60）
    trig = tab.eval(f"""(()=>{{
      for (const el of document.querySelectorAll('*')) {{
        if (el.children.length > 0) continue;
        const t = (el.textContent || '').trim();
        const r = el.getBoundingClientRect();
        if (t.includes({field!r}) && t.includes('不能为空') && r.x > 200 && r.x < 1200 && r.width > 5 && r.height > 5) {{
          const errY = r.y;
          for (const sel of document.querySelectorAll('.next-select')) {{
            const sr = sel.getBoundingClientRect();
            if (sr.x > 200 && sr.x < 1200 && Math.abs(sr.x - r.x) < 60 && sr.y >= errY - 140 && sr.y <= errY - 25) {{
              return {{x: sr.x, y: sr.y, w: sr.width, h: sr.height}};
            }}
          }}
        }}
      }}
      // 方案B：标签行（错误行不在视口时）
      for (const el of document.querySelectorAll('*')) {{
        if (el.children.length > 0) continue;
        const t = (el.textContent || '').trim();
        const r = el.getBoundingClientRect();
        if (t === {field!r} && r.width > 5 && r.height > 5 && r.x > 200 && r.x < 1200) {{
          for (const sel of document.querySelectorAll('.next-select')) {{
            const sr = sel.getBoundingClientRect();
            if (sr.x > 200 && sr.x < 1200 && Math.abs(sr.x - r.x) < 60 && sr.y >= r.y - 20 && sr.y <= r.y + 100) {{
              return {{x: sr.x, y: sr.y, w: sr.width, h: sr.height}};
            }}
          }}
        }}
      }}
      return null;
    }})()""").get("value")
    if not trig:
        return False
    # 2. elementFromPoint 展开（JS mousedown）
    cx = trig["x"] + trig["w"] / 2
    cy = trig["y"] + trig["h"] / 2
    ok_open = tab.eval(f"""(()=>{{
      const el = document.elementFromPoint({cx}, {cy});
      if (!el) return {{ok: false}};
      let node = el;
      while (node && node !== document.body) {{
        const cls = (node.className || '').toString();
        if (cls.includes('next-select')) break;
        node = node.parentElement;
      }}
      const target = (node && node !== document.body) ? node : el;
      target.dispatchEvent(new MouseEvent('mousedown', {{bubbles: true, cancelable: true, view: window}}));
      target.dispatchEvent(new MouseEvent('mouseup', {{bubbles: true, cancelable: true, view: window}}));
      target.click();
      return {{ok: true}};
    }})()""").get("value") or {}
    if not ok_open.get("ok"):
        return False
    wait(2200)
    # 3. 选项容器滚动到顶（虚拟列表：顶部选项可能未渲染）
    tab.eval("""(()=>{for(const el of document.querySelectorAll('*')){if(el.children.length>0)continue;const t=(el.textContent||'').trim();if(t&&t.length<=6){let p=el.parentElement;while(p&&p!==document.body){if(p.scrollHeight>p.clientHeight+5){p.scrollTop=0;p.dispatchEvent(new Event('scroll',{bubbles:true}));return true;}p=p.parentElement;}}}return false;})()""")
    wait(1000)
    # 4. 候选优先，否则第一个选项（排除"去申请"等辅助项）
    pick = None
    for cand in candidates:
        pick = tab.eval(f"""(()=>{{for(const el of document.querySelectorAll('*')){{if(el.children.length>0)continue;const t=(el.textContent||'').trim();if(t==={cand!r}){{el.scrollIntoView({{block:'center'}});const r=el.getBoundingClientRect();return {{x:r.x,y:r.y,w:r.width,h:r.height,text:t}};}}}}return null;}})()""").get("value")
        if pick:
            break
    if not pick:
        # 首选项兜底：限定 trigger 下方 10-500px 且 x 接近 trigger（防误点标签/错误行）
        pick = tab.eval(f"""(()=>{{let best=null;for(const el of document.querySelectorAll('*')){{if(el.children.length>0)continue;const t=(el.textContent||'').trim();const r=el.getBoundingClientRect();if(t&&t.length<=6&&r.width>5&&r.height>5&&r.x>{trig['x']-150}&&r.x<{trig['x']+150}&&r.y>{trig['y']+10}&&r.y<{trig['y']+500}&&t!=='去申请'){{if(!best||r.y<best.y){{best={{x:r.x,y:r.y,w:r.width,h:r.height,text:t}};}}}}}}return best;}})()""").get("value")
    if not pick:
        return False
    wait(800)
    tab.click(pick["x"] + pick["w"] / 2, pick["y"] + pick["h"] / 2)
    wait(1800)
    return True


def fix_required_fields(tab: CDPTab, errs: str) -> list:
    """补填必填项（适用人群/适用场景/绒子含量等"不能为空"错误）。返回已修复动作列表。"""
    fixed = []
    tab.eval("window.scrollTo(0, 750); 'ok'")
    wait(900)
    if "适用人群" in errs:
        if _select_any(tab, "适用人群", ("儿童", "女童", "男童")):
            fixed.append("适用人群已选")
    if "适用场景" in errs:
        if _select_any(tab, "适用场景", ("通用", "日常", "户外", "运动")):
            fixed.append("适用场景已选")
    # 面料/里料/填充物等多选组件：不做自动选择（用户明确指令），错误记录后跳过该款
    if "绒子含量" in errs:
        # 绒子含量输入框：按"绒子含量"标签行动态关联 input（布局/折叠变化自适应）
        rr = tab.eval("""(()=>{for(const el of document.querySelectorAll('*')){if(el.children.length>0)continue;const t=(el.textContent||'').trim();const r=el.getBoundingClientRect();if(t==='绒子含量'&&r.width>5&&r.height>5){for(const inp of document.querySelectorAll('input')){const ir=inp.getBoundingClientRect();if(ir.width>3&&ir.height>3&&ir.x>=r.x-20&&ir.x<=r.x+420&&Math.abs(ir.y-r.y)<70)return {x:ir.x,y:ir.y,w:ir.width,h:ir.height};}}}return null;})()""").get("value")
        if rr:
            tab.click(rr["x"] + rr["w"] / 2, rr["y"] + rr["h"] / 2)
            wait(500)
            tab.key("Ctrl+A")
            wait(200)
            tab.type_text("90")
            wait(400)
            tab.key("Tab")
            wait(800)
            fixed.append("绒子含量=90")
    return fixed




def submit(tab: CDPTab) -> dict:
    """提交 → 弹窗自动处理 → 验证成功/错误。返回 {ok, errs, success, primaryId, opcode}。"""
    btn = None
    for _ in range(3):
        tab.eval("window.scrollTo(0, document.body.scrollHeight); 'ok'")
        wait(600)
        btn = tab.eval(JS_SUBMIT_BTN).get("value")
        if btn:
            break
    if not btn:
        # 尝试 find_text 兜底
        el = tab.find_text("提交", 400, 880, 600, 990)
        if el:
            btn = {"x": el["x"], "y": el["y"], "w": el["w"], "h": el["h"]}
    if not btn:
        return {"error": "submit btn not found"}
    tab.click(btn["x"] + btn["w"] / 2, btn["y"] + btn["h"] / 2)
    wait(4000)
    # 弹窗自动处理（提交后可能弹出"图文详情编辑器升级"等，循环最多 5 轮）
    dismissed_total = []
    for _ in range(5):
        d = (tab.eval(JS_DISMISS_DIALOGS).get("value") or {}).get("dismissed") or []
        if not d:
            break
        dismissed_total.extend(d)
        wait(2500)
    wait(3000)
    # 错误检测
    errs = tab.eval(JS_PAGE_ERRORS).get("value") or ""
    # 成功检测（success.htm + isSuccess=true，或成功文字）
    chk = tab.eval(JS_CHECK_SUCCESS).get("value") or {}
    # 提交后无响应（无错误文案且未跳转成功页）：首次点击可能被弹窗/校验遮挡，重试点击提交（最多2次）
    if not errs and not chk.get("success"):
        for _ in range(2):
            wait(1500)
            tab.eval("window.scrollTo(0, document.body.scrollHeight); 'ok'")
            wait(600)
            btn2 = tab.eval(JS_SUBMIT_BTN).get("value")
            if not btn2:
                break
            tab.click(btn2["x"] + btn2["w"] / 2, btn2["y"] + btn2["h"] / 2)
            wait(4000)
            for _ in range(3):
                d = (tab.eval(JS_DISMISS_DIALOGS).get("value") or {}).get("dismissed") or []
                if not d:
                    break
                dismissed_total.extend(d)
                wait(2500)
            wait(2500)
            errs = tab.eval(JS_PAGE_ERRORS).get("value") or ""
            chk = tab.eval(JS_CHECK_SUCCESS).get("value") or {}
            if errs or chk.get("success"):
                break
    ok = bool(chk.get("success")) and not errs
    return {
        "ok": ok,
        "errs": errs,
        "success": chk.get("via", ""),
        "primaryId": chk.get("primaryId", ""),
        "opcode": "",
        "dialogs": dismissed_total,
    }


def extract_new_id(tab: CDPTab) -> str:
    """从成功页面 URL 提取新商品ID（success.htm?primaryId=<新ID>，已实测确认）。"""
    js = r"""(() => { const m = location.href.match(/[?&]primaryId=(\d+)/); return m ? m[1] : ''; })()"""
    return tab.eval(js).get("value") or ""


# ---------- 主流程 ----------

def retry_same_item(edit_tab: CDPTab, ctx: dict, huohao: str, cdp_url: str = "http://127.0.0.1:9222", max_rounds: int = 3) -> dict:
    """同类宝贝达到[5]个重试：切类目(货号-N) → 重走图文描述/淘金币清理/仓库/排序 → 重提。

    2026-10-12 用户指示：切类目后仍报同类宝贝5个时，货号 N 递增（-1→-2→-3 依此类推），
    最多 max_rounds 轮；每轮仍同类宝贝则 N+1 继续，其他错误/提交成功则立即返回。
    """
    ctx["seq_map"][huohao] = ctx["seq_map"].get(huohao, 0) + 1
    last_err = ""
    for i in range(max_rounds):
        seq = ctx["seq_map"][huohao]
        sw = switch_category(edit_tab, ctx["brand"], huohao, seq)
        if not sw.get("ok"):
            return {"ok": False, "error": f"switch failed {huohao}-{seq}: {sw.get('error', '')}", "seq": seq}
        stats2 = goto_desc_old_mode(edit_tab)
        clean_old_desc_promo(edit_tab, via=stats2.get("via", ""))  # 切类目后旧描述淘金币图清理（ERR-006）
        ensure_warehouse(edit_tab)
        sort_height(edit_tab, edit_tab.url, cdp_url)
        sr = submit(edit_tab)
        if sr.get("ok"):
            return {"ok": True, "new_id": sr.get("primaryId") or extract_new_id(edit_tab), "seq": seq}
        last_err = sr.get("errs", "")
        if "同类宝贝" not in last_err:
            return {"ok": False, "error": f"resubmit still failed: {last_err}", "seq": seq}
        # 仍报同类宝贝5个：下一轮 N+1 再切一次类目
        ctx["seq_map"][huohao] += 1
    return {"ok": False, "error": f"same-item after {max_rounds} rounds: {last_err}", "seq": seq}


def process_row(tab_onsale: CDPTab, row: dict, ctx: dict) -> dict:
    """处理一行（一个原ID）。ctx: {brand, seq_map, pre_switch_set, learned_set, dry_run, yes}"""
    origin_id = row["origin_id"]
    huohao = row["huohao"]
    log = []
    result = {"excel_row": row.get("excel_row"), "origin_id": origin_id, "huohao": huohao,
              "status": "pending", "new_id": "", "steps": []}

    def step(name, ok, extra=None):
        log.append({"name": name, "ok": ok, **({"extra": extra} if extra else {})})

    # 1. 关SKU弹窗（必须先关，否则遮挡搜索框/更多按钮）
    close_sku_popup(tab_onsale)
    step("close_sku", True)

    # 2. 搜索原ID（出售中页签；失败自动切"全部"重搜——黑名单商品可能不在出售中列表）
    ok = search_origin_id(tab_onsale, origin_id, "出售中")
    if not ok:
        ensure_tab(tab_onsale, "全部")
        ok = search_origin_id(tab_onsale, origin_id, "全部")
    step("search_origin", ok, extra="(fallback 全部)" if not ok and ok else None)
    if not ok:
        result.update(status="failed", error="search not found")
        return result

    # 3. 发布相似品
    try:
        edit_tab = open_similar_publish(tab_onsale, origin_id, ctx.get("cdp_url", "http://127.0.0.1:9222"))
        step("open_similar", True, extra=edit_tab.url[:120])
        # 3.5 关闭编辑页弹窗（"商品属性信息更新"→取消；不处理会遮挡身高排序等后续操作）
        d = (edit_tab.eval(JS_DISMISS_DIALOGS).get("value") or {}).get("dismissed") or []
        if d:
            wait(2000)
            step("dismiss_edit_dialogs", True, extra=d)
    except RuntimeError as e:
        step("open_similar", False, extra=str(e))
        result.update(status="failed", error=str(e))
        return result

    # 4. 同类宝贝预判：该货号是否需预切类目
    need_pre_switch = huohao in ctx["pre_switch_set"] or huohao in ctx["learned_set"]
    if need_pre_switch:
        ctx["seq_map"][huohao] = ctx["seq_map"].get(huohao, 0) + 1
        seq = ctx["seq_map"][huohao]
        if not ctx["dry_run"]:
            sw = switch_category(edit_tab, ctx["brand"], huohao, seq)
            step("pre_switch_category", sw.get("ok"), extra=f"{huohao}-{seq} | {sw.get('error', '')}")
            if not sw.get("ok"):
                edit_tab.close()
                result.update(status="failed", error="pre-switch category failed")
                return result
        else:
            step("pre_switch_category", True, extra=f"(dry-run) {huohao}-{seq}")

    # 5. 图文描述（旧版文本编辑）
    if not ctx["dry_run"]:
        stats = goto_desc_old_mode(edit_tab)
        step("desc_old_mode", stats.get("imgs", 0) > 0, extra=stats)
        if stats.get("imgs", 0) <= 0:
            # 可能已在文本模式，仅记录
            pass
        # 5a. 旧描述模块淘金币促销图清理（2026-09-29 生产实测；命中即删，未命中跳过）
        promo = clean_old_desc_promo(edit_tab, via=stats.get("via", ""))
        step("clean_old_desc_promo", (not promo.get("found")) or promo.get("deleted"),
             extra={k: v for k, v in promo.items() if k in ("found", "deleted", "remaining", "why")})

    # 6. 销售信息（放入仓库）
    if not ctx["dry_run"]:
        ok_wh = ensure_warehouse(edit_tab)
        step("warehouse", ok_wh)

    # 7. 身高排序（调 tmall-height-sorter；判定=流程自行验证页面顺序）
    if not ctx["dry_run"]:
        sort_r = sort_height(edit_tab, edit_tab.url, ctx.get("cdp_url", "http://127.0.0.1:9222"))
        sort_ok = bool(sort_r.get("verify_ok")) or (bool(sort_r.get("exec_ok")) and not sort_r.get("parsed_errors"))
        step("height_sort", sort_ok, extra={"exec": sort_r.get("exec_ok"), "verify": sort_r.get("verify_ok"),
                                            "order": sort_r.get("order", []),
                                            "errs": sort_r.get("parsed_errors", [])[:2]})

    # 8. 提交（需授权）
    if ctx["dry_run"]:
        step("submit", True, extra="(dry-run 跳过)")
        result.update(status="dry_run_plan", steps=log)
        return result
    if not ctx["yes"]:
        step("submit", False, extra="(未授权 --yes，跳过提交)")
        result.update(status="needs_authorization", steps=log)
        return result

    submit_r = submit(edit_tab)
    step("submit", submit_r.get("ok", False), extra={k: v for k, v in submit_r.items() if k in ("errs", "success", "opcode", "primaryId")})

    # 9. 错误学习库处理
    if submit_r.get("ok"):
        new_id = submit_r.get("primaryId") or extract_new_id(edit_tab)
        result.update(status="success", new_id=new_id, steps=log)
        return result

    err_text = submit_r.get("errs", "")

    # 旺铺PC详情错误：优先走 ERR-002 文本编辑重走（勿被"必填项缺失"分支拦截——fix_required 不处理旺铺）
    if "旺铺" in err_text:
        goto_desc_old_mode(edit_tab)
        submit_r2 = submit(edit_tab)
        step("resubmit_after_text", submit_r2.get("ok", False),
             extra={k: v for k, v in submit_r2.items() if k in ("errs", "success", "primaryId")})
        if submit_r2.get("ok"):
            new_id2 = submit_r2.get("primaryId") or extract_new_id(edit_tab)
            result.update(status="success", new_id=new_id2, steps=log)
            return result
        err_text = submit_r2.get("errs", "")
        if "不能为空" not in err_text and "必填项缺失" not in err_text and "旺铺" not in err_text:
            result.update(status="failed", error=f"resubmit still failed: {err_text}", steps=log)
            return result
        # 仍含必填项错误：继续走下文的 required-fix 分支

    # 必填项缺失（"不能为空"/"必填项缺失"）：用户要求不自动补填，记录错误直接跳过该款
    if "不能为空" in err_text or "必填项缺失" in err_text:
        step("skip_required_fix", False, extra=err_text[:120])
        result.update(status="failed", error=f"必填项缺失跳过: {err_text[:100]}", steps=log)
        return result
    # 同类宝贝5个：切类目(货号-N，N 递增直到成功) 重走
    if "同类宝贝" in err_text:
        ctx["learned_set"].add(huohao)
        rsi = retry_same_item(edit_tab, ctx, huohao, ctx.get("cdp_url", "http://127.0.0.1:9222"))
        step("retry_switch_category", rsi.get("ok"), extra=f"{huohao}-{rsi.get('seq', '?')} | {rsi.get('error', '')}")
        if rsi.get("ok"):
            result.update(status="success", new_id=rsi.get("new_id"), steps=log)
            return result
        result.update(status="failed", error=rsi.get("error", "same-item retry failed"), steps=log)
        return result

    entry = error_knowledge.match(err_text)
    if entry:
        result["matched_error"] = entry["signature"]
        if "同类宝贝" in entry["signature"] or "同类宝贝" in err_text:
            # ERR-001：切类目重走（货号-N，N 递增）
            ctx["learned_set"].add(huohao)
            rsi = retry_same_item(edit_tab, ctx, huohao, ctx.get("cdp_url", "http://127.0.0.1:9222"))
            step("retry_switch_category", rsi.get("ok"), extra=f"{huohao}-{rsi.get('seq', '?')} | {rsi.get('error', '')}")
            if rsi.get("ok"):
                result.update(status="success", new_id=rsi.get("new_id"), steps=log)
                return result
            result.update(status="failed", error=rsi.get("error", "same-item retry failed"), steps=log)
            return result
        if "旺铺" in entry["signature"]:
            # ERR-002：切文本编辑重走（先清理旧描述淘金币图 ERR-006）
            stats3 = goto_desc_old_mode(edit_tab)
            clean_old_desc_promo(edit_tab, via=stats3.get("via", ""))
            submit_r2 = submit(edit_tab)
            step("resubmit_after_text", submit_r2.get("ok", False))
            if submit_r2.get("ok"):
                new_id2 = submit_r2.get("primaryId") or extract_new_id(edit_tab)
                result.update(status="success", new_id=new_id2, steps=log)
                return result
            result.update(status="failed", error=f"resubmit still failed: {submit_r2.get('errs')}", steps=log)
            return result
        # 其他已知错误：应用方案后重试一次
        result.update(status="failed", error=f"known error applied but failed: {err_text}", steps=log)
        return result

    # 未知错误：记录到学习库，暂停等待人工
    unknown = error_knowledge.new_unknown_entry(err_text or "提交失败但无匹配错误", submit_r.get("opcode", ""))
    error_knowledge.record(err_text or "unknown", unknown)
    result.update(status="unknown_error_recorded", error=err_text, steps=log)
    return result


def load_excel(path: str, start_row: int, end_row: int) -> tuple[list[dict], object]:
    import openpyxl
    wb = openpyxl.load_workbook(path)
    ws = wb["Sheet1"] if "Sheet1" in wb.sheetnames else wb.worksheets[0]
    rows = []
    for i, row in enumerate(ws.iter_rows(min_row=2, max_row=min(end_row, ws.max_row), values_only=True), start=2):
        if i < start_row:
            continue
        origin_id = str(row[0]).strip() if row[0] else ""
        huohao = str(row[4]).strip() if len(row) > 4 and row[4] else ""
        if not origin_id or origin_id == "None":
            continue
        rows.append({"excel_row": i, "origin_id": origin_id, "huohao": huohao,
                     "product_line": str(row[5]) if len(row) > 5 and row[5] else "",
                     "feedback": str(row[9]) if len(row) > 9 and row[9] else ""})
    return rows, wb


def build_pre_switch_set(rows: list[dict]) -> set:
    """表内货号频次 >= 5 的货号预切类目。"""
    from collections import Counter
    cnt = Counter(r["huohao"] for r in rows if r["huohao"])
    return {h for h, c in cnt.items() if c >= 5}


def write_back(wb, path: str, results: list[dict]):
    """回填 B 列（新建id）与 D 列（新建备注/状态）。写前自动备份。"""
    import shutil
    bak = Path(path).with_suffix(".bak.xlsx")
    try:
        shutil.copy2(path, bak)
    except Exception:
        pass
    ws = wb["Sheet1"] if "Sheet1" in wb.sheetnames else wb.worksheets[0]
    changed = 0
    for r in results:
        row_idx = r["excel_row"]
        status = r["status"]
        if status == "success":
            new_id = r.get("new_id") or ""
            ws.cell(row=row_idx, column=2).value = new_id if new_id else "已提交待补ID"
            ws.cell(row=row_idx, column=4).value = f"已发布 {datetime.now().strftime('%m-%d %H:%M')}"
        elif status == "failed":
            ws.cell(row=row_idx, column=4).value = f"失败: {r.get('error', '')[:40]}"
        elif status == "unknown_error_recorded":
            ws.cell(row=row_idx, column=4).value = f"未知错误待处理: {r.get('error', '')[:30]}"
        elif status == "needs_authorization":
            ws.cell(row=row_idx, column=4).value = "待授权提交"
        changed += 1
    wb.save(path)
    return changed


def close_processed_tabs(cdp_url: str, keep_url_kw: str = "myseller.taobao.com"):
    """关闭本行处理留下的所有 publish/success 页（只保留在售页）。

    符合用户要求"新建完一个关闭一个页面"：每行提交完提取新ID后立即关闭，
    页面不堆积，也避免后续行多标签页干扰。
    """
    import urllib.request
    for t in list_tabs(cdp_url):
        url = t.get("url", "")
        if "sell.publish.tmall.com" in url:
            try:
                urllib.request.urlopen(f"{cdp_url}/json/close/{t['id']}", timeout=5)
                print(f"  [close] 已关闭 {t['id'][:8]} ({'success' if 'success.htm' in url else 'publish'})")
            except Exception as e:
                print(f"  [warn] 关闭 {t['id'][:8]} 失败: {e}")
    wait(1200)


def main():
    ap = argparse.ArgumentParser(description="克隆ID发布主流程")
    ap.add_argument("--excel", required=True, help="Excel 路径")
    ap.add_argument("--brand", default="巴拉巴拉")
    ap.add_argument("--start-row", type=int, default=2)
    ap.add_argument("--end-row", type=int, default=182)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--yes", action="store_true", help="授权提交动作")
    ap.add_argument("--cdp-url", default="http://127.0.0.1:9222", help="CDP 地址（新开实例用如 http://127.0.0.1:9223）")
    ap.add_argument("--report", default="", help="运行报告输出路径（JSON）")
    args = ap.parse_args()

    rows, wb = load_excel(args.excel, args.start_row, args.end_row)
    print(f"[load] {len(rows)} rows from Excel (row {args.start_row}-{args.end_row})")

    pre_switch_set = build_pre_switch_set(rows)
    print(f"[pre-switch] 表内货号频次>=5 预切类目集合: {sorted(pre_switch_set) or '无'}")

    ctx = {
        "brand": args.brand,
        "seq_map": {},
        "pre_switch_set": pre_switch_set,
        "learned_set": set(),
        "dry_run": args.dry_run,
        "yes": args.yes,
        "cdp_url": args.cdp_url,
    }

    # 定位在售页
    try:
        tab_onsale = open_onsale_tab(args.cdp_url)
        print(f"[tab] 在售页: {tab_onsale.url[:100]}")
    except RuntimeError as e:
        print(f"[fatal] 找不到在售页标签: {e}")
        sys.exit(1)

    results = []
    for row in rows:
        print(f"\n=== {row['origin_id']} (货号 {row['huohao']}, Excel行{row['excel_row']}) ===")
        try:
            r = process_row(tab_onsale, row, ctx)
        except Exception as e:
            r = {"origin_id": row["origin_id"], "huohao": row["huohao"], "status": "exception",
                 "error": str(e)[:200], "excel_row": row["excel_row"]}
        results.append(r)
        print(f"    -> {r['status']}" + (f" | {r.get('error', '')[:80]}" if r.get("error") else ""))
        for s in r.get("steps", []):
            flag = "OK " if s["ok"] else "XX "
            print(f"      {flag}{s['name']}" + (f" | {str(s.get('extra', ''))[:100]}" if s.get("extra") else ""))
        # 每行处理完关闭 publish/success 页（只保留在售页），继续下一行
        close_processed_tabs(args.cdp_url)

    summary = {"total": len(results),
               "success": sum(1 for r in results if r["status"] == "success"),
               "failed": sum(1 for r in results if r["status"] in ("failed", "exception")),
               "unknown": sum(1 for r in results if r["status"] == "unknown_error_recorded"),
               "skipped": sum(1 for r in results if r["status"] in ("dry_run_plan", "needs_authorization"))}
    print(f"[summary] {json.dumps(summary, ensure_ascii=False)}")

    # 报告先落盘（含 new_id），write_back 失败也不丢新ID
    if args.report:
        Path(args.report).write_text(json.dumps({"summary": summary, "results": results}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[report] {args.report}")

    # 回填（失败仅告警，不中断）
    if not args.dry_run and args.yes:
        try:
            changed = write_back(wb, args.excel, results)
            print(f"\n[write-back] 已更新 {changed} 行到 {args.excel}")
        except PermissionError:
            print(f"\n[write-back] 失败：{args.excel} 被占用或无写入权限（沙箱外需授权）——新ID已保存在报告，稍后单独回填")
        except Exception as e:
            print(f"\n[write-back] 失败：{type(e).__name__}: {e}——新ID已保存在报告，稍后单独回填")
    else:
        print("\n[write-back] 跳过（dry-run 或未授权提交时不同步回填）")


if __name__ == "__main__":
    main()
