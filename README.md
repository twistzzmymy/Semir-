# tmall-clone-id-publisher

天猫/淘宝卖家中心「发布相似品」批量克隆商品工具（CDP 直连浏览器 RPA）。

通过 URL 直开商品编辑页，逐行克隆源商品：搜索原ID → 发布相似品 → 图文描述旧版文本编辑 → 淘金币促销图清理 → 放入仓库 → 身高/尺码排序 → 提交 → 抓取新ID 写回 Excel。

## 环境要求

- Windows + Python 3.10+
- 依赖：`websockets`、`openpyxl`（`pip install websockets openpyxl`）
- 已登录淘宝卖家中心的 Chrome（CDP 调试端口启动，见下）
- 浏览器须保持登录态（登录一次后 cookies 持久）

## 快速开始

### 1. 启动 CDP 浏览器（带调试端口）

```bash
chrome.exe --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir=<你的profile目录> --no-first-run --new-window "https://myseller.taobao.com/home.htm/SellManage/on_sale"
```

- 端口默认 `9222`（可用 `--cdp-url http://127.0.0.1:9223` 换实例）
- `--user-data-dir` 用**专用目录**（避免与日常 Chrome 冲突），首次启动后手动登录一次淘宝卖家中心

### 2. 准备 Excel

列结构（Sheet1，A~J 共 10 列）：

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| 原ID | 新建id(输出) | 定时发布时间 | 新建备注(输出) | 货号 | 产品线 | 品类 | 克隆数量 | 上架时间 | 产品线反馈 |

`A`（原ID）与 `E`（货号）为必填输入；`B`/`D` 为输出列（成功写回新ID，失败写回原因）。

### 3. 运行（试跑不提交）

```bash
python scripts/clone_id_flow.py --excel "你的表.xlsx" --dry-run --report dry_run.json
```

### 4. 批量克隆（提交）

```bash
python scripts/clone_id_flow.py --excel "你的表.xlsx" --start-row 2 --end-row 101 --yes --cdp-url http://127.0.0.1:9222 --report run.json
```

参数：

| 参数 | 说明 |
|---|---|
| `--excel` | 源 Excel 路径（必填） |
| `--start-row / --end-row` | 行范围（默认全表） |
| `--yes` | 授权提交（**不带则停在提交前**，供人工检查） |
| `--dry-run` | 零副作用试跑（只读+计划） |
| `--cdp-url` | CDP 地址，默认 `http://127.0.0.1:9222` |
| `--report` | 结果 JSON 落盘路径（建议必填，写回失败时不丢新ID） |

## 单行处理流程（10 步）

1. 关闭 SKU 弹窗（若有）
2. 在售页搜索原ID（出售中搜不到自动切"全部"）
3. 「发布相似品」打开编辑页（copyItem=true）
4. 同类宝贝货号频次≥5 → 预切类目（详见下）
5. 图文描述 → 旧版 → 使用文本编辑（含展开/返回旧版兜底路径）
6. 淘金币促销图清理（旧描述模块首图）
7. 勾选「放入仓库」
8. 身高/尺码排序（调用 `deps/tmall_height_sorter.py`）
9. 提交（`--yes` 时生效）
10. 成功页抓取新ID（URL primaryId）+ 关闭编辑/成功页，回在售页继续下一行

## 同类宝贝（5个上限）处理

某货号在同类目已发布 ≥5 个时平台拦截。策略：**自动切换类目 + 货号加后缀 -N 递增重试**：

- 打开「切换类目」弹窗 → 品牌选「巴拉巴拉」→ 货号输入 `<基础货号>-1`（-1/-2/-3 依此类推）→ 确定
- 重走图文描述→提交，最多 3 轮；仍失败则记录跳过
- 可在预切集合（表内货号频次≥5）提前切换

## 错误处理与学习库

- 提交报错后自动查询 `knowledge/error_knowledge.md`：命中则按已验证方案处理（如旺铺PC详情→回旧版文本编辑；淘金币→删图；必填项缺失→**记录并跳过该款**，不做自动补填）
- 未命中 → 自动追加「未知错误」条目（unknown_pending），等待补充方案后**自主迭代**（下次同类错误命中新方案）
- 提交无响应 ≠ 失败：自动重试 ≤2 次；仍无响应记录 unknown，可在仓库按货号确认是否已创建

**已固化条目**：ERR-001 同类宝贝切类目 / ERR-002 旺铺PC详情 / ERR-003 标题过长(非阻断) / ERR-004 必填项缺失(跳过) / ERR-005 搜索框未找到 / ERR-006 淘金币图 / ERR-007 补填后resubmit失败

## 辅助脚本

| 脚本 | 用途 |
|---|---|
| `retry_rows.py` | 重试指定行：`--rows 48,53,60 --excel x.xlsx --yes` |
| `run_426_batch.py` | 按季节=426 过滤行批量克隆：`--src x.xlsx --start 2 --end 10 --yes` |
| `watcher_chain.py` | 顺序衔接两个批次：`--prev-pid <PID> --excel next.xlsx --log-dir <dir> --cdp-url ...` |

## 安全边界

- 提交/发布是**外部生效动作**：默认跳过，必须 `--yes`；`--dry-run` 全程零副作用
- 脚本只操作当前浏览器标签页，不读取/存储任何账号凭证
- 写回 Excel 前自动备份 `<文件>.bak.xlsx`；文件被 Excel 占用时无法保存（先关闭）
- 运行日志建议重定向到文件（`python ... > run.log 2>&1`），长任务用独立进程/计划任务

## 目录结构

```
tmall-clone-id-publisher/
├── SKILL.md                # Skill 元信息与完整操作说明
├── README.md
├── config.example.yaml     # 配置模板
├── knowledge/error_knowledge.md  # 错误学习库（可迭代）
├── deps/                   # 内置依赖（身高排序 + 浏览器执行器，可移植）
│   ├── tmall_height_sorter.py
│   └── browser_executor.py
└── scripts/
    ├── clone_id_flow.py    # 主流程
    ├── cdp_bridge.py       # CDP 操作封装
    ├── category_switch.py  # 切类目模块
    ├── error_knowledge.py  # 错误学习库读写
    └── ...（辅助脚本）
```
