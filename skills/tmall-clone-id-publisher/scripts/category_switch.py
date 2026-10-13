#!/usr/bin/env python3
"""切换类目模块：规避"同类宝贝达到[5]个"报错 / 批量类目迁移

已验证流程（2026-10-09 生产实测，参考 tmall-category-switch 方案交互顺序）：
  1. 编辑页点"切换类目"按钮 → 弹窗
  2. （可选）点三级类目选项（如"羽绒马甲"；克隆场景下类目已预选可跳过）
  3. 品牌：点"请选择"combobox → CDP 真实键盘 type_text"巴拉巴拉" → 点下拉叶子 DIV 选项
     （关键：不用 JS setter 注入，React 不认；真实键盘事件 + 点选项本体才解锁确定按钮）
  4. 货号：品牌选中后货号字段才渲染 → 找 placeholder='请输入' 的 input → click → Ctrl+A → type"<货号>-N" → Tab
     （关键：不能按 y 范围盲找，会误中卖点/标题输入框）
  5. 点弹窗底部"确定"（disabled=False 后）→ 二次确认弹窗点"确定"
  6. 验证：URL catId + 当前类目文本 + 货号 input 值

用法：
  python category_switch.py --tab-id 190E207B --brand 巴拉巴拉 --huohao-base 202426101201 --seq 1 [--level3 羽绒马甲] [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from cdp_bridge import CDPTab  # noqa: E402


def wait(ms: int):
    time.sleep(ms / 1000)


JS_DIALOG_OPEN = r"""
(() => {
  const all = document.querySelectorAll('*');
  for (const el of all) {
    if (el.children.length > 0) continue;
    const t = (el.textContent || '').trim();
    if (t === '选择类目' && el.getBoundingClientRect().width > 5) return true;
  }
  return false;
})()
"""

JS_CONFIRM_BTN = r"""
(() => {
  for (const b of document.querySelectorAll('button')) {
    const t = (b.textContent || '').trim();
    const r = b.getBoundingClientRect();
    if (t === '确定' && r.width > 20 && r.y > 600 && r.y < 900) {
      return { x: r.x + r.width/2, y: r.y + r.height/2, disabled: b.disabled };
    }
  }
  return null;
})()
"""

JS_HUOHAO_INPUT = r"""
(() => {
  for (const i of document.querySelectorAll('input')) {
    const r = i.getBoundingClientRect();
    if (i.placeholder === '请输入' && r.width > 50 && r.y > 350 && r.y < 700 && i.offsetParent !== null) {
      return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height, value: i.value };
    }
  }
  return null;
})()
"""


def open_dialog(tab: CDPTab, wait_ms: int = 1500) -> bool:
    """点"切换类目"按钮打开弹窗。"""
    if tab.eval(JS_DIALOG_OPEN).get("value"):
        return True
    r = tab.eval("""(() => {
      for (const el of document.querySelectorAll('span,a,button,div')) {
        if (el.children.length>0) continue;
        if ((el.textContent||'').trim()==='切换类目') {
          const r=el.getBoundingClientRect();
          if (r.width>5) return {x:r.x+r.width/2, y:r.y+r.height/2};
        }
      } return null;
    })()""").get("value")
    if not r:
        return False
    tab.click(r["x"], r["y"])
    wait(wait_ms)
    return bool(tab.eval(JS_DIALOG_OPEN).get("value"))


def select_level3(tab: CDPTab, level3_name: str, wait_ms: int = 800) -> bool:
    """点三级类目选项（如"羽绒马甲"）。克隆场景下类目已预选可跳过。"""
    r = tab.eval(f"""(() => {{
      const cands=[];
      for (const el of document.querySelectorAll('li,div,span,a')) {{
        const t=(el.textContent||'').trim();
        if (t==={level3_name!r}) {{
          const r=el.getBoundingClientRect();
          if (r.width>5 && r.height>5 && r.y>0 && r.y<700) cands.push({{tag:el.tagName, kids:el.children.length, x:r.x+r.width/2, y:r.y+r.height/2}});
        }}
      }}
      cands.sort((a,b)=>a.kids-b.kids);
      return cands[0]||null;
    }})()""").get("value")
    if not r:
        return False
    tab.click(r["x"], r["y"])
    wait(wait_ms)
    return True


def set_brand(tab: CDPTab, brand: str, wait_ms: int = 800) -> bool:
    """选品牌：点"请选择"combobox → 真实键盘输入 → 点下拉叶子 DIV 选项。"""
    r = tab.eval("""(() => {
      for (const el of document.querySelectorAll('*')) {
        if (el.children.length>0) continue;
        if ((el.textContent||'').trim()==='请选择') {
          const r=el.getBoundingClientRect();
          if (r.width>10 && r.y>300 && r.y<900) return {x:r.x+r.width/2, y:r.y+r.height/2};
        }
      } return null;
    })()""").get("value")
    if not r:
        raise RuntimeError("brand combobox '请选择' not found")
    tab.click(r["x"], r["y"])
    wait(800)

    # 真实键盘输入品牌名（搜索框自动聚焦）
    tab.type_text(brand)
    wait(1200)

    # 点下拉叶子 DIV 选项（kids=0 优先）
    opt = tab.eval(f"""(() => {{
      const cands=[];
      for (const el of document.querySelectorAll('*')) {{
        const t=(el.textContent||'').trim();
        if (t==={brand!r}) {{
          const r=el.getBoundingClientRect();
          if (r.width>5 && r.height>5 && r.y>0 && r.y<900 && el.tagName!=='INPUT' && el.tagName!=='BODY') {{
            cands.push({{tag:el.tagName, kids:el.children.length, x:r.x+r.width/2, y:r.y+r.height/2}});
          }}
        }}
      }}
      cands.sort((a,b)=>a.kids-b.kids);
      return cands[0]||null;
    }})()""").get("value")
    if not opt:
        raise RuntimeError(f"brand option '{brand}' not found in dropdown")
    tab.click(opt["x"], opt["y"])
    wait(wait_ms + 500)

    shown = tab.eval(f"""(() => {{
      for (const el of document.querySelectorAll('*')) {{
        if (el.children.length>0) continue;
        if ((el.textContent||'').trim()==={brand!r}) {{
          const r=el.getBoundingClientRect();
          if (r.width>5 && r.y>300 && r.y<500) return true;
        }}
      }} return false;
    }})()""").get("value")
    return bool(shown)


def set_huohao(tab: CDPTab, huohao: str, wait_ms: int = 800) -> bool:
    """填货号：找 placeholder='请输入' 的 input → click → Ctrl+A → type → Tab。"""
    wait(500)  # 品牌选中后货号字段才渲染
    loc = tab.eval(JS_HUOHAO_INPUT).get("value")
    if not loc:
        raise RuntimeError("huohao input (placeholder='请输入') not found — 品牌是否选中？")
    tab.click(loc["x"], loc["y"])
    wait(500)
    tab.key("Ctrl+A")
    wait(200)
    tab.type_text(huohao)
    wait(400)
    tab.key("Tab")
    wait(wait_ms)
    v = tab.eval(JS_HUOHAO_INPUT).get("value") or {}
    return v.get("value", "").strip() == huohao


def confirm(tab: CDPTab, wait_ms: int = 2000) -> bool:
    """点弹窗底部"确定" → 二次确认弹窗"确定"。"""
    btn = tab.eval(JS_CONFIRM_BTN).get("value")
    if not btn:
        raise RuntimeError("confirm btn not found")
    if btn.get("disabled"):
        raise RuntimeError(f"confirm btn still disabled: {btn}")
    tab.click(btn["x"], btn["y"])
    wait(2000)

    second = tab.eval("""(() => {
      for (const b of document.querySelectorAll('button')) {
        const t = (b.textContent||'').trim();
        const r = b.getBoundingClientRect();
        if ((t==='确定'||t==='确认') && r.width>20 && r.y>0 && r.y<900) {
          return {x:r.x+r.width/2, y:r.y+r.height/2};
        }
      } return null;
    })()""").get("value")
    if second:
        tab.click(second["x"], second["y"])
        wait(3000)
    return True


def verify_switch(tab: CDPTab, huohao: str, level3: str = None) -> dict:
    """验证切换结果：URL catId + 当前类目文本 + 货号 input 值。"""
    wait(2000)
    return tab.eval(f"""(() => {{
      const b=document.body.innerText||'';
      let huohao_in='';
      for (const i of document.querySelectorAll('input')) {{
        if (i.value && i.value.includes({huohao.split('-')[0]!r})) {{ huohao_in=i.value; break; }}
      }}
      return {{
        url_catId: (location.href.match(/catId=(\\d+)/)||[])[1]||'',
        huohao_in_input: huohao_in,
        current_cat: (b.match(/当前类目[\\s\\S]{{0,80}}/)||[''])[0].slice(0,120),
        dialog_still_open: b.includes('选择类目')
      }};
    }})()""").get("value") or {}


def switch_category(tab: CDPTab, brand: str, huohao_base: str, seq: int,
                    level3: str = None, dry_run: bool = False, wait_ms: int = 800) -> dict:
    """完整切类目流程。返回步骤结果字典。"""
    huohao = f"{huohao_base}-{seq}" if seq > 0 else huohao_base
    steps = {}
    steps["open_dialog"] = open_dialog(tab, wait_ms)
    if not steps["open_dialog"]:
        return {"ok": False, "error": "切类目弹窗未打开", "steps": steps}
    if dry_run:
        return {"ok": True, "dry_run": True, "huohao": huohao, "steps": steps}
    try:
        if level3:
            steps["level3"] = select_level3(tab, level3, wait_ms)
    except Exception as e:
        steps["level3_error"] = str(e)
    try:
        steps["brand"] = set_brand(tab, brand, wait_ms)
    except Exception as e:
        return {"ok": False, "error": f"brand: {e}", "huohao": huohao, "steps": steps}
    try:
        steps["huohao"] = set_huohao(tab, huohao, wait_ms)
    except Exception as e:
        return {"ok": False, "error": f"huohao: {e}", "huohao": huohao, "steps": steps}
    try:
        steps["confirm"] = confirm(tab, wait_ms)
    except Exception as e:
        return {"ok": False, "error": f"confirm: {e}", "huohao": huohao, "steps": steps}
    steps["verify"] = verify_switch(tab, huohao, level3)
    ok = steps["verify"].get("huohao_in_input", "") == huohao and not steps["verify"].get("dialog_still_open")
    return {"ok": ok, "huohao": huohao, "steps": steps}


def main():
    ap = argparse.ArgumentParser(description="切换类目模块")
    ap.add_argument("--tab-id", required=True)
    ap.add_argument("--brand", default="巴拉巴拉")
    ap.add_argument("--huohao-base", required=True)
    ap.add_argument("--seq", type=int, default=1)
    ap.add_argument("--level3", default=None, help="三级类目名（如 羽绒马甲；克隆场景可省略）")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--cdp-url", default="http://127.0.0.1:9222")
    args = ap.parse_args()

    tab = CDPTab(tab_id_prefix=args.tab_id, cdp_url=args.cdp_url)
    result = switch_category(tab, args.brand, args.huohao_base, args.seq,
                             level3=args.level3, dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
