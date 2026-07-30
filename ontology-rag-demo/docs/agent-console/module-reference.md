# Agent Console 目标模块、协议与接口速查

状态：已按 Runtime 架构实现

## 1. 模块 → 功能

### 1.1 Agent Console 服务端

| 目标模块 | 功能 |
| --- | --- |
| `server/profile.ts` | 加载可分享 Profile Package，校验其完整性和相对路径 |
| `server/dataset.ts` | 发现 `datasets/<id>/dataset.yaml`，校验根级本体文件和可选 `raw_data/` |
| `server/runtime-catalog.ts` | 原子重载源 Catalog，串行维护 Runtime manifest/status，生成脱敏 Web Catalog |
| `server/runtime-initializer.ts` | Profile/Dataset 快照复制、Initializer job、staging 原子提升 |
| `server/runtime-supervisor.ts` | 管理 Initializer 及供 ACP/CLI 共用的有界进程组终止 |
| `server/runtime-delete.ts` | 删除锁、停止顺序、canonical path gate、trash rename 与清理恢复 |
| `server/mutation-drain.ts` | shutdown 前拒绝新 HTTP mutation 并排空已接受操作 |
| `server/opencode-runtime.ts` | 构建 Runtime 最小环境、OpenCode DB/config 和固定 workspace cwd |
| `server/bridge.ts` | `WS /runtimes/:id/acp` 与 OpenCode stdio NDJSON 转发 |
| `server/session-delete.ts` | 只删除指定 Runtime OpenCode DB 中的 Session |
| `server/index.ts` | Profile/Dataset/Runtime HTTP API、静态 UI 与 WebSocket upgrade |

实现时可以合并小文件，但职责边界不能重新混入单个“万能 Runtime manager”。

### 1.2 Web 前端

| 目标模块 | 功能 |
| --- | --- |
| `stores/catalog.ts` | Profile/Dataset 创建 Catalog |
| `stores/runtime.ts` | 已创建 Runtime、初始化/删除状态和刷新 |
| `stores/session.ts` | `Runtime → ACP client` 与 `(Runtime, Session) → Conversation` |
| `components/RuntimeSidebar.vue` | 只显示 Runtime 分组及其 Session |
| `components/CreateRuntimeDialog.vue` | 选择尚未创建的 Profile × Dataset 组合并调用 Initializer |
| `components/RuntimeInfoCard.vue` | 脱敏 Profile/Dataset/revision/摘要/状态 |
| `components/DeleteRuntimeDialog.vue` | 与 Session 删除明确分离的危险确认 |
| `lib/runtime-api.ts` | `/profiles`、`/datasets`、`/runtimes` 和删除请求 |
| `lib/acp-bridge.ts` | 浏览器 ACP JSON-RPC lifecycle |
| `lib/session-projection.ts` | ACP `session/update` → 当前 Conversation |
| `lib/query-plan-projection.ts` | `data-query-plan.v1` → 纯展示 Graph |
| `components/QueryPlanCard.vue` | JSON/Graph 切换，不修改 Agent 原文 |
| `components/OntologySubgraphCard.vue` | Tool 实际返回的本体子图；不与 Query Plan Graph 混用 |

### 1.3 Profile 与共享 Python 环境

| 模块 | 功能 |
| --- | --- |
| 根 `pyproject.toml` / `uv.lock` | 所有 Profile 共用的唯一 Python 环境和依赖版本 |
| `profiles/<id>/profile.yaml` | 完整测试流清单 |
| `profiles/<id>/tools/`、`skills/` | Agent 可调用实现 |
| `profiles/<id>/retrieval/` | Profile 自带的 Retrieval 实现 |
| `profiles/<id>/tests/` | Profile 自包含测试 |
| `datasets/<id>/` | 独立本体和可选 `raw_data/` |

## 2. 数据协议

| 协议 | 权威内容 |
| --- | --- |
| Profile manifest v2 | Agent、OpenCode、Initializer、Skill、Retrieval 和 Dataset 输入契约 |
| Dataset manifest v1 | Dataset ID、显示信息、根级本体文件、可选 `raw_data/` |
| Runtime manifest v1 | `<profile>--<dataset>`、创建时标题、快照摘要、相对运行路径、状态和脱敏错误 |
| ACP JSON-RPC/NDJSON | Session 创建/加载/Prompt/Cancel、消息、Tool、Permission |
| `ontology.subgraph` | Profile Tool 实际返回的本体子图 artifact；算法与实现标识分开记录 |
| `data-query-plan.v1` | Agent 最终查询计划原文 |
| Query Plan Graph | 由查询计划字段生成的临时 UI 投影，不是持久协议 |

层级键：

```text
Runtime ID:   <profile-id>--<dataset-id>
Conversation: <runtime-id>:<session-id>
Runtime root: ontology-rag-demo/.runtime/projects/<runtime-id>
OpenCode cwd: <runtime-root>/workspace
```

## 3. HTTP/WS/ACP 接口

### 3.1 Agent Console

| 接口 | 作用 |
| --- | --- |
| `GET /health` | Console、Runtime supervisor 和 cleanup 安全摘要 |
| `GET /profiles` | 原子重载并返回可创建 Runtime 的脱敏 Profile Catalog |
| `GET /datasets` | 原子重载并返回可创建 Runtime 的脱敏 Dataset Catalog |
| `GET /runtimes` | 已创建及有可见失败状态的 Runtime |
| `POST /runtimes` | 选择 `profile_id + dataset_id`，异步调用 Initializer |
| `DELETE /runtimes/:runtimeId` | 停止进程、校验路径、原子移入 trash |
| `WS /runtimes/:runtimeId/acp` | Runtime 专属 ACP 通道 |
| `DELETE /runtimes/:runtimeId/sessions/:sessionId` | Runtime 内 OpenCode Session 删除 |

### 3.2 ACP

```text
initialize
session/list
session/new
session/load
session/prompt
session/cancel
authenticate
session/update
session/request_permission
```

Session 是 Runtime 的 OpenCode 子资源。浏览器不能用 ACP 改变 Runtime 的 Profile、
Dataset、cwd 或 Model。

## 4. Runtime 文件操作边界

初始化：

```text
Profile source + Dataset source
    → validated file copy
    → .runtime/staging/<id>--<nonce>
    → Profile Initializer
    → atomic rename
    → .runtime/projects/<id>
```

删除：

```text
exclusive lock
    → stop init/ACP process trees
    → validate canonical target
    → atomic rename
    → .runtime/trash/<id>--<timestamp>--<nonce>
    → validated background cleanup
```

允许递归删除的唯一目标是已经原子移入 canonical `trash/` 的直接子目录。Profile、
Dataset、根 uv 环境和其他 Runtime 永远不是删除目标。

## 5. Query Plan Graph 映射

| JSON 字段 | 展示投影 |
| --- | --- |
| `query_tasks[i]` | Task hub |
| `targets[]` | Entity 节点；Task → Entity `target` |
| `projections[]` | Entity 节点；Task → Entity `projection` |
| `filters[]` | Filter note；Task → Filter `filter` |
| `joins[]` | `from` → `to`，边标签 `relation` |
| `ontology_evidence[]` | `subject` → `object`，边标签 `predicate`，evidence 样式 |

相同实体字符串合并并保留角色集合。Graph 不调用检索工具、不推断关系、不修改 JSON；超过
120 节点或 240 边时禁用 Graph，继续显示完整 JSON。
