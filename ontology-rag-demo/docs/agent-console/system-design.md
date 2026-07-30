# Ontology Agent Console 系统设计

状态：首版已实现

边界：可信单用户、本机 loopback、OpenCode 为唯一 Agent Runtime

## 1. 目标与非目标

Console 用一个浏览器页面运行和观察多种本体 RAG 测试方案：

1. 用户从固定 Profile 分组创建或恢复 OpenCode Session。
2. OpenCode 自主管理上下文、加载 Skill、调用 Bash，并根据观测继续调用工具或回答。
3. OAG Skill 可访问 8010 服务，完成本体实体向量召回和最小连通子图检索。
4. UI 展示 ACP 能看到的消息、Thinking、Plan、Tool Call、Permission 和子图 artifact。

Profile 描述 Agent 设置、工具参数和 Skill，不定义固定 Workflow 或步骤顺序。首版也不
实现测试结果自动比较、前端历史数据库、事件总线、插件注册系统、复杂图工作台或多用户
权限系统。

## 2. 事实源与职责

| 模块 | 权威职责 | 明确不负责 |
| --- | --- | --- |
| OpenCode | Session、历史、Agent 循环、模型、Skill、工具和权限 | 浏览器接入、OAG 实现 |
| Agent Profile | 固定测试方案的运行配置和非敏感参数 | Session 数据、工具调用顺序 |
| ACP Bridge | Profile 校验、进程生命周期、WebSocket/stdio 转发、安全门控、静态 UI | 消息语义编排、检索实现、历史存储 |
| Web UI | Prompt/Cancel/Permission 与 ACP 事件展示 | 权威历史、Agent 配置、长期持久化 |
| 8010 OAG | Embedding、LanceDB Top-K、本体锚点和连接子图、检索 API | Agent 会话和答案策略 |

Session 属于 OpenCode，并绑定创建它的 Profile。浏览器内存中的 Conversation 只是当前
页面的展示投影，刷新后必须从 `session/list` 和 `session/load` 恢复。

## 3. 运行拓扑

```text
Browser
   │ same-origin HTTP / WebSocket
   ▼
Agent Console (127.0.0.1:4310)
├── Vue Web UI
└── ACP Bridge
       │ stdio NDJSON / JSON-RPC
       ▼
   opencode acp
       │ Agent 自主 Bash
       ▼
共享 ontology-retrieval Skill
       │ HTTP
       ▼
8010 OAG
├── BGE-M3
├── LanceDB cosine Top-K
└── NetworkX 最小连通子图
```

浏览器不直接访问 8010、LanceDB 或本体文件。Console 与 OpenCode 在同一可信主机运行；
8010 可以作为独立本机进程运行。

## 4. Profile 与运行时

Bridge 启动时递归发现 Catalog 中名为 `profile.yaml` 或 `profile.yml` 的文件，由服务端
JSON Schema 和语义校验统一加载。浏览器只收到脱敏后的 Catalog。

Profile 的关键约定：

- `runtime.cwd`、OpenCode 配置、附属资产和 Skill 路径均相对于 Profile 文件解析，并
  必须留在允许的项目/Catalog 边界内。
- 运行状态目录不写入 YAML，而是由 Catalog 项目根和 Profile ID 确定：
  `ontology-rag-demo/.runtime/opencode/<id>`。
- `{env: VARIABLE_NAME}` 是有类型的环境引用。Bridge 从 Profile 自动收集这些引用；
  启动时缺值则把 Profile 标记为 `unavailable`，值本身不返回浏览器。
- OpenCode 配置源保存在 Git 中。启动前 Bridge 将 `opencode.jsonc` 和显式 sidecar
  同步到 `<stateDir>/config/`，再设置 `OPENCODE_CONFIG_DIR`。
- 每个 Profile 的 `OPENCODE_DB` 固定为 `<stateDir>/opencode.db`，从而隔离 Session。
- Model、Retrieval、Ontology 声明会映射为规范化的 `ONTOLOGY_*` 运行变量；Agent
  子进程只继承最小系统变量和 Profile 实际引用的环境变量。

Profile 是固定测试方案配置。可复现性直接来自 Git commit、`pnpm-lock.yaml`、
`uv.lock`、Profile/Prompt/Skill 文件及部署环境记录。`revision` 是方案版本标签。

## 5. 连接、并发与恢复

- `WS /agents/:profileId/acp` 是一个 Profile 的唯一 ACP 入口。
- 一条活跃 WebSocket 对应一个 `opencode acp` 子进程；连接断开后终止进程树。
- 同一 Profile 同时只允许一个 WebSocket 客户端；第二条连接返回冲突。
- 一个 Profile 连接可以管理多个 OpenCode Session。UI 按
  `profileId + sessionId` 路由 `session/update`。
- 不同 Profile 可以同时连接和执行；切换唯一可见的对话窗口不会取消后台 Profile。
- 首版同一 Profile 同时只运行一轮 `session/prompt`，避免同一 ACP 连接上的 Permission
  归属不明确。
- 未建立长期连接时，UI 可用短生命周期连接执行 `initialize + session/list`，随后
  关闭；加载或创建对话时建立该 Profile 的工作连接。
- 同一 Session 的并发 `session/load` 合并为一个请求；历史回放完成前不能发送 Prompt。
- Bridge 不缓冲断线期间事件，也不重放旧 JSON-RPC。重连后由 OpenCode 持久历史恢复。

## 6. 删除会话

ACP `0.13.1` 没有持久 Session 删除方法。UI 的垃圾桶调用同源扩展：

```text
DELETE /agents/:profileId/sessions/:sessionId
```

Bridge 校验 Profile 和 OpenCode Session ID，并在该 Profile 无在途请求时取得 maintenance
锁；随后关闭空闲连接，以参数数组、无 shell 方式执行：

```text
opencode session delete <sessionId> --pure
```

命令使用所属 Profile 的 cwd、配置 overlay 和 `OPENCODE_DB`。删除完成后 UI 刷新
`session/list` 并按需要恢复原可见会话。前端不使用 tombstone 或本地伪删除掩盖
OpenCode 的事实源。

## 7. 安全边界

Agent 可以执行 Bash，因此入口接近本机远程终端能力：

- 服务端只允许 `127.0.0.1`、`::1` 或 `localhost` 监听。
- WebSocket 校验 `Origin`；浏览器只能选择服务端 Catalog 中的 Profile ID。
- Bridge 校验 Session cwd，拒绝非空 `mcpServers` 注入，并拒绝客户端修改 Profile
  固定的 Model、Mode 和配置选项。
- Profile 只保存环境变量名，密钥值只在服务端子进程环境中存在。
- Agent stdout 专用于 ACP NDJSON；日志写 stderr，错误响应不回显敏感输出。
- Markdown 经 DOMPurify 处理，artifact 字符串按文本渲染。
- Permission 是 Agent 交互机制，不是主机沙箱。

本设计不适用于公网、共享服务器或不可信用户。要扩大边界，必须先增加认证、授权和进程/
文件系统隔离。

## 8. UI 与可观察性

UI 以 `acp-ui 0.1.16` 为源码基线，仅保留 Web 能力。页面固定按 Profile 分组，每组只
提供脱敏信息、新建对话和 Session 列表；单页只有一个可见 `ChatView`。

展示规则：

- Thinking、Skill、Execute/Bash 与普通 Tool 使用不同语义图标。
- Tool Call、ACP Plan 和最终 JSON 都是“单行摘要 + 可折叠正文”；完整 JSON 标题为
  “查询Plan”。
- Tool 展示 Input、Output 和 artifact，不重复显示通用 `ACP content`；底层字段仍
  保留用于 artifact 提取。
- `ONTOLOGY_ARTIFACT:` 中的合法小型子图可显示轻量 SVG；失败时保留原始 Tool 输出。
- 实时成功回答显示浏览器当地完成时间与客户端观测的全轮耗时。
- `session/load` 无法恢复权威的回答完成时间或 Tool 原生时序，因此历史页不伪造这些
  字段。

前端不使用 localStorage 持久化 Agent 地址、凭据、Session 或 Trace，也不建立第二套
事件协议或传输诊断页。它只呈现 ACP 可观察执行；OpenCode 私有但未投影的事件不属于
可恢复范围。

## 9. 双基线

| Profile | 本体上下文来源 | 预期轨迹 |
| --- | --- | --- |
| `baseline-direct-context` | Prompt 内嵌完整精简 YAML 本体 | 不调用 Tool，直接输出查询计划 |
| `baseline-oag` | Agent 提取关键词后调用共享 Skill | BGE-M3 Top 5 → 命中实体为锚点 → 最小连通子图 → 查询计划 |

两条路径使用同一模型和同一问题，最终输出约定为 `data-query-plan.v1`。当前目标是验证
从问题到查询计划的接线与可观察性，不把实例数据查询或自动优劣比较纳入首版。

最终合格标准是真实 WebUI 中完成创建、Prompt、后台并行、Tool/artifact 展示、刷新恢复
和删除；Profile Probe 只做 `initialize + session/list` 的只读 smoke check。
