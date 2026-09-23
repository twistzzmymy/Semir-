# 天猫发布页身高排序 - 技术参考

## 页面结构

### 销售属性区域
```
销售属性
├── 颜色分类(N) [排序按钮]
└── 身高(N) [排序按钮]
    └── 销售规格
        └── SKU 表格
            ├── 颜色分类列
            └── 身高列
```

### 关键 DOM 选择器

| 元素 | 选择器 | 说明 |
|------|--------|------|
| 身高模块容器 | `.sell-size-sale-props` | 整个身高销售属性模块 |
| 身高排序按钮 | `.sell-size-sale-props .sort-btn` | 打开排序弹窗的按钮 |
| 排序弹窗 | `.sell-o-sort-dialog` | 尺码排序弹窗 |
| 排序区域 | `.sort-area` | 弹窗中的可拖拽排序区域 |
| 排序项 | `.sort-area .sell-sort-item` | 单个身高项 |
| 确认按钮 | `.footer-confirm` | 弹窗底部的"确认排序"按钮 |
| 取消按钮 | `.footer-cancel` | 弹窗底部的"取消"按钮 |

## React 组件结构

### 排序组件位置
通过 `.sort-area` DOM 元素的 React Fiber 向上查找：

```
.sort-area (div, fiber depth 0)
  └── .sell-o-sort (div, fiber depth 1)
      └── SortComponent (type: "y", fiber depth 2)  ← 目标组件
          ├── props.dataSource: 所有可选身高项
          ├── props.value: 当前排序后的身高数组
          ├── props.onChange: 排序变更回调函数
          └── props.sortOptions: 排序配置
```

### 数据格式
```typescript
// 单个身高项
{
  value: number,    // 身高属性 ID，如 3227230
  text: string,     // 显示文本，如 "73cm"
  remark?: string   // 备注，如 "按扣开襟"
}

// value / dataSource
Array<HeightItem>
```

### React Fiber Key
不同页面/会话的 Fiber key 名称不同，格式为：
```
__reactInternalInstance$<随机字符串>
```
需要动态查找：
```javascript
const keys = Object.keys(sortArea);
const fiberKey = keys.find(k => k.startsWith('__reactInternalInstance'));
```

## 操作流程时序

```
用户请求排序
    ↓
点击 .sell-size-sale-props .sort-btn
    ↓
弹窗打开 (sell-o-sort-dialog)
    ↓
读取 SortComponent.props.value / dataSource
    ↓
按 text 中的数字排序
    ↓
调用 SortComponent.props.onChange(sortedValue)
    ↓
弹窗中顺序更新（验证）
    ↓
点击 .footer-confirm
    ↓
SKU 表格顺序更新（验证）
    ↓
完成
```

## 扩展到颜色分类

如果需要对颜色分类也排序，修改以下内容：

| 项目 | 身高 | 颜色分类 |
|------|------|---------|
| 模块容器选择器 | `.sell-size-sale-props` | `.sale-props-auto-crop-pic-common-wrap` |
| 排序按钮选择器 | `.sell-size-sale-props .sort-btn` | `.sale-props-auto-crop-pic-common-wrap .sort-btn` |
| 排序项选择器 | `.sort-area .sell-sort-item` | 相同 |
| 排序规则 | 按数字从小到大 | 按文本字典序或自定义 |

## 常见问题排查

### 找不到排序组件
1. 确认弹窗已打开（`.sort-area` 存在）
2. 检查 `.sort-area` 上是否有 React Fiber key
3. 增加 Fiber 向上遍历的深度（当前 20 层）

### onChange 调用后顺序没变
1. 确认传入的参数格式正确（数组，每项有 value 和 text）
2. 检查是否找到了正确的组件（可能有多个带 onChange 的组件）
3. 尝试同时更新 dataSource（某些组件需要）

### 点击确认后顺序恢复
1. 说明只修改了 DOM，没有更新 React 状态
2. 确保是通过 `props.onChange()` 而不是直接操作 DOM
