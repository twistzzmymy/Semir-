---
name: "search-term-daily"
description: "生意参谋引流搜索词每日定时下载、留档与主表拼接流程。从生意参谋「选词助手-引流搜索词-店外-无线」接口按日拉取全量搜索词数据，生成与页面导出一致的 xls 留档，再以 ZIP 级 XML 追加方式拼入搜索词留存主表（保留原表公式缓存），校验后交付。Invoke when user asks to download 生意参谋搜索词数据、每日留档、或拼入搜索词留存主表。"
---

# 搜索词每日下载 Skill（search-term-daily）

## 概述

每日从生意参谋拉取**昨日（T-1）**的「选词助手-引流搜索词-店外-无线」全量数据：

1. 生成与页面导出一致的 xls 留档（同名同格式）
2. 以 **ZIP 级 XML 追加**方式拼入最新主表，另存新版主表（原表不动）
3. 校验后交付

## 数据源与接口

- 页面：生意参谋 → 流量纵横 → 选词助手 → 引流搜索词（店外-无线）
- 接口：`/flow/v4/shop/wordAide/drainageSearch.json`

| 参数 | 值 | 说明 |
|---|---|---|
| `dateRange` | `YYYY-MM-DD\|YYYY-MM-DD` | 单日即同日两次 |
| `dateType` | `day` | 按日 |
| `device` | `2` | 无线端 |
| `kwType` | `se_keyword` | 搜索词 |
| `orderBy` / `order` | `uv` / `desc` | 按访客数降序 |
| `indexCode` | `uv,goodsCartByrCnt,goodsCltByrCnt,payOrderUserCnt,payConvertRate,payAmt,perByrAmt,uvValue` | 10 项指标 |
| `pageSize` | `100` | 实际每页约返回 10 条，需循环分页直到 `累计行数 >= recordCount` |

- 接口与页面「导出 Excel」为**同源数据**（已逐行比对验证，零真实差异，仅显示精度舍入）。
- `recordCount = 0` 说明该日数据未出（生意参谋 T+1），跳过并如实说明。

## 前置环境

| 依赖 | 位置/要求 |
|---|---|
| sycm-cli | `E:\巴拉巴拉\AI\sycm-cli\sycm_cli.py`（脚本通过 `SYCM_CLI_PATH` 环境变量或常量引用） |
| Python 依赖 | `E:\巴拉巴拉\AI\sycm-cli\.python-packages`（pandas/openpyxl/xlrd/xlwt），运行需 `PYTHONPATH` 指向它 |
| CA 证书 | `CURL_CA_BUNDLE` / `SSL_CERT_FILE` = `%USERPROFILE%\.sycm-cli\cacert.pem` |
| 登录态 | 专用 Chrome（profile `E:\巴拉巴拉\AI\sycm-cli\.runtime\chrome-profile`）已登录生意参谋；`%LOCALAPPDATA%\sycm-cli\cdp-port` 指向其 CDP 端口。接口报 `5810 You must login system first` = 登录态失效，需重新登录，勿反复重试 |

## 执行步骤

```powershell
# 1. 拉取 T-1 数据 → 生成留档 xls + 保存 API JSON
py pipeline_fetch.py 2026-09-20            # 缺省为昨天

# 2. 拼接主表（ZIP 级 XML 追加，原表不动，另存新文件）
py zip_merge.py --base "搜索词留存-更新至9.19.xlsx" --out "搜索词留存-更新至9.20.xlsx"

# 3. 校验
py verify_all.py --base "搜索词留存-更新至9.19.xlsx" --master "搜索词留存-更新至9.20.xlsx"
```

### 留档命名与格式

- 命名：`【生意参谋】选词助手-引流搜索词-店外-无线-YYYYMMDD.xls`
- 存放：`E:\巴拉巴拉\搜索词数据留存\`
- 格式（复刻页面导出）：第 1 行数据说明、第 2 行收藏网址、第 6 行表头（统计日期/搜索词/访客数/加购人数/商品收藏人数/支付买家数/支付转化率/支付金额/客单价/UV价值）、第 7 行起数据；**全部文本单元格**：整数千分位、百分比两位（如 `6.85%`，无数据 `-`）、金额两位千分位（无数据 `0.00`）、客单价/UV 价值两位小数（无数据 `-`）。

### 主表结构（Sheet1，12 列）

| 列 | 内容 | 说明 |
|---|---|---|
| A 统计年份 / B 统计月份 | `=YEAR(C{r})&"年"` / `=MONTH(C{r})&"月"` | 公式+缓存值（`t="str"`，样式 `s="4"`） |
| C 统计日期 | 文本 `YYYY-MM-DD` | 样式 `s="19"` |
| D~L 搜索词及 9 项指标 | 与留档一致的导出文本 | 样式 `s="20"` |

### 拼接与防坑（重要）

- **禁用 openpyxl 整表 load+save**：原表 80,222 行起 A/B 为公式，openpyxl 重存会**丢失公式缓存值**（13,252 行受影响，文件 8.17MB→6.39MB）。
- 正确做法（`zip_merge.py`）：复制原 zip，只改 `xl/worksheets/sheet1.xml` 的 `<dimension ref>` 与在 `</sheetData>` 前插入新行（inlineStr），**其余 zip 条目逐字节复制**。
- 新行 A/B 写完整公式（非共享公式）并带缓存值，避免共享公式范围不覆盖新行。
- 更新后的主表文件名沿用「搜索词留存-更新至X.XX.xlsx」惯例（X.XX = 数据最新日期）。

## 校验口径

1. 留档 xls vs API JSON：行数一致，首/中/末行搜索词与指标一致
2. 新主表新增块 vs 留档：逐行一致（`verify_all.py` 输出 `不一致数 = 0`）
3. 原表区域未变：基准与新版 zip 中 sheet1.xml 前缀/后缀逐字符一致（新增行之前）
4. 新主表可被 openpyxl 正常读取

## 定时任务（每日自动执行）

已创建 cron 定时任务「搜索词每日更新」：每天 **10:20**（Asia/Shanghai，本机环境）拉取 T-1 数据 → 留档 → 拼接 → 校验 → 交付。完整任务契约见 `cron-query.md`。

- **幂等**：拼接前检查最新主表 C 列是否已含 T-1，已含则跳过
- **T+1**：`recordCount=0` 时跳过该日并说明，次日自动补
- **登录态失效**：接口报 5810 时停止，提示用户在专用 Chrome 重新登录生意参谋，不反复空跑

## 相关文件

- `scripts/fetch_drainage.py`：单日分页拉取（可存 JSON）
- `scripts/pipeline_fetch.py`：拉取 → 留档 xls → API JSON（主入口）
- `scripts/zip_merge.py`：ZIP 级 XML 拼接主表
- `scripts/verify_all.py`：留档 vs API、新增块 vs 留档校验
- `cron-query.md`：定时任务 query 原文（自动化执行契约）
