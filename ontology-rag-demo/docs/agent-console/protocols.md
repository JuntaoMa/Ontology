# Agent Console 配置与数据协议

状态：首版已实现

Profile Schema：`1`

## 1. Agent Profile v1

Profile 是服务端可执行配置，也是人类可读的固定测试方案说明。它声明 Agent 运行方式、
模型、Skill 和检索参数，但不声明 Agent 必须遵循的步骤。

```yaml
schema_version: 1
id: baseline-oag
revision: dev
title: OAG Retrieval Baseline
description: 使用 BGE-M3 Top 5 与最小连通子图生成数据查询任务。

runtime:
  command: opencode
  args: [acp, --print-logs, --pure]
  cwd: ../..
  startup_timeout_ms: 30000

opencode:
  config: opencode/opencode.jsonc
  assets:
    - opencode/prompt.md

model:
  id: deepseek/deepseek-v4-flash
  source: opencode
  auth:
    source: opencode

skills:
  - id: ontology-retrieval
    path: ../_shared/skills/ontology-retrieval

retrieval:
  endpoint:
    env: OAG_BASE_URL
  vector_top_k: 5
  graph_algorithm: minimum_connected_subgraph

ontology:
  id: smart-building-sample
```

### 1.1 字段与校验

| 字段 | 作用 |
| --- | --- |
| `id` | Catalog 唯一 ID；只允许小写字母、数字和连字符 |
| `revision` | Git 中的方案版本标签 |
| `runtime` | 固定命令、参数、相对 cwd 和启动超时 |
| `opencode.config` | 受版本控制的 OpenCode 配置源 |
| `opencode.assets` | 与配置一起复制的普通 sidecar 文件 |
| `model` | OpenCode 已知模型或环境变量驱动的兼容 API |
| `skills` | 零个或多个包含 `SKILL.md` 的目录 |
| `retrieval` | 可选的 OAG endpoint、Top-K 与图算法 |
| `ontology` | 逻辑本体 ID；可选 `sha256` |

服务端使用
`apps/agent-console/server/schemas/profile-v1.schema.json` 和语义校验加载 Profile。
Schema 禁止未知字段；路径必须相对 `profile.yaml`，不能逃出允许的项目/Catalog 范围，
且关键文件不能是符号链接。

Profile 中不配置运行状态目录或显式环境白名单：

- `<project>/.runtime/opencode/<id>` 是由 Catalog 项目根和 `id` 派生的 `stateDir`；
- `<stateDir>/opencode.db` 是该 Profile 的 OpenCode Session 数据库；
- `<stateDir>/config/` 是 Bridge 刷新的可写 OpenCode overlay；
- Loader 会递归收集合法 `{env: NAME}` 引用，自动得到所需环境变量集合；
- 缺少引用值时 `/agents` 把 Profile 标为 `unavailable`，但不返回变量名或值。

自定义 OpenAI-compatible 模型使用：

```yaml
model:
  id: qwen-compatible/qwen-model
  source: profile
  api_base:
    env: QWEN_BASE_URL
  auth:
    source: environment
    api_key:
      env: QWEN_API_KEY
```

Bridge 将 Profile 声明转换为 `ONTOLOGY_MODEL_*`、
`ONTOLOGY_RETRIEVAL_ENDPOINT`、`ONTOLOGY_VECTOR_TOP_K`、
`ONTOLOGY_GRAPH_ALGORITHM`、`ONTOLOGY_ID` 和可选
`ONTOLOGY_EXPECTED_SHA256`。当 Retrieval endpoint 是 loopback HTTP(S) 时，还固定
设置 `NO_PROXY/no_proxy=localhost,127.0.0.1,::1`。

Profile、Prompt、Skill 和 OpenCode 配置直接由 Git 版本化；运行时不生成第二套方案
元数据。

## 2. Bridge HTTP/WS 协议

### 2.1 `GET /health`

```json
{
  "status": "ok",
  "profiles": [
    {
      "id": "baseline-oag",
      "active": true,
      "startedAt": "2026-07-30T08:00:00.000Z"
    }
  ]
}
```

未连接的 Profile 只有 `id` 和 `active: false`。

### 2.2 `GET /agents`

返回脱敏 Catalog：

```json
{
  "agents": [
    {
      "id": "baseline-oag",
      "revision": "dev",
      "title": "OAG Retrieval Baseline",
      "description": "使用 BGE-M3 Top 5 与最小连通子图上下文生成数据查询任务。",
      "status": "stopped",
      "ws_url": "/agents/baseline-oag/acp",
      "cwd": "/absolute/path/to/ontology-rag-demo",
      "model": {
        "id": "deepseek/deepseek-v4-flash",
        "source": "opencode"
      },
      "retrieval": {
        "vector_top_k": 5,
        "graph_algorithm": "minimum_connected_subgraph"
      },
      "ontology": {
        "id": "smart-building-sample"
      }
    }
  ]
}
```

`status` 为 `stopped`、`active` 或 `unavailable`。响应不含命令、配置路径、stateDir、
环境变量名/值、endpoint 或密钥。`cwd` 是 ACP `session/new`、`session/load` 和
`session/list` 的协议必需值，因此只适用于当前 loopback 模式。

### 2.3 `WS /agents/:profileId/acp`

- 文本帧承载一个或多个换行分隔的 JSON-RPC 2.0 对象；二进制帧不支持。
- Bridge 保持 JSON-RPC `id`、`method`、`params` 和结果不变，在 WebSocket 与
  `opencode acp` stdin/stdout NDJSON 之间转发。
- 同一 Profile 的第二条连接、maintenance 期间连接或缺少环境变量的连接会被拒绝。
- `session/new`、`session/load`、`session/list`、`session/resume` 和
  `session/fork` 必须使用固定 cwd；非空 `mcpServers` 被拒绝。
- `session/set_model`、`session/set_mode` 和 `session/set_config_option` 被拒绝。
- WebSocket 断开会终止对应进程树；后续连接通过 OpenCode 历史恢复。

UI 当前使用的 ACP 方法：

| 方向 | 方法 | 用途 |
| --- | --- | --- |
| UI → Agent | `initialize` | 协议与能力协商 |
| UI → Agent | `session/list` | 获取 Session 元数据 |
| UI → Agent | `session/new` | 创建 Session |
| UI → Agent | `session/load` | 重放持久历史 |
| UI → Agent | `session/prompt` | 发送一轮 Prompt |
| UI → Agent | `session/cancel` | 取消当前轮 |
| UI → Agent | `authenticate` | 执行 Agent 提供的认证方法 |
| Agent → UI | `session/update` | 消息、Thinking、Plan、Tool 和元数据更新 |
| Agent → UI | `session/request_permission` | Permission 选择 |

### 2.4 `DELETE /agents/:profileId/sessions/:sessionId`

这是 OpenCode 专用的同源扩展，不属于 ACP：

- 请求不能带 body；
- `sessionId` 必须匹配 `ses_[A-Za-z0-9]{1,96}`；
- Profile 有在途 ACP 请求、正在连接或正在 maintenance 时返回 `409 profile_busy`；
- 成功返回 `204`；
- 不支持 OpenCode 删除、CLI 失败和超时分别返回 `501`、`502`、`504`。

## 3. OAG HTTP 协议

8010 FastAPI 服务提供：

| 方法与路径 | 请求要点 | 响应要点 |
| --- | --- | --- |
| `GET /health` | 无 | 安全配置摘要、本体/索引就绪状态、可选 `ontology_sha256` |
| `POST /v1/retrieval/vector` | `question`、可选 `top_k` | `question`、`hits` |
| `POST /v1/retrieval/graph` | `question`、`graph_algorithm` | `anchors`、`nodes`、`edges`、`disconnected` |
| `POST /v1/retrieval/oag` | `question`、1–10 个 `keywords`、可选 `top_k`、算法 | `hits` 与 `graph` |
| `POST /v1/answer` | `question`、算法、可选 `trace` | `answer`，可选向量与图 trace |

`top_k` 的请求范围是 1–20；当前唯一合法算法是
`minimum_connected_subgraph`。OAG 基线请求示例：

```json
{
  "question": "温度传感器所在的房间属于哪个建筑？",
  "keywords": ["温度传感器", "房间", "建筑"],
  "top_k": 5,
  "graph_algorithm": "minimum_connected_subgraph"
}
```

LanceDB 每条本体实体向量的文本固定为：

```text
{name}
{label}
{comment}
```

检索采用 cosine distance。OAG 模式将关键词用换行连接后做向量查询，把 Top-K 中
`content_type=ontology_entity` 的实体 ID 作为图锚点，再计算 Steiner 近似最小连通
子图。

## 4. 本体子图 artifact

Skill wrapper 在 stdout 中输出固定前缀和一个 JSON 对象：

```text
ONTOLOGY_ARTIFACT:{"schema_version":1,"kind":"ontology.subgraph",...}
```

```json
{
  "schema_version": 1,
  "kind": "ontology.subgraph",
  "query_id": "q_123",
  "nodes": [
    {
      "id": "TemperatureSensor",
      "label": "温度传感器",
      "type": "OntologyEntity",
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
    "anchor_nodes": ["TemperatureSensor"],
    "node_count": 1,
    "edge_count": 0,
    "duration_ms": 18,
    "disconnected": false
  }
}
```

UI 从 Tool `rawOutput` 或 ACP `content` 中查找首个合法 marker。最多内联 80 个节点、
160 条边；超过限制时不绘图，但保留 Tool 原始输出。字符串按文本处理，解析或渲染失败
不能影响对话。

## 5. `data-query-plan.v1`

两条基线约定最终消息输出同一种查询计划：

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

`baseline` 当前为 `oag` 或 `direct-context`。这是 Agent 输出约定，不是 Bridge 强制的
工作流协议；UI 只在最终消息是完整 object/array，或以合法 JSON fence 收尾时，将其
格式化为可折叠“查询Plan”，不会改写 ACP 消息或 OpenCode 历史。
