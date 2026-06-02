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
AI Studio 应用迁移说明

本分支用于承载从 Google AI Studio 导出的模拍主图识别应用。

应用代码位于：

```text
app/

本地运行方式：

cd app
npm install
npm run dev

环境变量：

GEMINI_API_KEY=你的 Gemini API Key

注意：

.env 文件不要提交到 GitHub。

---

# 十一、常见问题处理

## 问题 1：`git checkout feature-modelshot-v1-20260602` 报错

可能原因：

本地还没有拉取远程分支。

解决：

```bash
git fetch origin
git checkout -b feature-modelshot-v1-20260602 origin/feature-modelshot-v1-20260602
