#!/usr/bin/env python3
"""错误学习库（Error Knowledge Base）读写与匹配模块

知识库文件: <skill>/knowledge/error_knowledge.md
格式: 每条以 "## <关键词1|关键词2|...>" 开头，后跟 "key: value" 字段行，
      解决方案段落为 "- 解决方案:" 之后的行（每行一个动作，以数字序号开头）。

API:
  load()                      -> list[dict]   读取全部条目
  match(text)                 -> dict|None    按错误文本匹配条目（文本包含任一关键词）
  record(text, entry)         -> dict         记录/更新条目（同签名合并次数）
  apply_solution(entry)       -> list[str]    返回解决方案动作列表（由主流程执行）
  CLI: python error_knowledge.py match "<错误文本>"
       python error_knowledge.py list
"""

from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime
from pathlib import Path

KB_FILE = Path(__file__).resolve().parent.parent / "knowledge" / "error_knowledge.md"


def _parse_entries(text: str) -> list[dict]:
    """解析 error_knowledge.md 为条目列表。"""
    entries: list[dict] = []
    # 按 "## " 切分
    blocks = re.split(r"^## ", text, flags=re.M)
    for block in blocks[1:]:
        lines = block.splitlines()
        head = lines[0].strip()
        entry = {"signature": head, "keywords": [k.strip() for k in head.split("|") if k.strip()], "fields": {}, "solution": []}
        in_solution = False
        for line in lines[1:]:
            s = line.strip()
            if not s:
                continue
            if s.startswith("- 解决方案:"):
                in_solution = True
                continue
            if in_solution:
                # 解决方案步骤：缩进的 "数字. 内容"；其他行（含 - 字段行）退出解决方案段
                step_m = re.match(r"^\s*\d+[.)]\s*(.+)$", s)
                if step_m:
                    entry["solution"].append(step_m.group(1).strip())
                    continue
                in_solution = False
            m = re.match(r"^- ([^:]+):\s*(.*)$", s)
            if m:
                entry["fields"][m.group(1).strip()] = m.group(2).strip()
        entries.append(entry)
    return entries


def load() -> list[dict]:
    if not KB_FILE.exists():
        return []
    return _parse_entries(KB_FILE.read_text(encoding="utf-8"))


def match(text: str) -> dict | None:
    """按错误文本匹配：任一关键词命中即返回条目。"""
    if not text:
        return None
    for entry in load():
        for kw in entry["keywords"]:
            if kw and kw in text:
                return entry
    return None


def _dump(entries: list[dict]) -> str:
    out = ["# 错误学习库（Error Knowledge Base）", "", "本库用于记录千牛/天猫商品发布流程中遇到的错误与已验证的解决方案。", "格式：每条记录含错误签名（匹配关键词）、现象、根因、解决方案、验证信号。", "主流程脚本在提交报错后自动查询本库；命中则按解决方案执行，未命中则追加\"未知错误\"记录等待人工补充方案。", ""]
    for e in entries:
        out.append(f"## {e['signature']}")
        for k, v in e["fields"].items():
            out.append(f"- {k}: {v}")
        if e["solution"]:
            out.append("- 解决方案:")
            for i, step in enumerate(e["solution"], 1):
                out.append(f"  {i}. {step}")
        out.append("")
    return "\n".join(out)


def record(text: str, entry: dict) -> dict:
    """记录一条错误。若签名关键词与已有条目重叠则合并（次数+1），否则追加。"""
    entries = load()
    for e in entries:
        if any(kw in (entry.get("signature", "")) for kw in e["keywords"]):
            # 合并：更新现象/解决方案，次数+1
            e["fields"]["次数"] = str(int(e["fields"].get("次数", "0")) + 1)
            if entry.get("fields", {}).get("现象"):
                e["fields"]["现象"] = entry["fields"]["现象"]
            if entry.get("solution"):
                e["solution"] = entry["solution"]
            KB_FILE.write_text(_dump(entries), encoding="utf-8")
            return e
    # 新条目
    entries.append(entry)
    KB_FILE.write_text(_dump(entries), encoding="utf-8")
    return entry


def apply_solution(entry: dict) -> list[str]:
    """返回解决方案动作列表（供主流程逐条执行）。"""
    return entry.get("solution", [])


def new_unknown_entry(text: str, op_code: str = "") -> dict:
    """构造一条未知错误记录（等待人工补充方案）。"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    sig = text[:20].strip().replace("|", "/") if text else "未知错误"
    return {
        "signature": f"{sig}|操作码{op_code}" if op_code else sig,
        "keywords": [sig, op_code] if op_code else [sig],
        "fields": {
            "id": f"ERR-{ts.replace('-', '').replace(' ', '').replace(':', '')}",
            "现象": text[:200],
            "根因": "待分析",
            "状态": "unknown_pending",
            "首次发现": ts,
            "次数": "1",
        },
        "solution": [],
    }


def main():
    ap = argparse.ArgumentParser(description="错误学习库工具")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("match", help="按错误文本匹配条目")
    p1.add_argument("text")
    p2 = sub.add_parser("list", help="列出全部条目")
    args = ap.parse_args()

    if args.cmd == "match":
        e = match(args.text)
        if e:
            print(f"MATCH: {e['signature']}")
            print(f"  状态: {e['fields'].get('状态')}  次数: {e['fields'].get('次数')}")
            print(f"  根因: {e['fields'].get('根因')}")
            print("  解决方案:")
            for i, s in enumerate(e["solution"], 1):
                print(f"    {i}. {s}")
        else:
            print("NO_MATCH")
            sys.exit(1)
    elif args.cmd == "list":
        for e in load():
            print(f"[{e['fields'].get('id', '?')}] {e['signature']} 状态={e['fields'].get('状态')} 次数={e['fields'].get('次数')}")


if __name__ == "__main__":
    main()
