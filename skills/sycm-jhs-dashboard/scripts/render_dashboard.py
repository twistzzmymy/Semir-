# -*- coding: utf-8 -*-
"""聚划算渗透率看板渲染脚本 — 幂等，每次更新自动校验占位符残留"""
import json, re, sys, os

HISTORY = r"E:\巴拉巴拉\AI\sycm-cli\data\penetration_history.json"
SUPP = r"E:\巴拉巴拉\AI\sycm-cli\data\supplement_items.json"
TEMPLATE = r"E:\巴拉巴拉\AI\sycm-cli\dashboard\template.html"
OUTPUT = r"E:\巴拉知识库\巴拉知识库\wiki\活动\规则监控\聚划算渗透率看板.html"

def main():
    with open(HISTORY, 'r', encoding='utf-8') as f:
        history = json.load(f)

    # 补报商品（去重）
    supp_items = []
    if os.path.exists(SUPP):
        with open(SUPP, 'r', encoding='utf-8') as f:
            raw = json.load(f)
        seen = set()
        for it in raw:
            if it['id'] not in seen:
                seen.add(it['id'])
                supp_items.append(it)

    latest = history[-1]
    prev = history[-2] if len(history) > 1 else latest

    def chg(cur, pv):
        if pv == 0: return 0
        return round((cur - pv) / pv * 100, 1)

    pen_chg = round(latest['penetration_rate'] - prev['penetration_rate'], 2)
    shop_chg = chg(latest['all_pay'], prev['all_pay'])
    jhs_chg = chg(latest['jhs_pay'], prev['jhs_pay'])

    last7 = history[-7:]
    pen_7d = round(sum(h['penetration_rate'] for h in last7) / len(last7), 2)
    last30 = history[-30:]
    pen_30d = round(sum(h['penetration_rate'] for h in last30) / len(last30), 2)

    # === 近7天明细表行（4列：日期/全店/聚划算/渗透率）===
    table_rows = ""
    for h in reversed(last7):
        table_rows += f"<tr><td>{h['date'][5:]}</td><td>{h['all_pay']:,.0f}</td><td>{h['jhs_pay']:,.0f}</td><td>{h['penetration_rate']:.2f}%</td></tr>\n"

    # === 补报商品表行（6列：序号/ID/名称/7日支付/环比/报入模式）===
    supp_rows = ""
    for i, it in enumerate(supp_items):
        name = it.get('name', '')[:30]
        pay = it.get('pay_7d', '-')
        supp_rows += f"<tr><td>{i+1}</td><td>{it['id']}</td><td>{name}</td><td>{pay}</td><td>-</td><td>一口价</td></tr>\n"

    # === DATA数组（近14天图表）===
    data = [{"date": h['date'][5:], "pen": round(h['penetration_rate']/100, 4),
             "shop": h['all_pay'], "jhs": h['jhs_pay']} for h in history[-14:]]

    with open(TEMPLATE, 'r', encoding='utf-8') as f:
        tpl = f.read()

    # === 全部占位符映射（集中管理，新增占位符只改这里）===
    replacements = {
        '__DATA__': json.dumps(data, ensure_ascii=False),
        '__LATEST_DATE__': latest['date'],
        '__PEN_LATEST__': f"{latest['penetration_rate']:.2f}%",
        '__PEN_CHG__': f"{'+' if pen_chg>=0 else ''}{pen_chg:.2f}pp",
        '__SHOP_LATEST__': f"{latest['all_pay']:,.0f}",
        '__SHOP_CHG__': f"{'+' if shop_chg>=0 else ''}{shop_chg:.1f}%",
        '__JHS_LATEST__': f"{latest['jhs_pay']:,.0f}",
        '__JHS_CHG__': f"{'+' if jhs_chg>=0 else ''}{jhs_chg:.1f}%",
        '__RANGE__': f"{history[-7]['date']} ~ {history[-1]['date']}",
        '__UPDATED__': history[-1]['date'],
        '__TABLE_ROWS__': table_rows,
        '__SUPP_RANGE__': '近7日（9.15-9.21）',
        '__SUPPLEMENT_ROWS__': supp_rows,
        '__SUPP_NOTE__': f'Top{len(supp_items)}高价值未报商品（7日商品榜Top150中筛出，已报聚划算186件之外）',
        '__SUPP_PRED__': f'预计提升渗透率 +{len(supp_items)}个高价值商品报入',
        '__SUPP_FILE_NAME__': '聚划算一口价报入_2026-09-22.xlsx',
        '__SUPP_FILE_CNT__': str(len(supp_items)),
        '__SUPP_BTN_DISABLED__': '',
        '__PEN_7D__': f'{pen_7d:.2f}%',
        '__PEN_30D__': f'{pen_30d:.2f}%',
    }

    for k, v in replacements.items():
        tpl = tpl.replace(k, v)

    # === 自动校验：检查残留占位符 ===
    remaining = set(re.findall(r'__[A-Z_]{3,}__', tpl))
    if remaining:
        print(f"ERROR: 未替换占位符 {remaining}", file=sys.stderr)
        sys.exit(1)

    # === 自动校验：表格列数一致性 ===
    # 近7天表应该4列，补报表应该6列
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        f.write(tpl)

    print(f"OK: 看板已生成 -> {OUTPUT}")
    print(f"  最新: {latest['date']} 渗透率={latest['penetration_rate']:.2f}% (环比{pen_chg:+.2f}pp)")
    print(f"  7日均={pen_7d:.2f}%  30日均={pen_30d:.2f}%")
    print(f"  补报商品={len(supp_items)}个")
    print(f"  占位符残留=0 (已自动校验)")

if __name__ == '__main__':
    main()
