# Semir-
用于主ID检视及模拍主图判定的仓库
背景：对每周上新款进行上新检视，即对相关产品（产品线群中的主ID确认文件——待各品类bu确认主ID）进行上架后商品情况检查，维度主要包括：
基础信息：款号、主ID、次ID、上新批次、上新时间、产品季、产品线、性别、品类、货品属性
勾选项：标题、主图logo、BO投放、产品参数准确、商品属性
导购标题:IF(lenb([表一]Sheet1!导购标题$)>28,TURE,FALSE)
标题：IF(lenb([表一]Sheet1!标题$)>58,TURE,FALSE)
透明素材图：=HasPicture([表一]Sheet1!透明素材图$)
此公式使用前需alt+F11打开VBA，插入模块粘贴：
Function HasPicture(rng As Range) As Boolean
    Dim pic As Picture
    For Each pic In rng.Parent.Pictures
        If Not Intersect(pic.TopLeftCell, rng) Is Nothing Then
            HasPicture = True
            Exit Function
        End If
    Next pic
    HasPicture = False
End Function

模拍主图：
判断1：1主图或3：4主图是否为模拍主图（都需要有）

颜色图：IF（[表二]Sheet1!SKU规格图$=模拍图 and 产品线="服装" and 匹配结果$=TURE,TURE，FALSE）
匹配结果：Iferror(vlookup([表二]Sheet1!商家编码,[#产品季#上市计划表]商品信息!唯一码$:规格$,#颜色列/尺码列#，0),FALSE,TURE)
99码准确：尺码匹配为TURE
颜色与99码都是与对应批次上市计划表商品信息进行匹配校对

表一


表二
    
RPA逻辑：
主流程：
下载产品线工作一张表：
下载表一
表二
主图链接
一张表填写公式标题公式并下拉填充
调用流程一（模拍主图）：
打开主图链接
打开https://ai.studio/apps/0698cea2-81d4-4f04-a2fe-2a836feff76d
上传文件开始识别
下载完成匹配结果于产品线工作一张表中
调用流程二：
拉取ID质量分情况，若两分均为100输出TRUE，否则为FALSE
调用流程三：
写入钉钉多维表
标题
导购标题
模拍主图
质量分

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