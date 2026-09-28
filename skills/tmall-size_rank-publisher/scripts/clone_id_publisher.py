#!/usr/bin/env python3
"""
tmall-clone-id-publisher - 淘宝商品编辑-尺码排序提交工具

从淘宝卖家中心搜索商品ID，进入编辑页面，自动完成身高/尺码排序后提交。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))

from browser_executor import ChromeCDPBackend, BrowserAction


# ============ JavaScript 代码片段 ============

JS_CLICK_SUBMIT = r"""
(function() {
    // 优先使用已知的提交按钮选择器（页面底部浮动栏）
    var btn = document.querySelector('.sell-float-bottom button.next-btn-primary');
    if (btn && btn.offsetParent !== null) {
        btn.click();
        return { ok: true, evidence: 'clicked submit button (float bottom bar)' };
    }
    
    // 备用：查找所有按钮
    var buttons = document.querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++) {
        var btn = buttons[i];
        var text = btn.textContent.trim();
        if (text === '提交' && btn.offsetParent !== null) {
            btn.click();
            return { ok: true, evidence: 'clicked submit button' };
        }
    }
    
    return { ok: false, error: 'submit button not found' };
})();
"""

JS_DISMISS_DIALOGS = r"""
(function() {
    // 自动处理弹窗
    var dismissed = [];
    
    // 常见弹窗按钮文本
    var confirmTexts = ['确认提交', '确定', '确认', '知道了', '好的', '继续'];
    
    // 查找弹窗中的按钮
    var dialogs = document.querySelectorAll('.next-dialog, .next-modal, [class*=dialog]');
    var allButtons = document.querySelectorAll('button, .next-btn, .dialog-btn');
    
    for (var i = 0; i < allButtons.length; i++) {
        var btn = allButtons[i];
        var text = btn.textContent.trim();
        if (btn.offsetParent !== null && confirmTexts.indexOf(text) !== -1) {
            // 确认按钮通常在弹窗内
            btn.click();
            dismissed.push(text);
        }
    }
    
    return { ok: true, dismissed: dismissed };
})();
"""

JS_CHECK_SUBMIT_SUCCESS = r"""
(function() {
    var bodyText = document.body.innerText;
    var currentUrl = window.location.href;
    
    // 检查 URL 是否跳转到成功页
    if (currentUrl.indexOf('success.htm') !== -1 && currentUrl.indexOf('isSuccess=true') !== -1) {
        return { ok: true, success: true, message: 'redirected to success page' };
    }
    
    // 检查成功提示文本
    var successKeywords = ['提交成功', '保存成功', '发布成功', '操作成功'];
    for (var i = 0; i < successKeywords.length; i++) {
        if (bodyText.indexOf(successKeywords[i]) !== -1) {
            return { ok: true, success: true, message: successKeywords[i] };
        }
    }
    
    return { ok: true, success: false, message: 'no success indicator found' };
})();
"""


# ============ 主流程 ============

def run_publisher(cdp_url: str, item_id: str, wait_ms: int = 1000) -> dict:
    """
    执行商品编辑-尺码排序提交流程
    """
    backend = ChromeCDPBackend(cdp_url=cdp_url, url_prefix=f"https://sell.publish.tmall.com/tmall/publish.htm?id={item_id}")
    result = {
        'success': False,
        'item_id': item_id,
        'steps': [],
        'errors': []
    }
    
    try:
        # Step 1: 打开商品编辑页面
        print(f"[Step 1] 打开商品编辑页面: {item_id}")
        # 直接通过 URL 访问，假设页面已打开
        
        # Step 2: 执行身高排序
        print("[Step 2] 执行身高排序...")
        # 调用 tmall_height_sorter 的逻辑
        # TODO: 集成 tmall_height_sorter 脚本
        
        # Step 3: 点击提交
        print("[Step 3] 点击提交按钮...")
        action = BrowserAction(kind='eval', script=JS_CLICK_SUBMIT)
        resp = backend.execute(action)
        if not resp.ok:
            result['errors'].append(f"点击提交失败: {resp.error}")
            return result
        result['steps'].append({'step': 3, 'action': 'click_submit', 'ok': True})
        time.sleep(wait_ms / 1000 * 2)
        
        # Step 4: 处理弹窗
        print("[Step 4] 处理弹窗...")
        for i in range(3):  # 最多处理 3 个弹窗
            action = BrowserAction(kind='eval', script=JS_DISMISS_DIALOGS)
            resp = backend.execute(action)
            if not resp.ok:
                break
            data = resp.data.get('value', {})
            if isinstance(data, str):
                data = json.loads(data)
            dismissed = data.get('dismissed', [])
            if not dismissed:
                break
            print(f"  处理弹窗: {', '.join(dismissed)}")
            time.sleep(wait_ms / 1000)
        
        result['steps'].append({'step': 4, 'action': 'dismiss_dialogs', 'ok': True})
        
        # Step 5: 验证提交结果
        print("[Step 5] 验证提交结果...")
        action = BrowserAction(kind='eval', script=JS_CHECK_SUBMIT_SUCCESS)
        resp = backend.execute(action)
        if not resp.ok:
            result['errors'].append(f"验证失败: {resp.error}")
            return result
        
        data = resp.data.get('value', {})
        if isinstance(data, str):
            data = json.loads(data)
        
        result['success'] = data.get('success', False)
        result['steps'].append({'step': 5, 'action': 'verify_result', 'ok': result['success']})
        
        if result['success']:
            print(f"✅ 提交成功: {data.get('message', '')}")
        else:
            print(f"⚠️ 未检测到成功提示")
    
    except Exception as e:
        result['errors'].append(f"异常: {str(e)}")
        print(f"❌ 发生异常: {e}")
    
    return result


def main():
    parser = argparse.ArgumentParser(description='淘宝商品编辑-尺码排序提交工具')
    parser.add_argument('--item-id', required=True, help='商品ID')
    parser.add_argument('--cdp-url', default='http://127.0.0.1:9222', help='CDP 浏览器地址')
    parser.add_argument('--wait-ms', type=int, default=1000, help='每步等待时间（毫秒）')
    
    args = parser.parse_args()
    
    result = run_publisher(
        cdp_url=args.cdp_url,
        item_id=args.item_id,
        wait_ms=args.wait_ms
    )
    
    print("\n" + "=" * 50)
    print(f"商品ID: {args.item_id}")
    print(f"执行状态: {'成功' if result['success'] else '失败'}")
    if result['errors']:
        print(f"错误信息: {'; '.join(result['errors'])}")


if __name__ == '__main__':
    main()
