#!/usr/bin/env python3
"""
批量处理"待排查ID"sheet中的商品 - v3 优化版
优化点：
1. 验证逻辑：等待页面跳转后，判断页面是否出现"商品提交成功"字段
2. 等待时间：1-5秒随机数
3. 断点续传：跳过已成功的，只重新处理失败的
4. 错误识别：自动识别前端校验错误（如必填项未填）
5. 加快进程速度
"""

import json
import time
import random
import urllib.request
import openpyxl
import sys
import os

sys.path.insert(0, r"E:\巴拉知识库\自动化\crawshrimp-skill\scripts")
from browser_executor import ChromeCDPBackend, BrowserAction

CDP_URL = "http://127.0.0.1:9222"
INPUT_EXCEL = r"E:\巴拉巴拉\AI\批量处理尺码\淘系-产品链接尺码顺序异常批量排查.xlsx"
OUTPUT_EXCEL = r"E:\巴拉知识库\Semir\尺码排序结果.xlsx"


def random_wait(min_s=1, max_s=3):
    t = random.uniform(min_s, max_s)
    time.sleep(t)


def get_tabs():
    try:
        with urllib.request.urlopen(f"{CDP_URL}/json", timeout=5) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return []


def close_tab(tab_id):
    try:
        urllib.request.urlopen(f"{CDP_URL}/json/close/{tab_id}", timeout=5)
        return True
    except:
        return False


def close_all_tmall_tabs():
    tabs = get_tabs()
    tmall_tabs = [t for t in tabs if 'sell.publish.tmall.com' in t.get('url', '')]
    for tab in tmall_tabs:
        close_tab(tab['id'])
    time.sleep(0.5)


def open_new_tab(url):
    try:
        req = urllib.request.Request(f"{CDP_URL}/json/new?{url}", method='PUT')
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return None


def cdp_eval(url_prefix, script):
    try:
        backend = ChromeCDPBackend(cdp_url=CDP_URL, url_prefix=url_prefix)
        action = BrowserAction(kind='eval', script=script)
        resp = backend.execute(action)
        if not resp.ok:
            return {"ok": False, "error": resp.error}
        data = resp.data.get('value', {})
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except:
                pass
        return {"ok": True, "data": data}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def check_slider_captcha(url_prefix):
    resp = cdp_eval(url_prefix, r"""
    (function() {
        var bodyText = document.body.innerText;
        var hasSlider = bodyText.indexOf('滑块') !== -1 || bodyText.indexOf('拖动滑块') !== -1;
        return { hasSlider: hasSlider };
    })();
    """)
    if resp['ok']:
        return resp['data'].get('hasSlider', False)
    return False


def wait_for_slider_manual(item_id):
    print(f"\n{'!'*60}")
    print(f"⚠️ 检测到滑块验证！商品ID: {item_id}")
    print(f"请在浏览器中手动完成滑块验证，完成后按回车继续...")
    print(f"{'!'*60}\n")
    input("按回车继续...")
    time.sleep(1)


def run_height_sorter(item_id):
    import subprocess
    publish_url = f"https://sell.publish.tmall.com/tmall/publish.htm?id={item_id}"
    cmd = [
        sys.executable,
        r"E:\巴拉知识库\自动化\crawshrimp-skill\scripts\tmall_height_sorter.py",
        "--url-prefix", publish_url
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=45,
            cwd=r"E:\巴拉知识库\自动化\crawshrimp-skill"
        )
        output = result.stdout + result.stderr
        if "执行状态: 成功" in output or "排序成功" in output:
            return {'success': True, 'message': '身高排序完成'}
        else:
            return {'success': False, 'message': output[:150]}
    except Exception as e:
        return {'success': False, 'message': f'身高排序异常: {e}'}


def set_smart_discount_no(url_prefix):
    """自动设置店铺智能优惠为'否'（放弃机会）"""
    resp = cdp_eval(url_prefix, r"""
    (function() {
        // 先滚动到页面中间
        window.scrollTo(0, document.body.scrollHeight * 0.5);
        
        // 遍历所有元素找"放弃机会"文本
        var allEls = document.querySelectorAll('span.item-label');
        for (var i = 0; i < allEls.length; i++) {
            var el = allEls[i];
            var text = (el.innerText || '').trim();
            if (text === '放弃机会') {
                // 往上找label或sell-radio
                var label = el.closest('label');
                if (label) {
                    label.click();
                    return { clicked: true, found: true, method: 'label' };
                }
                var radio = el.closest('.sell-radio');
                if (radio) {
                    radio.click();
                    return { clicked: true, found: true, method: 'sell-radio' };
                }
                el.click();
                return { clicked: true, found: true, method: 'direct' };
            }
        }
        return { clicked: false, found: false };
    })();
    """)
    if resp['ok'] and resp['data'].get('clicked'):
        print(f"    ✅ 店铺智能优惠设置为: 放弃机会(否)")
        return True
    return False


def get_validation_errors(url_prefix):
    """获取页面上的校验错误，直接读取左侧错误面板"""
    resp = cdp_eval(url_prefix, r"""
    (function() {
        var errors = new Set();
        
        // 方法1：直接找左侧错误面板里的错误项
        // 找包含"错误"标签的面板
        var allEls = document.querySelectorAll('*');
        for (var i = 0; i < allEls.length; i++) {
            var el = allEls[i];
            if (el.offsetParent === null) continue;
            
            // 找红色叉号的错误项
            if (el.querySelector && el.querySelector('.next-icon-error, .icon-error, [class*="error"]')) {
                var text = el.innerText.trim();
                if (text && text.length < 60 && text.length > 5 && text.indexOf('必填') !== -1) {
                    errors.add(text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim());
                }
            }
        }
        
        // 方法2：兜底，找包含错误关键词的短文本
        if (errors.size === 0) {
            var errorKeywords = ['必填项未填', '必填项不能为空', '填写错误', '不能为空', '必填'];
            for (var i = 0; i < allEls.length; i++) {
                var el = allEls[i];
                if (el.offsetParent === null) continue;
                var text = el.innerText.trim();
                if (!text || text.length > 50) continue;
                
                for (var j = 0; j < errorKeywords.length; j++) {
                    if (text.indexOf(errorKeywords[j]) !== -1) {
                        var cleanText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                        if (cleanText.length < 40) {
                            errors.add(cleanText);
                        }
                        break;
                    }
                }
            }
        }
        
        return { errors: Array.from(errors).slice(0, 5) };
    })();
    """)
    if resp['ok']:
        return resp['data'].get('errors', [])
    return []


def verify_submit_success(item_id, url_prefix):
    """
    验证提交成功：
    1. 先检查是否有校验错误（如果有，直接返回失败）
    2. 等待页面跳转
    3. 检查是否有新标签页跳转到 success.htm
    """
    # 先检查校验错误
    errors = get_validation_errors(url_prefix)
    if errors:
        return {
            'success': False,
            'message': f'校验失败: {"; ".join(errors[:3])}'
        }
    
    # 等待跳转
    random_wait(2, 4)
    
    # 轮询检查
    for i in range(6):
        tabs = get_tabs()
        for tab in tabs:
            url = tab.get('url', '')
            if 'success.htm' in url and 'isSuccess=true' in url:
                return {'success': True, 'message': '跳转到成功页面'}
        time.sleep(1)
    
    return {'success': False, 'message': '未检测到成功页面跳转'}


def process_single_item(item_id):
    result = {
        'item_id': item_id,
        'success': False,
        'error': None
    }
    
    publish_url = f"https://sell.publish.tmall.com/tmall/publish.htm?id={item_id}"
    url_prefix = f"https://sell.publish.tmall.com/tmall/publish.htm?id={item_id}"
    
    try:
        # Step 1: 打开商品编辑页面
        new_tab = open_new_tab(publish_url)
        if not new_tab:
            result['error'] = '打开新标签页失败'
            return result
        
        random_wait(2, 3)
        
        if check_slider_captcha(url_prefix):
            wait_for_slider_manual(item_id)
        
        # Step 2: 处理属性更新弹窗
        random_wait(0.5, 1)
        cdp_eval(url_prefix, r"""
        (function() {
            var buttons = document.querySelectorAll('button');
            for (var j = 0; j < buttons.length; j++) {
                var btn = buttons[j];
                if (btn.textContent.trim() === '取消' && btn.offsetParent !== null) {
                    var parent = btn.parentElement;
                    while (parent) {
                        if (parent.textContent && parent.textContent.indexOf('商品属性信息更新') !== -1) {
                            btn.click();
                            return {};
                        }
                        parent = parent.parentElement;
                    }
                }
            }
            return {};
        })();
        """)
        
        # Step 3: 身高排序
        sort_result = run_height_sorter(item_id)
        if not sort_result['success']:
            print(f"    ⚠️ 排序提示: {sort_result['message'][:80]}")
        
        random_wait(0.5, 1)
        
        # Step 3.5: 设置店铺智能优惠为"否"
        print(f"  [Step 3.5] 设置店铺智能优惠为否...")
        set_smart_discount_no(url_prefix)
        random_wait(0.5, 1)
        
        # Step 4: 点击提交
        resp = cdp_eval(url_prefix, r"""
        (function() {
            window.scrollTo(0, document.body.scrollHeight);
            var btn = document.querySelector('.sell-float-bottom button.next-btn-primary');
            if (btn && btn.offsetParent !== null) {
                btn.click();
                return { ok: true };
            }
            return { ok: false };
        })();
        """)
        if not resp['ok'] or not resp['data'].get('ok'):
            result['error'] = '提交按钮未找到'
            return result
        
        random_wait(1, 2)
        
        if check_slider_captcha(url_prefix):
            wait_for_slider_manual(item_id)
        
        # Step 5: 处理图文详情弹窗（确认提交）+ 等待跳转成功页
        # 循环检查直到成功页面出现或发现校验错误，最多等15秒
        max_wait = 15
        waited = 0
        has_success = False
        has_error = False
        while waited < max_wait:
            random_wait(1, 1.5)
            waited += 1.5
            
            # 先检查是否已经跳转到成功页了
            tabs = get_tabs()
            for tab in tabs:
                url = tab.get('url', '')
                if 'success.htm' in url and 'isSuccess=true' in url:
                    has_success = True
                    print(f"    ✅ 已跳转到成功页面（等待了{waited:.1f}秒）")
                    break
            
            if has_success:
                break
            
            # 检查有没有校验错误（如果有，就不用继续等了）
            errors = get_validation_errors(url_prefix)
            if errors:
                has_error = True
                print(f"    ⚠️ 发现校验错误（等待了{waited:.1f}秒）: {errors[0][:30]}")
                break
            
            # 还没跳转，也没错误，检查有没有"确认提交"弹窗
            resp = cdp_eval(url_prefix, r"""
            (function() {
                var buttons = document.querySelectorAll('button');
                for (var j = 0; j < buttons.length; j++) {
                    var btn = buttons[j];
                    if (btn.textContent.trim() === '确认提交' && btn.offsetParent !== null) {
                        btn.click();
                        return { clicked: true };
                    }
                }
                return {};
            })();
            """)
            if resp['ok'] and resp['data'].get('clicked'):
                print(f"    点击确认提交（等待了{waited:.1f}秒）")
        
        # Step 6: 验证提交成功
        if has_success:
            verify_result = {'success': True, 'message': '跳转到成功页面'}
        elif has_error:
            errors = get_validation_errors(url_prefix)
            verify_result = {
                'success': False,
                'message': f'校验失败: {"; ".join(errors[:3])}'
            }
        else:
            verify_result = verify_submit_success(item_id, url_prefix)
        
        if verify_result['success']:
            result['success'] = True
            print(f"    ✅ {verify_result['message']}")
        else:
            result['error'] = verify_result.get('message', '验证失败')
            print(f"    ⚠️ {result['error']}")
    
    except Exception as e:
        result['error'] = f'异常: {str(e)[:100]}'
        print(f"    ❌ {result['error']}")
    
    finally:
        close_all_tmall_tabs()
    
    return result


def load_existing_results():
    results = {}
    if os.path.exists(OUTPUT_EXCEL):
        try:
            wb = openpyxl.load_workbook(OUTPUT_EXCEL)
            ws = wb.active
            for row in range(2, ws.max_row + 1):
                item_id = str(ws.cell(row, 1).value).strip()
                status = str(ws.cell(row, 2).value).strip()
                if item_id and item_id != 'None':
                    results[item_id] = status
        except Exception as e:
            print(f"加载已有结果失败: {e}")
    return results


def main():
    print(f"读取Excel文件: {INPUT_EXCEL}")
    wb = openpyxl.load_workbook(INPUT_EXCEL)
    ws = wb['待排查ID']
    max_row = ws.max_row
    print(f"总行数: {max_row}")
    
    existing = load_existing_results()
    success_exist = sum(1 for v in existing.values() if v == '成功')
    fail_exist = sum(1 for v in existing.values() if v == '失败')
    print(f"已有结果: 成功 {success_exist} 个, 失败 {fail_exist} 个")
    
    if os.path.exists(OUTPUT_EXCEL):
        out_wb = openpyxl.load_workbook(OUTPUT_EXCEL)
        out_ws = out_wb.active
    else:
        out_wb = openpyxl.Workbook()
        out_ws = out_wb.active
        out_ws.cell(1, 1).value = '商品ID'
        out_ws.cell(1, 2).value = '执行结果'
        out_ws.cell(1, 3).value = '错误原因'
    
    print("\n初始化：清理天猫标签页...")
    close_all_tmall_tabs()
    
    success_count = success_exist
    fail_count = sum(1 for v in existing.values() if v == '失败')
    skip_count = sum(1 for v in existing.values() if v == '跳过')
    process_count = 0
    
    for row in range(1, max_row + 1):
        item_id = str(ws.cell(row, 1).value).strip()
        if not item_id or item_id == 'None':
            continue
        
        if existing.get(item_id) == '成功' or existing.get(item_id) == '跳过':
            skip_count += 1
            continue
        
        process_count += 1
        print(f"\n处理: {item_id} (跳过{skip_count}个成功)")
        
        result = process_single_item(item_id)
        
        out_row = None
        for r in range(2, out_ws.max_row + 1):
            if str(out_ws.cell(r, 1).value).strip() == item_id:
                out_row = r
                break
        if out_row is None:
            out_row = out_ws.max_row + 1
            out_ws.cell(out_row, 1).value = item_id
        
        if result['success']:
            out_ws.cell(out_row, 2).value = '成功'
            out_ws.cell(out_row, 3).value = ''
            success_count += 1
            existing[item_id] = '成功'
        elif '校验失败' in (result.get('error') or ''):
            out_ws.cell(out_row, 2).value = '跳过'
            out_ws.cell(out_row, 3).value = result.get('error', '')
            skip_count += 1
            existing[item_id] = '跳过'
        else:
            out_ws.cell(out_row, 2).value = '失败'
            out_ws.cell(out_row, 3).value = result.get('error', '未知错误')
            fail_count += 1
            existing[item_id] = '失败'
        
        if process_count % 5 == 0:
            out_wb.save(OUTPUT_EXCEL)
            print(f"\n💾 已保存 | 成功: {success_count}, 失败: {fail_count}, 跳过: {skip_count}")
        
        random_wait(1, 5)
    
    out_wb.save(OUTPUT_EXCEL)
    
    print(f"\n{'='*60}")
    print(f"批量处理完成！")
    print(f"成功: {success_count} 个")
    print(f"跳过(必填项缺失): {skip_count} 个")
    print(f"失败: {fail_count} 个")
    print(f"结果文件: {OUTPUT_EXCEL}")


if __name__ == '__main__':
    main()
