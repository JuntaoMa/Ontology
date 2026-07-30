# Agent Console 配置与 Artifact 协议

状态：实施中
Schema 版本：`1`

## 1. Agent Profile

Profile YAML 既是人类可读说明，也是 ACP Bridge 的实际运行入口。它只声明可用能力和
参数，不声明工具调用顺序。

```yaml
schema_version: 1
id: dev
revision: dev
title: Ontology RAG Development
description: 可变的本地开发 Profile
mutable: true

runtime:
  command: opencode
  args: [acp, --print-logs, --pure]
  cwd: ../..
  state_dir: ../../.runtime/opencode/dev
  startup_timeout_ms: 15000

opencode:
  config: opencode/opencode.jsonc
  assets:
    - opencode/prompt.md

model:
  id: deepseek/deepseek-v4-flash
  source: opencode
  auth:
    source: opencode

skills: []

ontology:
  id: smart-building-sample

environment:
  required: []
```

### 1.1 规则

- `id` 只允许小写字母、数字和连字符。
- `runtime.command` 和 `runtime.args` 来自服务端文件，绝不接受浏览器覆盖。
- `runtime.cwd`、配置路径和 Skill 路径相对于 Profile 文件所在目录解析。
- `state_dir` 必须位于允许的运行状态根目录内。
- `env` 对象只能保存环境变量名，不保存值。
- `environment.required` 中的变量才会从宿主传给 OpenCode；本体文件位置只注入 8010。
- 当声明的 Retrieval endpoint 是 loopback HTTP(S) 地址时，Bridge 只为 Agent 子进程
  设置固定的 `NO_PROXY/no_proxy=localhost,127.0.0.1,::1`，避免 macOS 系统代理截获
  本机 OAG 请求；不继承宿主更广泛、可能含内网信息的代理绕行列表。
- `model.source: opencode` 固定模型 ID，但复用同一系统用户的 OpenCode provider
  catalog；`model.auth.source: opencode` 复用其凭证，不继承“上次选择的模型”。
- 自定义兼容 API 使用 `model.source: profile`、`model.api_base.env` 和
  `model.auth: {source: environment, api_key: {env: ...}}`；所引用变量必须列入
  `environment.required`。
- `skills` 可以为空；只在 Agent 实际具备 Retriever 时声明 `retrieval`。
- `mutable: false` 的正式 Profile 必须有发布锁文件。
- Profile 文件变化只在下次进程启动时生效。
- `opencode.config` 和显式列出的 `opencode.assets` 是只读配置源；Bridge 会保持相对
  路径复制到 `state_dir/config/` 后再启动 OpenCode。资产必须是配置目录内的普通文件，
  不能是目录、符号链接或路径穿越。

OAG Profile 在上例基础上增加：

```yaml
skills:
  - id: ontology-retrieval
    path: skills/ontology-retrieval

retrieval:
  endpoint:
    env: OAG_BASE_URL
  vector_top_k: 5
  graph_algorithm: minimum_connected_subgraph

environment:
  required: [OAG_BASE_URL]
```

## 2. 正式 Profile Bundle

```text
profiles/
├── dev/
│   ├── profile.yaml
│   ├── opencode/
│   │   ├── opencode.jsonc
│   │   └── prompt.md
│   └── skills/
├── baseline-oag/
├── baseline-direct-context/
└── releases/
    └── baseline-v1/
        ├── profile.yaml
        ├── profile.lock.json
        ├── opencode/
        └── skills/
```

`profile.lock.json` 不保存密钥或本体原始材料，至少记录：

```json
{
  "schema_version": 1,
  "profile_id": "baseline-v1",
  "profile_revision": "v1",
  "created_at": "2026-07-27T00:00:00Z",
  "files": [
    {
      "path": "profile.yaml",
      "sha256": "...",
      "size": 1024
    }
  ],
  "external_inputs": {
    "ontology": {
      "id": "smart-building-sample",
      "sha256": "..."
    }
  }
}
```

发布过程复制小型配置、Prompt、Skill 和调用脚本；本体源材料、模型权重、LanceDB 状态
和密钥不进入 Bundle，只记录逻辑标识、摘要及环境变量引用。

Bundle lock 在 Catalog 加载时校验控制文件。不可变 Profile 调用检索时还会把
`external_inputs.ontology.sha256` 与 8010 `/health` 返回的 `ontology_sha256` 比对；
不一致或服务未提供摘要时停止调用。该校验不覆盖 LanceDB 与黑盒实例数据。

同一用户在 Bridge 启动后直接修改 Bundle 属于不支持的本地篡改场景；修改 `dev` 或
替换 Release 后必须重启 Console。正式复现实验还应在部署清单中固定 OpenCode
`1.17.16`，因为 Runtime 二进制不复制进 Profile Bundle。

## 3. `ontology-artifact.v1`

ACP 负责传输 Agent 和 Tool Call 事件，但不定义本体图。检索脚本可以在 stdout 中输出
一行带固定前缀的 JSON：

```text
ONTOLOGY_ARTIFACT:{"schema_version":1,"kind":"ontology.subgraph",...}
```

普通日志可以位于其他行。UI 只解析固定前缀后的 JSON，不扫描或猜测任意输出。

### 3.1 子图结构

```json
{
  "schema_version": 1,
  "kind": "ontology.subgraph",
  "query_id": "q_123",
  "nodes": [
    {
      "id": "TemperatureSensor",
      "label": "温度传感器",
      "type": "Class",
      "anchor": true
    }
  ],
  "edges": [
    {
      "source": "TemperatureSensor",
      "target": "Sensor",
      "type": "subClassOf",
      "label": "subClassOf"
    }
  ],
  "metadata": {
    "algorithm": "minimum_connected_subgraph",
    "anchor_nodes": ["TemperatureSensor", "Building"],
    "node_count": 2,
    "edge_count": 1,
    "duration_ms": 18
  }
}
```

### 3.2 渲染约束

- UI 只接受 `schema_version: 1` 和已登记的 `kind`。
- 字符串作为纯文本处理。
- 首版最多内联渲染 80 个节点和 160 条边。
- 超过限制时只显示元数据和原始 Tool 输出。
- 支持缩放、画布平移、悬停和锚点高亮。
- 不支持编辑、图查询、复杂筛选或属性工作台。
- artifact 解析或渲染失败不得影响对话和原始 Tool Call 展示。
- artifact 提取可以读取 `rawOutput` 或底层 ACP Tool Call `content`。通用
  `ACP content` 不作为独立 UI 面板展示，但不得因展示去重而提前丢弃该协议字段。

## 4. ACP Bridge HTTP/WS 接口

### `GET /health`

返回 Bridge 和已启动 Profile 进程的非敏感状态。

### `GET /agents`

返回脱敏后的 Profile Catalog：

```json
{
  "agents": [
    {
      "id": "dev",
      "revision": "dev",
      "title": "Ontology RAG Development",
      "description": "可变的本地开发 Profile",
      "mutable": true,
      "status": "stopped",
      "cwd": "/absolute/path/on/agent-host/ontology-rag-demo",
      "ws_url": "/agents/dev/acp"
    }
  ]
}
```

`status` 取值为 `stopped`、`active` 或 `unavailable`；最后一种表示 Profile 所需的
环境变量尚未完整注入，但接口不会返回变量值。

不得返回命令、配置目录、状态目录、环境变量值、内网 API 地址或模型密钥。ACP
`session/new` 和 `session/load` 要求客户端提交 Agent 主机上的绝对 cwd，因此首版
Catalog 会返回 Profile 的 cwd。该信息只允许出现在已经限定为 loopback/可信网络的
部署中；未来公网部署必须由认证后的服务端策略替代。

### `WS /agents/:profileId/acp`

- 每个 WebSocket 文本帧包含一个或多个换行分隔的 ACP JSON-RPC 对象。
- 发送给 OpenCode stdin 的每条消息以换行结尾。
- OpenCode stdout 只允许协议消息；stderr 单独记录。
- 第二个客户端连接同一 Profile 时返回明确冲突并关闭，不做多路复用。
- 浏览器 `Origin` 不在 `AGENT_CONSOLE_ALLOWED_ORIGINS` 白名单时拒绝升级。
- `session/new`、`session/load`、`session/resume`、`session/fork` 和
  `session/list` 必须使用 Profile 固定 cwd；可携带 `mcpServers` 的请求不得注入
  非空列表。
- `session/set_model`、`session/set_mode` 和 `session/set_config_option` 被拒绝；
  模型与默认 Agent 配置只能通过发布新的 Profile Revision 调整。
- Bridge 不改写 JSON-RPC ID、method、params 或 result。
- WebSocket 关闭时终止对应 ACP 进程树；重新连接后通过 `session/list` 和
  `session/load` 恢复，而不是复用旧 JSON-RPC 连接。

## 5. 数据查询任务协议

两条本体上下文基线都只输出 `data-query-plan.v1`，便于确认结构一致并保留原始结果。
首轮不对内容作自动评分或对齐。

```json
{
  "schema_version": "data-query-plan.v1",
  "baseline": "oag",
  "question": "原始问题",
  "keywords": ["温度传感器", "房间", "建筑"],
  "query_tasks": [
    {
      "targets": ["TemperatureSensor"],
      "filters": [],
      "projections": ["Building"],
      "joins": [
        {
          "from": "TemperatureSensor",
          "relation": "locatedIn",
          "to": "Room"
        },
        {
          "from": "Room",
          "relation": "partOfBuilding",
          "to": "Building"
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

- `baseline` 当前取 `oag` 或 `direct-context`。
- 所有数组字段必须保留；无内容时使用空数组。
- `targets` 使用本体类名，`joins.relation` 使用本体对象属性名。
- `filters` 和 `projections` 描述未来黑盒数据查询引擎所需的实例字段，不代表已经得到
  数据。
- `ontology_evidence` 只说明查询任务的本体依据，不保存完整本体或 OAG 原始响应。
- OpenCode 原始事件和 OAG 响应保存在独立 trace 中，最终 JSON 不承担无损审计职责。
