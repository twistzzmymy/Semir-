---
name: "semir-yunpan-image-download"
description: "森马云盘商品图片批量下载工具。按款号搜索模拍原图目录，筛选文件名含yz/o/ys的图片并按优先级(yz>o>ys)下载。Invoke when user needs to download product images from Semir cloud drive by style codes."
---

# 森马云盘图片下载 Skill

## 概述

本 Skill 用于从森马云盘批量下载商品图片，支持按款号搜索、筛选 yz/o/ys 图片、按优先级排序下载。

## 核心逻辑

### 搜索策略

**关键原则**：按款号定位目录 → 遍历目录筛选图片

1. **搜索款号**：使用 `search` 命令搜索每个款号，找到所有包含该款号的文件路径
2. **提取模拍原图目录**：从搜索结果中筛选路径包含 `/模拍原图/` 的目录
3. **遍历目录**：使用 `ls` 命令列出每个模拍原图目录下的所有文件
4. **筛选图片**：只要文件名包含 `yz`、`o(`、`ys` 就匹配（不区分大小写）
5. **优先级排序**：按 yz > o > ys 排序，每款最多下载 N 张

### 为什么不用关键词直接搜索？

- yz/o/ys 图片文件名（如 `yz(1)-AI.jpg`）不包含款号
- 直接搜索关键词无法关联到具体款号
- 按款号搜索能准确定位到对应目录

## CLI 命令

### 搜索文件

```bash
node dist/cli.js search <关键词> -m <mount_id> -p <云盘路径> --ext image -l 200 -f json
```

### 列出目录

```bash
node dist/cli.js ls <目录路径> -m <mount_id> -l 200 -f json
```

### 下载文件

```bash
node dist/cli.js download <云盘文件路径> -m <mount_id> -o <本地保存路径>
```

## 脚本文件

- **主脚本**：`batch-download.js` — 批量下载所有款号的 yz/o/ys 图片
- **复制脚本**：`copy-images.js` — 将指定款号的图片复制到目标目录
- **补充下载**：`supplement-download.js` — 针对已知目录路径的款号补充下载

## 配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| MOUNT_ID | '2023' | 云盘挂载 ID |
| CLOUD_BASE | '巴拉货控/02 产品上新模块/2-2 巴拉产品上新' | 云盘基础路径 |
| OUTPUT_BASE | './downloads' | 本地输出目录 |
| MAX_PER_CODE | 10 | 每个款号最多下载图片数 |

## 图片匹配规则

只要文件名包含以下任意关键词即匹配（不区分大小写）：

- `yz` — 优先级最高
- `o(` — 优先级中等
- `ys` — 优先级最低

**支持的文件名格式**：
- 标准格式：`yz(1)-AI.jpg`、`o(1).jpg`、`ys(1)-AI.jpg`
- 短格式：`yz-1AI.jpg`、`ys-2ai.jpg`
- 组合格式：`yz(1)&ys(1)&o(1).jpg`、`yz(2)&o(2)-AI.jpg`
- 全角格式：`yz（1）.jpg`、`o（2）.jpg`
- 空格格式：`YZ 1.jpg`、`YS 2.jpg`

## 常见问题

### Q: 搜索款号后找不到模拍原图目录？

**可能原因**：
1. 该款号确实没有模拍原图
2. 搜索结果被平拍原图淹没，需要增加搜索结果数量（`-l` 参数）

**解决方法**：
- 手动在云盘中确认路径
- 使用 `ls` 命令直接遍历已知目录
- 增加搜索结果限制 `-l 500`

### Q: 模拍原图目录存在但没有 yz/o/ys 图片？

**可能原因**：该款号的模拍原图目录中只有普通模特图，没有 AI 生成的 yz/o/ys 图

**解决方法**：属于正常情况，跳过该款号即可

### Q: 下载失败？

**可能原因**：
1. 网络问题
2. 文件权限问题
3. 云盘登录态过期

**解决方法**：
- 检查网络连接
- 重新登录云盘
- 单独执行 `download` 命令测试

## 使用流程

1. 确认 Chrome 浏览器已启动 9222 调试端口并登录森马云盘
2. 确认 `semir-yunpan-cli` 项目已安装依赖并构建
3. 在 `batch-download.js` 中配置款号列表和输出路径
4. 先 dry-run 测试：`node batch-download.js --dry-run`
5. 确认结果后执行实际下载：`node batch-download.js`
6. 如需复制到指定目录，使用 `copy-images.js`
