#!/usr/bin/env python3
"""
天猫发布页面 - 身高/尺码模块通用排序工具

功能：自动对销售属性中的"身高"模块按从小到大顺序排序
用法：python tmall_height_sorter.py --url-prefix "https://sell.publish.tmall.com/tmall/publish.htm?id=123456"

原理：
1. 点击身高模块的"排序"按钮打开弹窗
2. 通过 React Fiber 找到排序组件的 onChange 函数
3. 读取 dataSource，按身高数字自动排序
4. 调用 onChange 更新排序
5. 点击"确认排序"按钮
6. 验证结果
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# 确保可以导入 scripts 目录下的模块
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

from browser_executor import ChromeCDPBackend, BrowserAction


# ============ JavaScript 代码片段 ============

# 点击身高排序按钮
JS_CLICK_HEIGHT_SORT = r"""
(function() {
    const btn = document.querySelector('.sell-size-sale-props .sort-btn');
    if (!btn) return { ok: false, error: 'height sort button not found' };
    btn.click();
    return { ok: true, evidence: 'clicked' };
})();
"""

# 获取当前排序组件的 value 和 dataSource
JS_GET_SORT_DATA = r"""
(function() {
    const sortArea = document.querySelector('.sort-area');
    if (!sortArea) return { ok: false, error: 'sort-area not found' };

    const keys = Object.keys(sortArea);
    const fiberKey = keys.find(k => k.startsWith('__reactInternalInstance'));
    if (!fiberKey) return { ok: false, error: 'no react fiber key found' };

    const fiber = sortArea[fiberKey];
    let current = fiber;

    for (let i = 0; i < 20 && current; i++) {
        const props = current.memoizedProps;
        if (props && typeof props.onChange === 'function' && props.dataSource) {
            return {
                ok: true,
                depth: i,
                currentValue: props.value,
                dataSource: props.dataSource
            };
        }
        current = current.return;
    }

    return { ok: false, error: 'sort component not found' };
})();
"""

# 通过 onChange 设置排序
JS_SET_SORT_ORDER_TEMPLATE = r"""
(function() {
    const sortArea = document.querySelector('.sort-area');
    if (!sortArea) return { ok: false, error: 'sort-area not found' };

    const keys = Object.keys(sortArea);
    const fiberKey = keys.find(k => k.startsWith('__reactInternalInstance'));
    const fiber = sortArea[fiberKey];

    let current = fiber;
    for (let i = 0; i < 20 && current; i++) {
        const props = current.memoizedProps;
        if (props && typeof props.onChange === 'function' && props.dataSource) {
            const sortedValue = __SORTED_VALUE__;
            props.onChange(sortedValue);
            return {
                ok: true,
                newOrder: sortedValue.map(v => v.text)
            };
        }
        current = current.return;
    }

    return { ok: false, error: 'sort component not found' };
})();
"""

# 验证弹窗中的顺序
JS_VERIFY_DIALOG_ORDER = r"""
(function() {
    const sortArea = document.querySelector('.sort-area');
    if (!sortArea) return { ok: false, error: 'sort-area not found' };
    const items = sortArea.querySelectorAll('.sell-sort-item');
    const order = Array.from(items).map(item => item.textContent.trim());
    return { ok: true, order: order };
})();
"""

# 点击确认排序按钮
JS_CLICK_CONFIRM = r"""
(function() {
    const btn = document.querySelector('.footer-confirm');
    if (!btn) return { ok: false, error: 'confirm button not found' };
    btn.click();
    return { ok: true, evidence: 'confirmed' };
})();
"""

# 验证页面最终的身高顺序
JS_VERIFY_FINAL_ORDER = r"""
(function() {
    const bodyText = document.body.innerText;
    const saleStart = bodyText.indexOf('销售属性');
    const saleEnd = bodyText.indexOf('一口价');
    if (saleStart === -1 || saleEnd === -1) {
        return { ok: false, error: 'sale section not found' };
    }
    const saleSection = bodyText.substring(saleStart, saleEnd);
    const cmRegex = /(\d{2,3})cm/g;
    const matches = saleSection.match(cmRegex) || [];
    const uniqueCm = [];
    const seen = new Set();
    matches.forEach(m => {
        if (!seen.has(m)) {
            seen.add(m);
            uniqueCm.push(m);
        }
    });
    return { ok: true, heightOrder: uniqueCm };
})();
"""


# ============ 工具函数 ============

def extract_height_number(text: str) -> int:
    """从 '140cm' 这样的文本中提取数字 140"""
    import re
    match = re.search(r'(\d+)', text)
    return int(match.group(1)) if match else 9999


def sort_heights(data_source: list[dict]) -> list[dict]:
    """按身高数字从小到大排序"""
    return sorted(data_source, key=lambda item: extract_height_number(item.get('text', '')))


# ============ 主流程 ============

def run_height_sort(cdp_url: str, url_prefix: str, wait_ms: int = 500) -> dict:
    """
    执行身高排序完整流程

    Args:
        cdp_url: CDP 浏览器地址，默认 http://127.0.0.1:9222
        url_prefix: 页面 URL 前缀，用于定位标签页
        wait_ms: 每步之间的等待时间（毫秒）

    Returns:
        执行结果字典
    """
    backend = ChromeCDPBackend(cdp_url=cdp_url, url_prefix=url_prefix)
    result = {
        'success': False,
        'steps': [],
        'originalOrder': [],
        'finalOrder': [],
        'errors': []
    }

    try:
        # Step 1: 点击身高排序按钮
        print("[Step 1] 点击身高模块的排序按钮...")
        action = BrowserAction(kind='eval', script=JS_CLICK_HEIGHT_SORT)
        resp = backend.execute(action)
        if not resp.ok:
            result['errors'].append(f"点击排序按钮失败: {resp.error}")
            return result
        result['steps'].append({'step': 1, 'action': 'click_sort_button', 'ok': True})
        time.sleep(wait_ms / 1000)

        # Step 2: 获取当前排序数据
        print("[Step 2] 获取当前排序组件数据...")
        action = BrowserAction(kind='eval', script=JS_GET_SORT_DATA)
        resp = backend.execute(action)
        if not resp.ok:
            result['errors'].append(f"获取排序数据失败: {resp.error}")
            return result

        data = resp.data.get('value', {})
        if isinstance(data, str):
            data = json.loads(data)

        current_value = data.get('currentValue', [])
        data_source = data.get('dataSource', [])

        result['originalOrder'] = [item.get('text', '') for item in current_value]
        print(f"  原始顺序: {result['originalOrder']}")

        # Step 3: 自动排序
        print("[Step 3] 自动按身高从小到大排序...")
        sorted_value = sort_heights(data_source)
        sorted_texts = [item.get('text', '') for item in sorted_value]
        print(f"  排序后: {sorted_texts}")

        # 检查是否已经是正确顺序
        if result['originalOrder'] == sorted_texts:
            print("  顺序已经是正确的，无需调整")
            result['steps'].append({'step': 3, 'action': 'check_already_sorted', 'ok': True})

            # 关闭弹窗
            time.sleep(wait_ms / 1000)
            action = BrowserAction(kind='eval', script="(function(){const btn=document.querySelector('.footer-cancel, .next-dialog-close');if(btn)btn.click();return{ok:true}})();")
            backend.execute(action)
            result['finalOrder'] = sorted_texts
            result['success'] = True
            return result

        # Step 4: 调用 onChange 设置排序
        print("[Step 4] 调用 React onChange 更新排序...")
        sorted_json = json.dumps(sorted_value, ensure_ascii=False)
        js_script = JS_SET_SORT_ORDER_TEMPLATE.replace('__SORTED_VALUE__', sorted_json)
        action = BrowserAction(kind='eval', script=js_script)
        resp = backend.execute(action)
        if not resp.ok:
            result['errors'].append(f"设置排序失败: {resp.error}")
            return result
        result['steps'].append({'step': 4, 'action': 'set_sort_order', 'ok': True})
        time.sleep(wait_ms / 1000)

        # Step 5: 验证弹窗中的顺序
        print("[Step 5] 验证弹窗中的顺序...")
        action = BrowserAction(kind='eval', script=JS_VERIFY_DIALOG_ORDER)
        resp = backend.execute(action)
        if not resp.ok:
            result['errors'].append(f"验证弹窗顺序失败: {resp.error}")
            return result

        data = resp.data.get('value', {})
        if isinstance(data, str):
            data = json.loads(data)
        dialog_order = data.get('order', [])
        print(f"  弹窗中顺序: {dialog_order}")

        if dialog_order != sorted_texts:
            result['errors'].append(f"弹窗顺序不匹配: 期望 {sorted_texts}, 实际 {dialog_order}")
            return result
        result['steps'].append({'step': 5, 'action': 'verify_dialog_order', 'ok': True})

        # Step 6: 点击确认排序按钮
        print("[Step 6] 点击确认排序按钮...")
        action = BrowserAction(kind='eval', script=JS_CLICK_CONFIRM)
        resp = backend.execute(action)
        if not resp.ok:
            result['errors'].append(f"点击确认按钮失败: {resp.error}")
            return result
        result['steps'].append({'step': 6, 'action': 'confirm_sort', 'ok': True})
        time.sleep(wait_ms / 1000 * 2)

        # Step 7: 验证最终页面顺序
        print("[Step 7] 验证页面最终身高顺序...")
        action = BrowserAction(kind='eval', script=JS_VERIFY_FINAL_ORDER)
        resp = backend.execute(action)
        if not resp.ok:
            result['errors'].append(f"验证最终顺序失败: {resp.error}")
            return result

        data = resp.data.get('value', {})
        if isinstance(data, str):
            data = json.loads(data)
        final_order = data.get('heightOrder', [])
        print(f"  最终页面顺序: {final_order}")

        result['finalOrder'] = final_order

        # 验证最终顺序是否正确
        if final_order == sorted_texts:
            result['success'] = True
            result['steps'].append({'step': 7, 'action': 'verify_final_order', 'ok': True})
            print("\n✅ 排序成功！")
        else:
            result['errors'].append(f"最终顺序不匹配: 期望 {sorted_texts}, 实际 {final_order}")
            print("\n❌ 排序验证失败")

    except Exception as e:
        result['errors'].append(f"异常: {str(e)}")
        print(f"\n❌ 发生异常: {e}")

    return result


def main():
    parser = argparse.ArgumentParser(description='天猫发布页面身高模块通用排序工具')
    parser.add_argument('--cdp-url', default='http://127.0.0.1:9222', help='CDP 浏览器地址')
    parser.add_argument('--url-prefix', required=True, help='页面 URL 前缀（用于定位标签页）')
    parser.add_argument('--wait-ms', type=int, default=500, help='每步等待时间（毫秒）')
    parser.add_argument('--json', action='store_true', help='输出 JSON 格式结果')

    args = parser.parse_args()

    result = run_height_sort(
        cdp_url=args.cdp_url,
        url_prefix=args.url_prefix,
        wait_ms=args.wait_ms
    )

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("\n" + "=" * 50)
        print(f"原始顺序: {' → '.join(result['originalOrder'])}")
        print(f"最终顺序: {' → '.join(result['finalOrder'])}")
        print(f"执行状态: {'成功' if result['success'] else '失败'}")
        if result['errors']:
            print(f"错误信息: {'; '.join(result['errors'])}")


if __name__ == '__main__':
    main()
