# 前端重设计规格（v1）

> 目标：把 demo 前端重构为「亮色企业风 + 左侧栏 + 统一 findings 收件箱」的现代扁平界面。
> 本规格最初只改前端；迁移到 Ontology 后，前端位于应用根目录的 `src/`，后端 API 契约不变。
> 上游：`../docs/design-plan.md`、本目录 `00-master-spec.md`（功能验收不变）。
> 本文件描述已实现参考 Demo 的界面，不是新目标系统设计页面；目标设计 UI 位于
> `../docs/system-design/index.html`，由目标注册表直接驱动。

## 设计决策（核心：双语义轴分通道）

应用有两条语义轴，必须分占不同视觉通道，永不抢同一通道：

| 轴 | 通道 | 编码 |
|---|---|---|
| **严重度**（有多糟） | **填充色** | violation→`--sev-violation`(红 rose-600)、warning→`--sev-warning`(琥珀 amber-500)、info→`--sev-info`(蓝 sky-600) |
| **权限**（谁说的/多大权力） | **图标 + 边框**，不用填充 | veto→盾形图标(`ShieldX`)+实心；score→默认无饰；advise→`Scale`(⚖)图标 + 左侧 `--authority-advise`(violet-500) 描边 |

常驻图例组件（Legend）解释两轴；颜色含义全局唯一、可学习。

## 视觉 token（亮色企业风）

CSS 变量定义于 `src/styles/tokens.css`，亮/暗两套（亮色优先，暗色后续）：

- 背景 `--bg`：`#f8fafc`（slate-50）；表面 `--surface`：`#ffffff`；边框 `--border`：`#e2e8f0`
- 文本 `--fg`/`--fg-muted`/`--fg-subtle`：slate-900/600/400
- 强调 `--accent`：`#4f46e5`（indigo-600，企业可信）；`--accent-fg`：白
- 圆角 `--radius`：8px（中度，非 pill）；阴影：极轻（`0 1px 2px rgba(15,23,42,.06)`）
- 等宽 `--font-mono`：标识符/IR/反例（沿用现有习惯）

## 技术栈

- Tailwind v4（`@tailwindcss/vite` 插件 + CSS-first `@import "tailwindcss"`，token 用 `@theme` 暴露）
- shadcn 风格**手写原语**（不跑 shadcn CLI，离线可复现）：cva 管变体 + clsx/tailwind-merge 合并类 + lucide-react 图标 + Radix（Dialog/Sheet、Tooltip、Tabs、DropdownMenu）管可访问性
- 保留 cytoscape、echarts；重新配色到亮色企业风
- 路由：轻量 hash 路由或 state 驱动（无需引 react-router，规模小）

## 信息架构（左侧栏 + 统一收件箱）

左侧栏分区：**总览 / 收件箱(findings) / 本体 / 规则 / 流程 / 注入实验室 / 写入闸门**；
顶部运行上下文条：数据集切换 + ▶运行全管线 + run 状态 + judge 后端(live/cassette) 徽章。

### 收件箱（新中心件，AC-UI-INBOX）
- 全部 finding 汇聚一处；筛选维度：severity、层(V0–V5)、对象类型、judge verdict、status；分组可切换（按类型/按对象/按层）
- 左列表 + 右 detail 抽屉(Sheet)：消息、locus、证据、judge 复判(verdict/置信度/rationale)、修复建议
- judge 已确认(confirm∧conf≥τ)项默认折叠，可展开；顶部「人工成本节约」头条
- 行内动作：accept / dismiss / accept_repair → 落 `review_actions`（沿用现有 API）

## UI 验收准则（AC-UI-*，对应 pytest 之外的手验/构建验收）

| AC | 准则 |
|---|---|
| AC-UI-BUILD | `pnpm build:validation` 通过；产物由后端静态托管，六分区可达 |
| AC-UI-LEGEND | 严重度=填充、权限=图标+边框 两轴在图例与所有 finding 呈现处一致 |
| AC-UI-INBOX | 收件箱可对全部 finding 做筛选/分组/triage，三类动作落库 |
| AC-UI-GRAPH | 本体 Cytoscape / 流程图 / 注入热力图 在亮色主题下清晰，违例与 judge 来源高亮可辨 |
| AC-UI-COST | 成本节约头条与 judge 折叠在收件箱/仪表盘一致呈现 |
| AC-UI-PARITY | 旧六页全部功能在新 UI 可用，无 API 契约变更 |
