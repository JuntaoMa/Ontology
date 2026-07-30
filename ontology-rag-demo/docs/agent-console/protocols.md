# Agent Console 配置与数据协议

状态：Runtime 协议已实现

## 1. Profile Package

Profile 是可打包分享的完整测试流实现，不能绑定具体 Dataset。一个 Profile 目录可以
按需包含：

```text
profiles/<profile-id>/
├── profile.yaml
├── README.md
├── opencode/
├── skills/
├── tools/
├── retrieval/
├── schemas/
└── tests/
```

所有运行路径必须留在 Profile 根内，不允许 `../_shared`、symlink 或仓库外绝对路径。
Profile 可以依赖根 uv 项目提供的通用库，但不能携带第二个虚拟环境。
Profile v2 不声明常驻 sidecar；Initializer 必须是有限任务，长期服务需要未来的显式
endpoint/readiness 协议。

目标 Profile manifest 示例：

```yaml
schema_version: 2
id: ontology-retrieval
revision: dev
title: 检索增强本体上下文
description: 使用实体 Top-K 与近似 Steiner 连通子图生成查询计划。

agent:
  command: opencode
  args: [acp, --print-logs, --pure]
  startup_timeout_ms: 15000

opencode:
  config: opencode/opencode.jsonc
  assets:
    - opencode/prompt.md

initializer:
  command: uv
  args:
    - run
    - --project
    - ${ONTOLOGY_DEMO_ROOT}
    - --locked
    - --no-sync
    - python
    - ${ONTOLOGY_PROFILE_DIR}/tools/initialize.py
  timeout_ms: 900000

model:
  id: deepseek/deepseek-v4-flash
  source: opencode
  auth:
    source: opencode

skills:
  - id: ontology-retrieval
    path: skills/ontology-retrieval

retrieval:
  vector_top_k: 5
  graph_algorithm: minimum_connected_subgraph

dataset_contract:
  ontology: required
  raw_data: optional
```

`${...}` 只允许服务端登记的运行变量；不是 shell 插值。命令始终以参数数组启动。

Profile 不声明：

- 具体本体 ID、文件名或路径；
- Dataset ID；
- Runtime 路径；
- 密钥值；
- LanceDB 实例路径；
- OpenCode Session 数据库路径。

## 2. Dataset

Dataset 只有两级目录：

```text
datasets/<dataset-id>/
├── dataset.yaml
├── building.ttl
└── raw_data/       # 可选
```

不使用 `datasets/public` 或 `datasets/private`。Catalog 只发现
`datasets/<dataset-id>/dataset.yaml`。

```yaml
schema_version: 1
id: smart-building
title: Smart Building Sample
description: 可提交的虚构楼宇本体。
ontology_file: building.ttl
raw_data_dir: raw_data
```

规则：

- `id` 必须与目录名一致，只允许小写字母、数字和连字符。
- `ontology_file` 必须是 Dataset 目录直接子文件，不能位于子目录。
- `raw_data_dir` 若存在，只能是 Dataset 目录下的 `raw_data/`。
- Dataset 目录内不允许 symlink、设备文件或路径穿越。
- Catalog 返回 ID、标题、描述和安全摘要，不返回绝对路径。
- 敏感 Dataset 通过精确 Git ignore/exclude 管理，不由目录类型推断。

## 3. Runtime Manifest

Runtime 是 Profile/Dataset 创建时的本地快照，目录名和 ID 固定为：

```text
<profile-id>--<dataset-id>
```

Runtime manifest 位于：

```text
.runtime/projects/<runtime-id>/runtime.yaml
```

```yaml
schema_version: 1
id: ontology-retrieval--smart-building
display_name: 检索增强本体上下文 · Smart Building Sample
status: ready
created_at: 2026-07-30T10:00:00Z

profile:
  id: ontology-retrieval
  title: 检索增强本体上下文
  revision: dev
  snapshot_sha256: "<64 hex>"

dataset:
  id: smart-building
  title: Smart Building Sample
  ontology_file: building.ttl
  snapshot_sha256: "<64 hex>"
  ontology_sha256: "<64 hex>"

paths:
  workspace: workspace
  profile: workspace/profile
  dataset: workspace/dataset
  generated: workspace/generated
  opencode_db: opencode/opencode.db
  opencode_config: opencode/config
  state: state

last_error: null
```

Manifest 中的路径全部是 Runtime 根下的规范相对路径。删除逻辑不能把这些字段当成任意
文件系统目标。

`profile.title` 与 `dataset.title` 固化创建时的显示标题，新建 Runtime 必须写入；旧版
manifest 可缺少它们，读取时依次回退到 Runtime 内快照标题和 ID。公开 Runtime 描述也
来自 Runtime 内已校验快照，而不是当前源 Catalog。

`profile.snapshot_sha256` 与 `dataset.snapshot_sha256` 表示创建时的源目录快照摘要。
Profile Initializer 可以在 Runtime 副本内生成 Prompt 等派生文件，因此运行后的
`workspace/profile/` 不要求继续等于源 Profile 摘要；Dataset 快照和本体摘要在
Initializer 前后都必须保持一致。

### 3.1 Runtime 状态

| 状态 | 含义 | 可创建 Session |
| --- | --- | --- |
| `initializing` | 正在复制快照或运行 Initializer | 否 |
| `ready` | 已物化，未连接 ACP | 是 |
| `active` | ACP 正在运行 | 是 |
| `initialization_failed` | Initializer 失败或启动时发现中断的 staging | 否 |
| `deleting` | 已取得删除锁，正在停止进程/提交 rename | 否 |
| `delete_failed` | 删除提交前失败，Runtime 仍保留 | 否，先处理或重试删除 |

`cleanup_failed` 属于 trash 清理状态，不是可恢复 Runtime 状态。

### 3.2 运行变量

Runtime Manager 注入：

```text
ONTOLOGY_DEMO_ROOT
ONTOLOGY_RUNTIME_ID
ONTOLOGY_RUNTIME_ROOT
ONTOLOGY_WORKSPACE_DIR
ONTOLOGY_PROFILE_DIR
ONTOLOGY_DATASET_DIR
ONTOLOGY_GENERATED_DIR
ONTOLOGY_RUNTIME_STATE_DIR
ONTOLOGY_PATH
ONTOLOGY_ID
ONTOLOGY_EXPECTED_SHA256
OPENCODE_DB
OPENCODE_CONFIG_DIR
```

值来自已校验的 Runtime 快照，不接受浏览器覆盖。

## 4. Catalog 与 Runtime HTTP 接口

### `GET /profiles`

返回可用于创建 Runtime 的 Profile Catalog：

```json
{
  "profiles": [
    {
      "id": "ontology-retrieval",
      "revision": "dev",
      "title": "检索增强本体上下文",
      "description": "使用实体 Top-K 与近似 Steiner 连通子图生成查询计划。"
    }
  ]
}
```

每次请求都会重新发现并完整校验 `profiles/`。只有新 Catalog 全部校验成功才原子替换
进程内 Catalog；失败请求返回错误，之前的有效 Catalog 保持不变。并发重载合并为同一
次读取。Profile 与 Dataset 分别提交，不构成跨 Catalog 事务。

### `GET /datasets`

```json
{
  "datasets": [
    {
      "id": "smart-building",
      "title": "Smart Building Sample",
      "description": "可提交的虚构楼宇本体。",
      "ontology_sha256": "<64 hex>"
    }
  ]
}
```

与 Profile 一样，每次请求都会原子重载完整 `datasets/`；任何条目失败都不会发布半套
Catalog。Catalog 替换后，现有 Runtime 的 `stale` 会按新源摘要重新计算。服务端不做
文件监听，`GET /runtimes` 和 `POST /runtimes` 本身也不触发源 Catalog 重载；直接调用
HTTP API 新建组合前，应先请求相应的 `/profiles` 与 `/datasets`。WebUI 首次加载和打开
创建对话框时会自动完成这一步。

### `GET /runtimes`

只返回已经创建或有可见失败状态的 Runtime：

```json
{
  "runtimes": [
    {
      "id": "ontology-retrieval--smart-building",
      "display_name": "检索增强本体上下文 · Smart Building Sample",
      "status": "ready",
      "stale": false,
      "profile": {
        "id": "ontology-retrieval",
        "title": "检索增强本体上下文",
        "description": "使用实体 Top-K 与近似 Steiner 连通子图生成查询计划。",
        "revision": "dev"
      },
      "dataset": {
        "id": "smart-building",
        "title": "Smart Building Sample",
        "description": "可提交的虚构楼宇本体。",
        "ontology_sha256": "<64 hex>"
      },
      "ws_url": "/runtimes/ontology-retrieval--smart-building/acp",
      "last_error": null
    }
  ]
}
```

Profile/Dataset 标题与描述来自 Runtime 自身的 manifest/已校验快照，不与当前源 Catalog
联表，因此源条目被改名或移除后历史项目仍可辨识。不返回命令、绝对 cwd、源路径、
state 路径、环境变量名/值或 endpoint。

### `POST /runtimes`

```json
{
  "profile_id": "ontology-retrieval",
  "dataset_id": "smart-building"
}
```

- 只接受 Catalog ID，不接受路径、命令、环境或自定义 Runtime ID。
- 成功接受返回 `202` 和 `status=initializing`。
- 同一 Profile/Dataset 已存在返回 `409 runtime_exists`。
- Profile/Dataset 无效返回 `404`；不兼容返回 `422`。
- UI 通过 `GET /runtimes` 观察到 `ready` 或失败状态。
- UI 会先过滤已存在的 `<profile-id>--<dataset-id>`，但 `409` 仍是服务端并发控制边界。
- `initializing`、`initialization_failed`、`deleting` 和 `delete_failed` 也占用确定性
  Runtime ID；需要重建时先安全删除，不用创建请求覆盖。

### `DELETE /runtimes/:runtimeId`

- 取得 Runtime 独占锁后停止 Initializer 和 ACP 进程树。
- 提交前执行 canonical path、manifest 和 symlink 校验。
- 原子 rename 到 `.runtime/trash/` 是逻辑删除提交点。
- 提交成功返回 `204`；trash 物理清理由后台完成。
- 提交前失败返回错误，Runtime 状态为 `delete_failed`。
- Runtime 正忙或进程未能安全停止返回 `409`，不能先删除文件；`504` 只用于单独的
  Session 删除超时。
- 正在执行 Session 删除维护时返回 `409 runtime_busy`；Runtime 删除不得越过尚未登记
  完整的 Session CLI 子进程。

源 Profile、Dataset、其他 Runtime、根 uv 环境和仓库文件不属于该接口的删除范围。

### `DELETE /runtimes/:runtimeId/sessions/:sessionId`

OpenCode 专用扩展，只删除该 Runtime `OPENCODE_DB` 中的 Session。它与 Runtime 删除是
不同操作。

## 5. ACP WebSocket

### `WS /runtimes/:runtimeId/acp`

- 仅 `ready`/`active` Runtime 可以升级。
- 浏览器侧 Session 请求的逻辑 cwd 固定为 `"."`；Bridge 校验后重写为
  `<runtime>/workspace/`，绝对路径不返回浏览器。
- 每个 Runtime 同时只允许一条 WebSocket。
- 文本帧承载 ACP JSON-RPC/NDJSON；二进制帧拒绝。
- Bridge 重写 Session cwd，拒绝非空 `mcpServers` 和客户端切换 Profile-owned
  Model/Mode/config。
- WebSocket 断开终止 ACP 进程树；历史从该 Runtime 的 OpenCode DB 恢复。
- `stale` 是 Catalog 对比产生的派生布尔值，不是持久状态。stale Runtime 可读取和继续
  已有 Session，但拒绝 `session/new`；需要按当前源重建时删除 Runtime 后重新创建。

WebUI 使用：

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

## 6. Runtime 初始化与删除文件协议

### 6.1 staging

候选目录：

```text
.runtime/staging/<runtime-id>--<nonce>/
```

pending manifest 必须包含 Runtime ID、Profile/Dataset ID、状态和快照摘要。初始化成功后
只能通过同文件系统 rename 进入 `projects/<runtime-id>`。不得把 staging symlink 到
Profile、Dataset 或临时系统目录。

### 6.2 trash

删除目标：

```text
.runtime/trash/<runtime-id>--<timestamp>--<nonce>/
```

递归清理函数只接受服务端刚生成、位于 canonical `trash/` 下的直接子目录。即使
`runtime.yaml` 被篡改，也不能据其中路径删除 Profile/Dataset 源。

失败规则：

- rename 前失败：保留原 Runtime，写 `delete_failed`。
- rename 后清理失败：保持逻辑删除，trash 写 `cleanup_failed`，启动时重试。
- 无合法 manifest 的 staging/trash 不自动递归删除，只记录需要人工检查的安全错误。

## 7. `ontology.subgraph` Artifact

Profile Skill 可输出：

```text
ONTOLOGY_ARTIFACT:{"schema_version":1,"kind":"ontology.subgraph",...}
```

该图表示 Tool 实际返回的本体子图。它与查询计划 Graph 是两个独立展示协议。
内置检索 Profile 的概念算法名为 `minimum_connected_subgraph`，实际实现标识为
`networkx.approximation.steiner_tree:mehlhorn`；后者是近似 Steiner tree，二者均写入
Runtime 索引/Tool 输出，不能把结果表述为精确最小解。边的 `source`/`target` 保留本体
statement 方向，无向图仅用于选路。

## 8. `data-query-plan.v1` 与展示投影

Agent 原始结果示例：

```json
{
  "schema_version": "data-query-plan.v1",
  "profile": "ontology-retrieval",
  "question": "温度传感器所在的房间属于哪个建筑？",
  "keywords": ["温度传感器", "房间", "建筑"],
  "query_tasks": [
    {
      "targets": ["TemperatureSensor"],
      "filters": ["status = active"],
      "projections": ["Building"],
      "joins": [
        {
          "from": "TemperatureSensor",
          "relation": "locatedIn",
          "to": "Room"
        }
      ],
      "ontology_evidence": [
        {
          "subject": "TemperatureSensor",
          "predicate": "subClassOf",
          "object": "Sensor"
        }
      ]
    }
  ],
  "assumptions": []
}
```

“查询Plan”卡片包含 `JSON` 和 `Graph` 切换。Graph 是纯展示投影：

### 8.1 节点

- 每个 `query_tasks[i]` 生成一个虚拟 Task 节点 `task:<i>`。
- `targets`、`projections`、`joins.from/to` 和
  `ontology_evidence.subject/object` 中相同的非空字符串合并为同一 Entity 节点。
- 节点保留角色集合，例如 `target`、`projection`、`join`、`evidence`。
- 每个 `filters[j]` 生成一个只读 Filter note；字符串直接显示，对象/数组使用有界
  JSON 摘要。

### 8.2 边

| 来源 | Graph 边 |
| --- | --- |
| `targets` | Task → Entity，标签 `target` |
| `projections` | Task → Entity，标签 `projection` |
| `filters` | Task → Filter，标签 `filter` |
| `joins` | `from` → `to`，标签为 `relation` |
| `ontology_evidence` | `subject` → `object`，标签为 `predicate`，使用 evidence 样式 |

Graph 不把 `keywords` 或 `assumptions` 推断为实体关系；它们继续在 JSON 中查看。

### 8.3 保真与失败

- 解析和投影只发生在组件内存中，不改变消息字符串、Store、ACP 或 OpenCode Session。
- JSON 视图保留原始键顺序和数值词法，只调整展示空白。
- Graph 不查询本体、不验证实体是否存在、不补边、不改正模型结果。
- 缺少合法 `query_tasks`、字段类型不支持或超过 120 节点/240 边时，Graph 按钮禁用并
  显示原因；JSON 始终可用。
- JSON/Graph 当前选择和 D3 布局不持久化。
