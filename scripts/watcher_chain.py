# -*- coding: utf-8 -*-
"""自动衔接 watcher：等待全量克隆(PID 19116)结束 → 启动 上新ID-10.12.xlsx(row2-97) 克隆。

由 Start-Process 独立启动，轮询存活直到下一个克隆结束，避免子进程孤儿。
"""
import ctypes
import subprocess
import sys
import time
from pathlib import Path

PREV_PID = int(sys.argv[sys.argv.index('--prev-pid')+1]) if '--prev-pid' in sys.argv else 19116
SKILL_DIR = Path(sys.argv[sys.argv.index('--skill-dir')+1]) if '--skill-dir' in sys.argv else Path(__file__).resolve().parent.parent
LOG_DIR = Path(sys.argv[sys.argv.index('--log-dir')+1]) if '--log-dir' in sys.argv else Path(r'E:\巴拉知识库\归档\自动化调试')


def alive(pid: int) -> bool:
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not h:
        return False
    ctypes.windll.kernel32.CloseHandle(h)
    return True


def main():
    log = open(LOG_DIR / 'watcher_chain.log', 'a', encoding='utf-8')
    log.write(f'[watcher] start, waiting prev={PREV_PID}\n')
    log.flush()
    while alive(PREV_PID):
        time.sleep(30)
    log.write('[watcher] prev done, starting next clone (上新ID-10.12 row2-97)\n')
    log.flush()

    cmd = [
        sys.executable, '-u', 'scripts/clone_id_flow.py',
        '--excel', sys.argv[sys.argv.index('--excel')+1] if '--excel' in sys.argv else r'E:\巴拉知识库\归档\自动化调试\上新ID-10.12.xlsx',
        '--start-row', '2', '--end-row', '97',
        '--yes',
        '--cdp-url', sys.argv[sys.argv.index('--cdp-url')+1] if '--cdp-url' in sys.argv else 'http://127.0.0.1:9222',
        '--report', str(LOG_DIR / 'newup_row2-97.json'),
    ]
    with open(LOG_DIR / 'batch_up_row2-97.log', 'a', encoding='utf-8', errors='replace') as out, \
         open(LOG_DIR / 'batch_up_row2-97.err.log', 'a', encoding='utf-8', errors='replace') as err:
        p = subprocess.Popen(cmd, cwd=str(SKILL_DIR), stdout=out, stderr=err,
                             creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    log.write(f'[watcher] next pid={p.pid}\n')
    log.flush()
    p.wait()
    log.write(f'[watcher] next done rc={p.returncode}\n')
    log.flush()


if __name__ == '__main__':
    main()
