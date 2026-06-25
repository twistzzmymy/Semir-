# 森马云盘 CLI

面向用户和 AI agent 的森马云盘命令行客户端。它复用你已经登录的 Chrome CDP `9222` 会话，在页面上下文里调用森马云盘自己的接口，重点解决：

- 搜款号：按货号查找包装图、平拍/模拍/创意拍、PSD/AI/CDR 源文件、PDF/尺码表等。
- 搜图包：按路径关键词、扩展名、目录规则筛选图片资产。
- 按路径找图：给完整云盘路径，解析文件信息、临时预览链接或临时下载链接。
- 批量下载：复用抓虾已跑通的 SPU/SKC 搜图、去重、代表图、命名规则。
- 深绘上新：复用抓虾“整理深绘上新图包”的款号文件夹定位、模特图/静物图 SOP 过滤、yq 命名和下载计划规则。
- 给 agent 稳定输出：支持 `json` / `ndjson` / `csv` / `md` / `table`。

## 安装与运行

```bash
cd semir-yunpan-cli
npm install
npm run build
node dist/cli.js --help
```

开发期也可以直接：

```bash
npm run dev -- style 208326133201 --limit 10 -f table
```

默认连接：

- CDP: `http://127.0.0.1:9222`
- 页面前缀: `https://fmp.semirapp.com`
- 默认库: `mount_id=2023`（当前探查到的“巴拉营运BU-商品”）

可用环境变量：

```bash
SEMIR_YUNPAN_CDP_URL=http://127.0.0.1:9222
SEMIR_YUNPAN_URL_PREFIX=https://fmp.semirapp.com
SEMIR_YUNPAN_LOGIN_URL=https://fmp.semirapp.com/web/index#/home/file
SEMIR_YUNPAN_LOGIN_TIMEOUT=300
```

## 登录态

CLI 默认复用 `9222` 端口的 Chrome。执行任意命令时：

1. 如果 9222 里已经有森马云盘页面，会直接复用。
2. 如果没有森马云盘页面，会在同一个 9222 浏览器打开 `SEMIR_YUNPAN_LOGIN_URL`。
3. 如果尚未登录，会提示你在打开的页面完成登录，并轮询 `/fengcloud/1/account/mount` 直到登录态可用或超时。

```bash
# 主动打开/检查登录态
npm run dev -- login -f json

# 调整等待时间
npm run dev -- --login-timeout 600 mounts -f table
```

## 常用命令

```bash
# 列出可见云盘库
npm run dev -- mounts -f table

# 列当前库根目录
npm run dev -- ls --mount 2023 -f table

# 搜款号，按图包/源文件/图片规则排序
npm run dev -- style 208326133201 --limit 20 -f table

# 搜款号并按最近款号目录/图包目录分组
npm run dev -- style 208326133201 --groups -f json

# 只搜图片和设计源文件扩展名
npm run dev -- search 208326133201 --ext image --limit 30 -f json

# 限定路径搜索
npm run dev -- search 208326133201 --path "巴拉货控/02 产品上新模块" --limit 20

# 解析完整路径
npm run dev -- info "巴拉货控/.../208326133201.jpg" -f json

# 输出临时预览链接
npm run dev -- preview-url "巴拉货控/.../208326133201.jpg" -f json

# 输出临时下载链接，不自动下载
npm run dev -- download-url "巴拉货控/.../208326133201.jpg" -f json

# 下载单个文件
npm run dev -- download "巴拉货控/.../208326133201.jpg" -o ./downloads

# 抓虾同款批量搜图下载：SPU 默认匹配“款号-五位色码”图片
npm run dev -- download-images \
  --cloud-path "巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/" \
  --codes "208226111002,208226111002-00316" \
  -o ./downloads \
  -f table

# 只看计划，不获取临时下载 URL，不落盘
npm run dev -- download-images \
  --cloud-path "巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/" \
  --codes-file ./codes.txt \
  --dry-run \
  -f json
```

## 抓虾规则

批量图片命令沿用抓虾项目 `adapters/semir-cloud-drive` 中已跑通的核心规则：

- 云盘路径格式：`挂载点//目录/子目录`，例如 `森马视觉//01-拍摄企划/.../模拍/`。
- 输入编码支持换行、逗号、顿号、分号分隔，并自动去重。
- `款号` / SPU：默认只匹配文件名 stem 为 `款号-五位色码` 的图片，例如 `208226111002-00316.jpg`。
- `款色` / SKC：只匹配文件名 stem 与完整 SKC 完全一致的图片。
- `--duplicate-mode first_per_stem` 默认同名/同编码只保留一张；`all` 保留全部。
- `--spu-match-mode representative` 会为 SPU 保留一张代表款色图，并按款号命名。
- 搭配购和 6.24 新规则的底层命名判断已沉淀在 `src/rules.ts`，后续可以继续扩成专门命令。

深绘上新图包能力沿用抓虾项目 `adapters/shenhui-new-arrival/prepare-upload-package.js` 的核心规则：

- 从静物图/平拍路径和模特图/模拍路径分别定位款号文件夹。
- 搜索结果优先作为款号文件夹定位器，再递归列目录，不把普通直接命中图片当成唯一来源。
- 模特图过滤包装图、白底图、`m` 开头图、吊牌/卡头/水洗类图。
- 静物图过滤 `.psd`、包装图、卡纸/手写类图；吊牌/水洗图命名为 `yq.*`。
- 洗唛/吊牌 PDF 保留为 `pdf_yq` 计划项，后续可接 PDF 截图能力。

## 能力协议

`run <capability>` 是给 AI agent 组合调用的统一入口。输入必须是 JSON object，可用 `--input-json`、`--input-file` 或 stdin；输出统一为：

```json
{
  "capability": "path.parse",
  "ok": true,
  "data": {}
}
```

列能力：

```bash
npm run dev -- run capabilities.list -f json
```

典型原子链路：

```bash
# 1. 解析云盘路径
npm run dev -- run path.parse --input-json '{"cloudPath":"巴拉营运BU-商品//巴拉货控/02 产品上新模块"}' -f json

# 2. 解析挂载点
npm run dev -- run mount.resolve --input-json '{"mountName":"巴拉营运BU-商品"}' -f json

# 3. 搜索文件
npm run dev -- run files.search --input-json '{"mountId":2023,"query":"208326133201","limit":20}' -f json

# 4. 按 SPU/SKC 图片规则生成下载计划，不获取 URL
npm run dev -- run downloads.plan-images --input-json '{"cloudPath":"巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/","codes":["208326133201"],"includeDownloadUrls":false}' -f json

# 5. 整理深绘上新图包计划
npm run dev -- run shenhui.plan-package --input-json '{"codes":["208226103201"],"sourceTypes":["still"],"stillCloudPath":"巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/2026年巴拉夏/平拍原图/2P/婴幼童/幼童-2.5已写/","includeDownloadUrls":false}' -f json
```

当前注册的核心能力：

- `session.probe`
- `path.parse`
- `codes.normalize`
- `mount.resolve`
- `files.list`
- `files.search`
- `files.info`
- `urls.download`
- `urls.preview`
- `rules.filter-images`
- `downloads.plan-images`
- `downloads.run`
- `shenhui.classify-asset`
- `shenhui.plan-package`

## 输出约定

`search` / `ls` 输出核心列：

- `filename`
- `fullpath`
- `isDir`
- `ext`
- `filesize`
- `lastTime`
- `lastMemberName`
- `mountId`

`style` 会额外输出：

- `score`
- `kind`: `folder` / `image` / `source` / `pdf` / `document` / `other`
- `assetRole`: `packageImage` / `flatImage` / `modelImage` / `creativeImage` / `sourceFile` / `specSheet` 等

## 安全边界

默认命令只读取列表、搜索、信息和临时 URL。`download` / `download-images` 只把显式匹配到的文件下载到本地，不会上传、删除、移动、重命名、分享或提交任何外部可见变更。

临时预览/下载 URL 带签名和过期时间，只在当前命令内使用或按显式 `download-url` 输出，不写入测试 fixture 或仓库文档。

## 验证

```bash
npm test
npm run typecheck
npm run build
```
