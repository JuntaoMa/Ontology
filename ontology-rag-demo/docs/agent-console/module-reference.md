# Agent Console 模块、协议与接口速查

本文只描述当前代码，不定义未来框架。

## 1. 模块 → 功能

### 1.1 Bridge 服务端

| 模块 | 功能 |
| --- | --- |
| `server/index.ts` | 启动 loopback HTTP 服务；加载 Catalog；提供 `/health`、`/agents`、Session 删除、静态文件和 WS upgrade |
| `server/profile.ts` | 发现、解析并校验 Profile；解析受限路径；自动收集 env 引用；生成脱敏 `PublicAgent` |
| `server/profile-schema.ts` / `server/schemas/profile-v1.schema.json` | Profile v1 的 JSON Schema |
| `server/opencode-runtime.ts` | 派生最小子进程环境；同步可写 OpenCode config overlay |
| `server/bridge.ts` | 一 Profile 一 WS/子进程；WebSocket ↔ stdio NDJSON 转发；请求门控；进程树回收；maintenance 互斥 |
| `server/session-delete.ts` | 在 Profile 所属 OpenCode DB 中有界执行持久 Session 删除 |
| `server/static-files.ts` | 构建模式下安全提供 `dist-web` 文件 |
| `server/acp-probe.ts` | 运行 `initialize + session/list` 并输出脱敏 smoke 结果 |
| `server/profile-probe.ts` | 用生产 Profile Loader、env 映射和临时 config overlay 组织 Probe |
| `server/probe-cli.ts` | `probe:acp -- --profile <path>` 命令入口 |

### 1.2 Web 前端

| 模块 | 功能 |
| --- | --- |
| `src/App.vue` | 单页布局；组合 Profile 侧栏、唯一 ChatView 和全局对话框 |
| `src/components/ProfileSidebar.vue` | 固定 Profile 分组、折叠、脱敏信息、新建/选择/删除 Session |
| `src/components/ChatView.vue` | 当前 Conversation、Prompt、Cancel、状态和自动滚动 |
| `src/components/MessageContent.vue` | 安全 Markdown 与“查询Plan”JSON 展示 |
| `src/components/ToolCallCard.vue` | Tool 状态、Input/Output、耗时和 artifact 折叠卡 |
| `src/components/OntologySubgraphCard.vue` | 小型本体子图的 D3/SVG 展示 |
| `src/components/ModalDialog.vue` | 认证、Permission、删除确认共享的原生 dialog 基础 |
| `src/stores/config.ts` | 从 `/agents` 读取只读 Profile Catalog |
| `src/stores/session.ts` | `Profile → ACP client`、`(Profile, Session) → Conversation` 生命周期；并发门控、恢复、删除与 Permission 路由 |
| `src/lib/bridge-api.ts` | `/agents` 与 Session 删除的同源 fetch 适配 |
| `src/lib/acp-bridge.ts` | 浏览器端最小 ACP JSON-RPC client；超时、待处理请求和 Permission 生命周期 |
| `src/lib/transport/websocket.ts` | same-origin WebSocket 文本/NDJSON 传输 |
| `src/lib/session-projection.ts` | 将 `session/update` 归并为消息、Thinking、Plan、Tool 和 Session 元数据 |
| `src/lib/tool-call.ts` | Tool Call/Update 归并与在线计时 |
| `src/lib/markdown.ts` / `src/lib/json-presentation.ts` | DOMPurify 安全 Markdown、最终 JSON 展示投影 |
| `src/lib/ontology-artifact.ts` | 从 Tool `rawOutput`/`content` 中限量解析子图 marker |

### 1.3 8010 OAG 与共享 Skill

| 模块 | 功能 |
| --- | --- |
| `src/ontology_rag_demo/settings.py` | 只从环境变量读取 OAG 配置 |
| `src/ontology_rag_demo/cli.py` | `prepare`、`build-index`、`smoke`、`serve` |
| `src/ontology_rag_demo/embedding.py` | deterministic/BGE-M3 embedding 适配 |
| `src/ontology_rag_demo/vector_store.py` | LanceDB rebuild 与 cosine Top-K |
| `src/ontology_rag_demo/ontology.py` | RDF 本体解析、实体向量文本、锚点和 Steiner 近似最小连通子图 |
| `src/ontology_rag_demo/services.py` | 组合 embedding、向量库、图检索和可选 Qwen answer |
| `src/ontology_rag_demo/api.py` | 8010 FastAPI HTTP 接口 |
| `profiles/_shared/skills/ontology-retrieval/SKILL.md` | 告诉 Agent 何时及如何自主调用检索 |
| `profiles/_shared/skills/ontology-retrieval/scripts/retrieve.py` | Bash 可调用的 OAG wrapper；校验参数/摘要/算法并输出 artifact |

## 2. 数据协议

| 协议 | 生产者 → 消费者 | 核心字段/语义 |
| --- | --- | --- |
| Profile v1 YAML | Git/Catalog → Bridge | `id`、`revision`、`runtime`、`opencode`、`model`、`skills`、可选 `retrieval`、`ontology` |
| `PublicAgent` JSON | `GET /agents` → Config Store | 脱敏 Profile、状态、WS URL、cwd、Model、Retrieval、Ontology ID |
| ACP JSON-RPC/NDJSON | Web client ↔ Bridge ↔ OpenCode | `initialize`、Session 生命周期、Prompt/Cancel、Update、Permission |
| OAG JSON | Skill wrapper ↔ 8010 | question/keywords/top_k/graph_algorithm；hits 与 graph |
| 本体子图 artifact | Skill stdout → Tool Call → UI | `ONTOLOGY_ARTIFACT:` + `schema_version: 1` + `kind: ontology.subgraph` |
| `data-query-plan.v1` | Agent 最终消息 → UI/人工检查 | baseline、question、keywords、query_tasks、assumptions；UI 只格式化，不改写 |

运行时内部键：

```text
Profile connection: profileId
Conversation:       profileId + ":" + sessionId
OpenCode state:     ontology-rag-demo/.runtime/opencode/<profileId>
```

## 3. 接口

### 3.1 Agent Console

| 接口 | 返回/行为 |
| --- | --- |
| `GET /health` | Bridge 状态及每个 Profile 的 `active`/可选 `startedAt` |
| `GET /agents` | 脱敏 Profile Catalog；`status=stopped|active|unavailable` |
| `WS /agents/:profileId/acp` | ACP JSON-RPC 文本/NDJSON；一 Profile 最多一条连接 |
| `DELETE /agents/:profileId/sessions/:sessionId` | OpenCode 扩展持久删除；成功 `204` |
| `GET /*` | 构建模式的静态 Web UI；未知前端路由回退到 `index.html` |
| `HEAD /*` | 当前服务端返回空的 `200` 探测响应 |

### 3.2 浏览器实际调用的 ACP

```text
initialize
session/list
session/new
session/load
session/prompt
session/cancel
authenticate

session/update                 # Agent notification
session/request_permission     # Agent request
```

Bridge 还会校验 `session/resume`、`session/fork` 以及 Profile-owned 设置方法，但首版 UI
没有暴露这些操作。

### 3.3 8010 OAG

| 接口 | 作用 |
| --- | --- |
| `GET /health` | 安全就绪摘要、索引状态、可选本体 SHA-256 |
| `POST /v1/retrieval/vector` | 问题 embedding → LanceDB Top-K |
| `POST /v1/retrieval/graph` | 问题文本锚点 → 最小连通子图 |
| `POST /v1/retrieval/oag` | Agent 关键词 → Top-K 实体锚点 → 最小连通子图 |
| `POST /v1/answer` | 当前 OAG 内置端到端回答与可选 trace |

Profile 中的 `retrieval.graph_algorithm` 会传到 wrapper 和 8010，并由两端验证；当前只
支持 `minimum_connected_subgraph`。
