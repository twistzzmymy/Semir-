# Semir Skills

森马电商运营相关的 AI Agent 技能集合。

## 技能列表

| 技能名 | 说明 | 分支 |
|--------|------|------|
| [tmall-height-sorter](https://github.com/twistzzmymy/Semir-/tree/feat/tmall-height-sorter/skills/tmall-height-sorter) | 天猫发布页面身高/尺码模块自动排序工具，通过 React API 实现从小到大自动排序 | `feat/tmall-height-sorter` |

## 技能说明

### tmall-height-sorter

**功能**：自动对天猫发布页面销售属性中的"身高"模块按从小到大重新排序。

**特性**：
- 自动识别当前顺序，无需手动配置
- 通过 React Fiber 定位组件，调用 onChange 安全更新状态
- 幂等操作：如果顺序已正确，自动跳过不做修改
- 完整验证流程：7 步自动执行 + 结果验证

**使用场景**：
- 复制商品后身高顺序乱了，需要重新排列
- 批量发布商品时统一身高排序
- 童装类商品发布时尺码标准化

**文档**：
- [SKILL.md](https://github.com/twistzzmymy/Semir-/blob/feat/tmall-height-sorter/skills/tmall-height-sorter/SKILL.md) - 技能说明文档
- [page-structure.md](https://github.com/twistzzmymy/Semir-/blob/feat/tmall-height-sorter/skills/tmall-height-sorter/references/page-structure.md) - 技术参考文档

## 使用方式

每个 Skill 目录包含：
- `SKILL.md` - 技能说明文档（触发条件、参数、执行流程）
- `scripts/` - 执行脚本
- `references/` - 技术参考文档

## 仓库分支说明

- `master` - 主分支，包含 README 和仓库说明
- `feat/*` - 功能分支，每个技能对应一个功能分支
