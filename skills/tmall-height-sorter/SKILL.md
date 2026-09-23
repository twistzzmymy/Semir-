---
name: tmall-height-sorter
description: 天猫发布页面（sell.publish.tmall.com）销售属性中"身高/尺码"模块的自动排序工具。自动打开排序弹窗、通过 React API 将身高按从小到大重新排列并确认。触发场景：(1) 用户要求对天猫发布页的身高模块排序；(2) 用户说"把身高顺序调一下"、"尺码排序一下"；(3) 复制商品后身高顺序乱了需要重新排列；(4) 批量发布商品时需要统一身高排序。
---

# Tmall Height Sorter（天猫发布页身高模块排序）

## 概览

在天猫商品发布页面（sell.publish.tmall.com），自动对销售属性中的"身高"模块按从小到大顺序重新排序。通过 CDP 连接已打开的 Chrome 浏览器，利用 React 内部 API 安全地完成排序操作，避免手动拖拽的繁琐。

## 前置条件

| 条件 | 说明 |
|------|------|
| Chrome CDP 9222 | Chrome 浏览器以 `--remote-debugging-port=9222` 启动 |
| 页面已打开 | 目标天猫发布页面必须已在浏览器标签页中打开 |
| 已登录 | 必须已登录天猫商家后台（复用浏览器登录态） |
| crawshrimp-skill | 依赖 `browser_executor.py`，可从 `E:\巴拉知识库\自动化\crawshrimp-skill\scripts\` 导入 |

## 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `url_prefix` | 是 | 页面 URL 前缀，用于定位标签页。可以是完整 URL 或唯一部分（如 `id=1086382129962`） |
| `cdp_url` | 否 | CDP 浏览器地址，默认 `http://127.0.0.1:9222` |
| `wait_ms` | 否 | 每步等待时间（毫秒），默认 500ms |

## 执行流程

### Step 1 参数确认
向用户确认：目标页面的 URL 或 URL 中的唯一标识（如商品 id、st_dist_src_id）。

### Step 2 定位标签页
通过 CDP `http://127.0.0.1:9222/json` 获取所有标签页，按 `url_prefix` 匹配目标标签页。
- 如果匹配到多个标签页，取第一个或向用户确认
- 如果没有匹配的标签页，提示用户先打开页面

### Step 3 执行排序脚本
```bash
python scripts/tmall_height_sorter.py \
  --url-prefix "页面URL前缀" \
  [--cdp-url http://127.0.0.1:9222] \
  [--wait-ms 500] \
  [--json]
```

脚本自动执行以下步骤：

| 步骤 | 操作 | 说明 |
|-----|------|------|
| 1 | 点击排序按钮 | 点击身高模块右侧的"排序"按钮，打开排序弹窗 |
| 2 | 读取当前数据 | 通过 React Fiber 找到排序组件的 `value` 和 `dataSource` |
| 3 | 自动排序 | 按身高数字（如 52cm → 52）从小到大自动排序 |
| 4 | 更新状态 | 调用组件的 `onChange` 函数传入排序后的数据 |
| 5 | 验证弹窗 | 确认弹窗中的顺序与预期一致 |
| 6 | 点击确认 | 点击"确认排序"按钮应用更改 |
| 7 | 验证结果 | 检查 SKU 表格中的最终身高顺序 |

### Step 4 输出结果
脚本输出：
- 原始顺序（排序前）
- 最终顺序（排序后）
- 执行状态（成功/失败）
- 错误信息（如有）

## 技术原理

### 为什么不用拖拽？
直接拖拽 DOM 元素不会更新 React 的内部状态，点击确认后会恢复原来的顺序。必须通过调用组件的 `onChange` 函数，让框架自己更新状态和重新渲染。

### React Fiber 定位
1. 在 `.sort-area` DOM 元素上找到 `__reactInternalInstance$xxx` 属性（React Fiber）
2. 沿 Fiber 树向上遍历（通常 2 层），找到带有 `onChange` 和 `dataSource` props 的排序组件
3. 调用 `props.onChange(sortedValue)` 更新排序

### 安全说明
- 只读取和修改当前页面的 React 状态
- 不读取、不复制任何凭证（cookie、token、auth header）
- 排序操作是可逆的，可随时重新调整
- 不涉及提交、发布、保存等危险操作

## 支持的页面类型

- ✅ 天猫发布页 `sell.publish.tmall.com/tmall/publish.htm`
- ✅ 复制商品页面（copyItem=true）
- ✅ 从商品编辑进入的页面（?id=xxx）
- ✅ AI 发布页面（fromAIPublish=true）

## 常见问题

**Q: 提示"No Chrome tab matches URL prefix"？**
A: 目标页面没有在浏览器中打开，或者 URL 前缀不匹配。请先打开页面，或使用更唯一的 URL 片段。

**Q: 排序后顺序没变？**
A: 可能是 React Fiber key 名称变化，或者页面结构更新。检查脚本是否能找到 `.sort-area` 和排序组件。

**Q: 可以同时排颜色分类吗？**
A: 当前只支持身高模块。颜色分类模块的选择器是 `.sale-props-auto-crop-pic-common-wrap`，可参考本脚本扩展。

## 相关文件

- `scripts/tmall_height_sorter.py` - 主执行脚本
- 依赖：`crawshrimp-skill/scripts/browser_executor.py` - CDP 浏览器执行层
