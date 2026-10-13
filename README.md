# Semir-
存放关于相关工作流的SKILL及脚本的仓库

## 森马云盘 CLI

面向用户和 AI agent 的森马云盘命令行客户端。它复用你已经登录的 Chrome CDP `9222` 会话，在页面上下文里调用森马云盘自己的接口，重点解决：

- 搜款号：按货号查找包装图、平拍/模拍/创意拍、PSD/AI/CDR 源文件、PDF/尺码表等。
- 搜图包：按路径关键词、扩展名、目录规则筛选图片资产。
- 按路径找图：给完整云盘路径，解析文件信息、临时预览链接或临时下载链接。
- 批量下载：复用抓虾已跑通的 SPU/SKC 搜图、去重、代表图、命名规则。
- 深绘上新：复用抓虾“整理深绘上新图包”的款号文件夹定位、模特图/静物图 SOP 过滤、yq 命名和下载计划规则。
- 给 agent 稳定输出：支持 `json` / `ndjson` / `csv` / `md` / `table`。

### 安装与运行

```bash
cd semir-yunpan-cli
npm install
npm run build
node dist/cli.js --help
```

### 常用命令

```bash
# 列出可见云盘库
npm run dev -- mounts -f table

# 搜款号
npm run dev -- style 208326133201 --limit 20 -f table

# 下载单个文件
npm run dev -- download "巴拉货控/.../208326133201.jpg" -o ./downloads
```

### 批量下载脚本

- `batch-download.js` / `batch-download-new.js`：模拍原图批量下载（yz/o/ys）
- `shoes-download.js`：鞋品图包批量下载（1440_1440）
- `copy-images.js`：图片复制脚本
- `supplement-download.js`：补充下载脚本

### SKILL

- `skills/semir-yunpan-image-download/`：模拍原图下载 Skill
- `skills/semir-shoes-package-download/`：鞋品图包下载 Skill
- `skills/search-term-daily/`：搜索词每日查询 Skill
- `skills/tmall-size_rank-publisher/`：天猫商品尺码排序批量提交 Skill
- `skills/tmall-clone-id-publisher/`：天猫/淘宝「发布相似品」克隆ID批量上新 Skill

### tmall-clone-id-publisher（克隆ID批量上新）

基于 CDP 直连已登录 Chrome 的千牛/天猫发布 RPA：在售页搜索原ID → 「发布相似品」打开编辑页（copyItem）→ 规避"同类宝贝达到[5]个"（自动切换类目 + 品牌巴拉巴拉 + 货号 `-N` 递增重试）→ 图文描述旧版文本编辑（返回旧版横纵滚动 + "使用文本编辑"隐藏 radio 事件派发）→ 旧描述淘金币促销图全量清理（含 iframe 直删兜底）→ 勾选「放入仓库」→ 身高/尺码排序（内置 `deps/tmall_height_sorter.py`）→ 提交（浮动栏按钮+弹窗自动处理）→ success.htm 抓取新ID 回填 Excel。

- 入口：`skills/tmall-clone-id-publisher/scripts/clone_id_flow.py`
- 依赖：Python `websockets` + `openpyxl`；已登录淘宝卖家中心的 Chrome（`--remote-debugging-port=9222`）
- 错误自愈：提交报错自动查询 `knowledge/error_knowledge.md` 错误学习库，命中按已验证方案重试，未命中自动记录待补方案（ERR-001~007 已固化）
- 详见：`skills/tmall-clone-id-publisher/README.md`
