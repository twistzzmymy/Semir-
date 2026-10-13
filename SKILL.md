---
name: tmall-clone-id-publisher
description: 天猫/千牛"克隆ID"批量上新自动化。在售页搜原ID（出售中搜不到自动切"全部"）→ 发布相似品（操作列直出按钮/更多菜单）→ 规避"同类宝贝达到[5]个"（切换类目+品牌巴拉巴拉+货号累加）→ 旧版图文描述文本编辑（返回旧版 scrollIntoView 横纵滚动 + 点击"使用文本编辑" LABEL 选中隐藏 radio）→ 旧描述淘金币图全量清理（含 iframe 直删兜底）→ 销售信息放入仓库 → 身高排序（调用 tmall-height-sorter 脚本）→ 提交（浮动栏按钮+弹窗自动处理）→ success.htm 成功判定+primaryId 提取 → 错误学习库自主迭代 → 新ID回填 Excel。支持 --cdp-url 指定任意 Chrome 实例（新开批量实例用）。触发场景：(1) 用户要求克隆ID/发布相似品/批量上新；(2) 用户给"上新ID/黑名单ID克隆"Excel要求按行发布；(3) 用户说"跑克隆流程""发布181条/279条"等。
---

# Tmall Clone-ID Publisher（克隆ID批量上新）

将已验证跑通的千牛"克隆ID"发布流程固化为通用 SKILL，支持按 Excel 逐行批量执行，并在提交报错时通过**错误学习库**自主迭代解决方案。

## 概览

| 项 | 说明 |
|----|------|
| 目标页面 | 千牛在售页 `myseller.taobao.com` + 天猫发布页 `sell.publish.tmall.com/tmall/publish.htm?copyItem=true` |
| 驱动方式 | CDP 连接已登录 Chrome（默认 9222，`--cdp-url` 可指定新实例如 9223；复用登录态，不重新登录） |
| 核心能力 | 发布相似品、规避同类宝贝上限、旧版文本编辑（旺铺PC详情断点已通）、旧描述淘金币图清理、放入仓库、身高排序、弹窗自动处理、success.htm 成功判定、错误学习 |
| 数据流 | Excel（原ID/货号）→ 逐行发布 → 新ID（success.htm?primaryId=）回填 Excel |
| 参考实现 | 提交按钮/弹窗处理/成功页捕捉参考 `tmall-size_rank-publisher`；身高排序调用 skill 内置 `deps/tmall_height_sorter.py` |

## 前置条件

| 条件 | 说明 |
|------|------|
| Chrome CDP | Chrome 以 `--remote-debugging-port=9222`（或新实例 9223）启动，profile 含千牛登录态 |
| 在售页已打开 | 浏览器中已有 `myseller.taobao.com` 在售页标签 |
| 身高排序依赖 | **必须**调 skill 内置 `deps/tmall_height_sorter.py`（含同目录 `deps/browser_executor.py` 依赖，均已打包；勿调外部/其他 skill 版本，会缺 browser_executor 报 ImportError） |
| Python | openpyxl（Excel 读写）、websockets（CDP） |

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--excel` | 是 | 上新/黑名单 Excel 路径（Sheet1：A=原ID、B=新建id回填、E=货号） |
| `--brand` | 否 | 品牌名，默认 `巴拉巴拉` |
| `--start-row` / `--end-row` | 否 | 处理行区间，默认 2-182 |
| `--dry-run` | 否 | 只执行到"打开编辑页+预判"并输出计划，不点提交 |
| `--yes` | 否 | 授权提交动作（提交属外部生效动作，必须显式授权） |
| `--cdp-url` | 否 | CDP 浏览器地址，默认 `http://127.0.0.1:9222`；新开批量实例传 `http://127.0.0.1:9223` |
| `--report` | 否 | 运行报告 JSON 输出路径 |

**提交授权节奏**：不带 `--yes` 运行 = 完整执行"准备阶段"（搜/开/切类目/图文描述/销售信息/身高排序）并在**提交前停住**（status=needs_authorization），供人工检查勾选；检查无误后加 `--yes` 提交。

## 执行流程（每行一个原ID）

| 步骤 | 操作 | 验证信号 |
|------|------|---------|
| 1 | 在售页搜索原ID（`#queryItemId` 注入+点搜索） | URL 含 `queryItemId=<原ID>` 且列表正文命中 |
| 1a | **搜索兜底**：出售中页签搜不到 → 自动切"全部"页签重搜（黑名单商品可能不在出售中列表） | 全部页签命中 |
| 2 | 关闭 SKU 弹窗（`.closeHotspot`，Esc/aria-close 无效） | 弹窗消失 |
| 3 | 发布相似品：**优先点操作列直出"发布相似品"按钮**；无则"更多"→菜单"发布相似品"→ 新标签页 | 新标签 URL 含 `copyItem=true&st_dist_src_id=<原ID>` |
| 3.5 | **关闭编辑页弹窗**（"商品属性信息更新"→取消；不处理会遮挡身高排序弹窗） | 弹窗消失 |
| 4 | **同类宝贝预判**：表内货号频次≥5 或该货号已被学习到 → 预切类目 | 见步骤 4a |
| 4a | 切换类目（2026-10-09 重写，参考 tmall-category-switch 交互顺序）：点「切换类目」→（可选三级类目如羽绒马甲）→ 品牌点「请选择」combobox 展开→CDP 真实键盘 type「巴拉巴拉」→点下拉叶子 DIV 选项 → 货号 `placeholder='请输入'` 框 click→Ctrl+A→type`<基础货号>-N`→Tab → 点弹窗「确定」→二次确认「确定」。**关键：不用 JS setter 注入（React 不认），必须真实键盘+点选项本体；货号字段在品牌选中后才渲染** | 弹窗关闭、页面跳转 URL 含 catId、基础信息货号=`-N`、当前类目文本正确 |
| 5 | 图文描述 → 旧版文本编辑（**旺铺PC详情断点，多路径组合**，见下"步骤5详解"） | `使用文本编辑` radio `checked=True`、编辑器 ks-editor-iframe 内图片数>0 |
| 5a | **旧描述淘金币图清理**（补丁11/15）：返回旧版后旧描述模块含平台淘金币 banner（多张变体）→ 找"旧描述"行右侧"编辑/展开"按钮点开；**找不到按钮则直接扫所有 ks-editor-iframe 全量删**（兜底） | 命中 `tps-1240-450`/`6000000007501`/`vWMf4v25HV`/1240x450 特征图被删，remaining_promo=0 |
| 6 | 销售信息：**点击"放入仓库"文字**并验证旁侧 radio checked=true（勿用宽泛 radio 误判） | 放入仓库 radio checked=true |
| 7 | 身高排序：调用 `deps/tmall_height_sorter.py`（传 --cdp-url） | 脚本输出排序前后顺序；流程以 JS 检查尺码区顺序递增为准 |
| 8 | 提交（需 `--yes`）：**浮动栏按钮 `.sell-float-bottom button.next-btn-primary`** 优先 → 点击 → **弹窗自动处理**（属性更新→取消/详情升级→确认提交/其他→确定，循环≤5轮）→ 成功判定 | 见下方"成功判定" |
| 9 | 错误处理：命中错误学习库 → 自动应用方案重试；未命中 → 记录未知错误、暂停等待人工 | 学习库更新 |
| 10 | 成功 → **从 URL `success.htm?primaryId=<新ID>` 提取新商品ID** → 回填 Excel B列+D列状态 | Excel 落值 |

### 步骤5详解（图文描述 → 旧版文本编辑，2026-09-29 补丁12/14 实测）

图文描述 tab 激活后，按顺序尝试以下路径，直到 `使用文本编辑` radio `checked=True`：

1. **主路径 A**：找"编辑电脑端详情"按钮（旺铺PC详情模块，y≈838 视口内）→ 滚动到可见 → 点击 → 编辑器打开后 LABEL 渲染。
2. **主路径 B**（row60 实测通用路径）：
   - "返回旧版图文描述"按钮**可能在页面横向滚动区（x≈1487 超视口）+ 纵向视口外（y≈2856）**——**必须 `scrollIntoView({block:'center', inline:'center'})` 同时横纵向滚动**，再 CDP 点击（只纵向滚动点击落空）。
   - 弹窗"确认返回旧版吗"→ 点"确定"（兜底任何"确定/确认"）。
   - 返回旧版后，"使用文本编辑" LABEL 渲染（x≈463, y≈766, 98x18）。
3. **LABEL 点击选中 radio**（关键，测试9 实证）：
   - `使用文本编辑` 是**隐藏 radio**（DOM 链 LABEL > radio-item > sell-radio）；**点击 leaf 文本 / JS click() / change 事件 / React setter 均不选中（checked 恒 false）**——**必须点击 LABEL 祖先元素**。
   - 点击后重查 `checked`，最多 3 轮；LABEL 0 尺寸（隐藏）时先滚动/展开再点。
4. 编辑器懒渲染：滚动到 `scrollHeight*0.5/0.65` 后统计 ks-editor-iframe（取 htmlLen 最大者），旧描述图片数>0。

**验证信号**：`radio_checked=True` + 编辑器 imgs>0（36/44 张）。

### 步骤5a详解（旧描述淘金币图清理，补丁11/15）

- 触发：返回旧版（via=fallback）后，旧描述模块常带**多张**淘金币 banner（不同 CDN 变体，如 `HVynQwwXa_`/`HVymQwwXa_`，src 含 `tps-1240-450.png`/`6000000007501`/`vWMf4v25HV` 或 natural 1240x450）。**只删首图不够**——须全量删除。
- 主路径：定位"旧描述(选填)"文本行 → 同行右侧（y±40、x差>300）"编辑/展开"按钮 → 点击 → 编辑器滚动进视口 → 扫描删除全部特征图。
- **iframe 直删兜底（补丁15，row60 实证）**：主文档找不到"旧描述编辑"按钮时（旧描述图在 ks-editor-iframe 内），**直接扫所有编辑器 iframe 删除全部淘金币特征图**，不依赖按钮。
- 验证：删除后重扫 remaining_promo=0；无特征图时返回 found=False（无需清理，正常）。

### 成功判定（参考 tmall-size_rank-publisher，已实测）

1. 提交后自动处理弹窗（`图文详情编辑器升级`→点"确认提交"；`商品属性信息更新`→点"取消"；其他→"确定/确认/知道了/好的/继续"）
2. 验证：URL 含 `success.htm` 且 `isSuccess=true` → 成功；`primaryId` 参数即**新商品ID**（实测 1086660489122 / 1088078097041）
3. 兜底：页面正文含"提交成功/保存成功/发布成功/操作成功"

## 错误学习库（自主迭代）

错误学习库位于 `knowledge/error_knowledge.md`，脚本每次提交报错后自动查询/记录：

1. **匹配**：按错误关键词/操作码匹配已有条目
2. **应用**：命中已验证条目 → 自动按"解决方案"重试
3. **学习**：未命中 → 自动追加"未知错误"记录（含错误全文/操作码/截图路径），等待人工补充方案
4. **迭代**：人工补充方案后，下次遇到同签名错误自动应用

已内置已验证条目：

| 错误 | 方案 | 状态 |
|------|------|------|
| 同类宝贝达到[5]个（opcode 213e05..） | 切类目+品牌+货号-N → 从图文描述重走 | verified |
| 旺铺PC详情/文本PC详情必填（opcode 213e04..） | 返回旧版（scrollIntoView 横纵滚动）→ 使用文本编辑（点 LABEL 选中 radio） | verified |
| 商品描述校验失败: 非图片空间图片不能使用（淘金币图 `tps-1240-450`，含多变体 HVyn/HVym） | 返回旧版后全量删除旧描述淘金币特征图（含 iframe 直删兜底） | verified |
| 标题过长（预览提示） | 非阻断，忽略 | verified |

## 技术原理与坑位记录

- **切类目品牌交互（2026-10-09 重写）**：旧版用 JS setter 注入品牌名，React 状态不更新、确定按钮恒 disabled。正解=点「请选择」combobox 展开 → CDP `type_text` 真实键盘输入 → 点下拉叶子 DIV 选项（kids=0）。React 接收真实键盘事件后 combobox 才显示品牌名。
- **切类目货号字段延迟渲染**：品牌未选中前，弹窗里不存在货号输入框；必须先完成品牌选择，再找 `placeholder='请输入'` 的 input。**不能按 y 范围盲找**（会误中导购标题/商品卖点输入框）。
- **确定按钮 disabled 解锁条件**：三级类目 + 品牌 + 货号三者齐备后 `disabled=False`；缺任一项保持禁用。
- **切类目二次确认**：点弹窗底部「确定」后还有二次确认弹窗（beforeunload 警告），需再点一次「确定」才真正跳转。
- **类目弹窗货号 ≠ 基础信息货号**：弹窗确定成功后页面刷新，基础信息"*货号"才同步为 `<货号>-N`；判定依据 = 基础信息货号字段。
- **切类目后页面刷新**：需从"图文描述"重新执行（返回旧版→使用文本编辑→销售信息→排序→提交）。
- **CDP 点击前置 mouseMoved**：否则 React 不响应（`cdp_bridge.py` 已内置）。
- **坐标随滚动变化**：所有按钮一律全视口动态定位；视口外元素点击前必须滚动到可见。
- **"返回旧版图文描述"按钮在横向滚动区（x≈1487 超视口）**：只纵向滚动（scrollTo/scroll_to_element）点击落空——必须 `scrollIntoView({block:'center', inline:'center'})` 横纵双滚动（补丁14，row60 实证）。
- **"使用文本编辑"是隐藏 radio，必须点 LABEL 祖先**：点击 leaf 文本、JS click()、派发 change、React setter 均 checked 恒 false——只有 CDP 点击 LABEL（label>radio-item>sell-radio 链）才选中（测试9/补丁10）。
- **"编辑电脑端详情"按钮可能 0 尺寸未渲染**（主路径A 找不到时走主路径B 返回旧版，通用）。
- **旧描述含多张淘金币图变体**：提交报错暴露 `HVymQwwXa_`（与已删首图 `HVynQwwXa_` 不同变体）——clean 已改为删除全部特征图（src 含 tps-1240-450/6000000007501/vWMf4v25HV 或 natural 1240x450）。
- **clean iframe 直删兜底**：主文档找不到"旧描述编辑"按钮时，旧描述图在 ks-editor-iframe 内，直接扫所有编辑器 iframe 删特征图（补丁15，row60 实证无淘金币图=无需清理）。
- **"更多"按钮 x 位置随页签变化**（出售中 x≈1745 / 全部 x≈1737），**不要限定 x 范围**。
- **操作列按钮可能直出**（"全部"页签部分商品直出"发布相似品"），优先直点，失败再"更多"菜单。
- **搜索双验证**：URL 含 queryItemId ≠ 搜到（出售中搜不到时 body 显示"没有数据"），须验证列表正文命中；失败自动切"全部"。
- **radio 定位误判**：勿用"y 范围内任意 radio + label 为空"判断（会误匹配"立刻上架"）；点"放入仓库"文字本身 + 验证同 y 最近 radio。
- **排序前必须关闭其他 publish 页**：排序脚本用 url-prefix startswith 定位标签页，**多个相同前缀标签页会抛 "Multiple Chrome tabs match" 直接失败**，且 --json 模式 returncode 恒为 0（静默失败）——流程已在排序前自动关闭其余 publish 页。
- **排序成功判定 = 流程自行验证页面顺序**：脚本 --json 的 returncode 恒 0 不可信；流程以 JS 检查"尺码信息"区顺序递增为准。
- **提交按钮**：优先 `.sell-float-bottom button.next-btn-primary`（浮动栏），兜底找"提交"文字。
- **成功页**：URL 跳 `success.htm?isSuccess=true&primaryId=<新ID>`；新ID 从 primaryId 提取（勿再用旧 `?id=` 参数——克隆模式下是原ID）。
- **编辑页就绪等待**：打开发布相似品编辑页后必须等页面加载完成（body 出现"图文描述/基础信息"）再操作，否则 desc 步骤在未就绪页面上找不到按钮而静默跳过；流程已在 open_similar 内置轮询（≤30s）。
- **提交后无响应 ≠ 失败**：首次点击提交无错误文案且未跳转成功页时，自动重试提交（≤2次）；若仍无响应但商品实际已创建（如 row78 曾出现），以"仓库中按商家编码搜出商品"兜底判定。
- **myseller 搜索被 overlay 遮罩拦截（2026-10-12，新年季实测）**：页面加载后残留 `.next-overlay-backdrop` 透明遮罩（Fusion overlay），点击 `#queryItemId` 后 `activeElement` 仍是 BODY、type_text 写不进去、URL 不带 queryItemId 参数。正解=搜索前先 `document.querySelectorAll('.next-overlay-backdrop').forEach(el=>el.remove())`，再点击聚焦正常（URL 带 queryItemId + 列表正文命中）。已在 search_origin_id 内置。
- **"使用文本编辑" 0 尺寸 LABEL（2026-10-12，新年季 row2/4/5/6 实测）**：部分商品返回旧版后该 LABEL 为 `w=0,h=0`（隐藏 radio 组，`label>label.next-radio-wrapper>span.next-radio>input`，Fusion 组件）。**坐标点击 (0,0) 无效、点展开无效**；正解=对 `.next-radio`（或 `.next-radio-wrapper`）元素直接派发 `mousedown+mouseup+click` 事件——Fusion 组件即使 0 尺寸也响应，aria/checked `false→true`。已在 goto_desc_old_mode 内置（0 尺寸走事件派发，有尺寸走原 CDP 点击）。
- **"展开"按钮勿选 y 最大者**：编辑页有多个"展开"（图文描述区/物流售后区等），选 y 最大者会点到无关模块；"使用文本编辑"隐藏时先查 LABEL 尺寸，0 尺寸直接走事件派发，不依赖展开。

## 安全边界

- 提交/发布是外部生效动作：默认跳过，必须 `--yes` 才提交；`--dry-run` 全程零副作用；不带 `--yes` 停在提交前供人工检查。
- 脚本只操作当前浏览器标签页（按 URL/ID 精确匹配），不读取任何凭证。
- 回填 Excel 前自动创建备份（`<文件>.bak.xlsx`）。
- 黑名单/双十一 Excel（`E:\巴拉巴拉\...`）不在默认可写目录，回填需相应文件写入权限；Excel 打开占用时无法保存（先关闭）。

## 常用命令

```bash
# 试跑（不提交）：先看计划与预判
python scripts/clone_id_flow.py --excel "E:\巴拉巴拉\ID克隆\上新ID-9.22.xlsx" --dry-run --report dry_run.json

# 单行准备阶段（不提交，停在提交前供人工检查勾选）
python scripts/clone_id_flow.py --excel "E:\巴拉巴拉\AI\ID克隆项目\黑名单ID克隆.xlsx" --start-row 3 --end-row 3 --cdp-url http://127.0.0.1:9223

# 单行授权提交（检查无误后）
python scripts/clone_id_flow.py --excel "E:\巴拉巴拉\AI\ID克隆项目\黑名单ID克隆.xlsx" --start-row 3 --end-row 3 --yes --cdp-url http://127.0.0.1:9223 --report run_row3.json

# 失败行重试（双十一批量）
python scripts/retry_rows.py --rows 60,63,72,78 --yes --report "E:\巴拉知识库\归档\自动化调试\run_retry.json"

# 全量批量（新开实例 9223）
python scripts/clone_id_flow.py --excel "E:\巴拉巴拉\AI\ID克隆项目\黑名单ID克隆.xlsx" --start-row 2 --end-row 280 --yes --cdp-url http://127.0.0.1:9223 --report run_blacklist.json

# 仅切类目模块
python scripts/category_switch.py --tab-id <编辑页id前缀> --huohao-base 208426107207 --seq 2 --cdp-url http://127.0.0.1:9223

# 错误学习库查询
python scripts/error_knowledge.py match "同类宝贝"
python scripts/error_knowledge.py list
```

## 相关文件

- `scripts/clone_id_flow.py` — 主流程（逐行批量，含补丁1-15：desc 多路径/radio LABEL/淘金币全量删/iframe 直删兜底）
- `scripts/retry_rows.py` — 失败行重试入口（--rows 指定行号）
- `scripts/category_switch.py` — 切类目模块（品牌+货号-N）
- `scripts/cdp_bridge.py` — CDP 操作封装（点击前置 mouseMoved、find_text/click_text/scroll_to_element 等）
- `scripts/error_knowledge.py` — 错误学习库读写/匹配/记录
- `knowledge/error_knowledge.md` — 错误学习库（数据）
- 依赖：`deps/tmall_height_sorter.py` + `deps/browser_executor.py`（skill 内置，可移植；clone_id_flow 自动 deps/ 优先、本机路径回退）
- 参考：`.user_skills\tmall-size_rank-publisher\`（提交按钮/弹窗/成功页判定实现来源）
