# Ontology Agent Console 系统设计

状态：实施中
首版边界：可信单用户、本机 loopback、OpenCode 为唯一 Agent Runtime

## 1. 目标

首版用于打通多种本体 RAG 测试 Agent 的端到端路径：

1. 用户在浏览器中选择一个 Agent Profile。
2. 浏览器通过 ACP 与内部版 OpenCode 建立会话。
3. OpenCode 自主管理上下文、加载 Skill、调用 Bash，并根据观测结果继续调用工具或回答。
4. Skill 中的脚本调用 8010 OAG 服务，完成向量 Top-K 和本体子图召回。
5. OpenCode 通过 ACP 返回消息、思考片段、工具调用与原始工具结果。
6. UI 在工具结果中识别小型本体子图 artifact，并提供轻量 SVG 预览。

系统不定义固定 workflow，也不规定 Agent 必须按某个 step 顺序执行。

## 2. 事实源与职责

| 组件 | 负责 | 不负责 |
| --- | --- | --- |
| OpenCode | Session、历史、Agent 循环、Skill、模型、工具和权限 | WebSocket 接入、本体服务实现 |
| ACP Bridge | Profile 白名单、进程生命周期、WebSocket 与 stdio 转发、窄幅安全门控、静态 UI | Session 数据库、消息语义转换、检索调用 |
| Agent Console UI | 发送 Prompt、取消、权限回复、展示 ACP 事件和 artifact | 权威历史、Agent 编排、检索执行 |
| 8010 OAG | embedding、LanceDB Top-K、本体锚点与连接子图、检索 API | Agent 会话和回答策略 |
| Agent Profile | 声明运行配置、Skill、参数和版本 | 固定工具调用顺序 |

## 3. 运行拓扑

```text
Browser
   │ HTTP / WebSocket
   ▼
Agent Console
├── acp-ui Web 衍生版
└── ACP Bridge
       │ stdio NDJSON / JSON-RPC
       ▼
   opencode acp
       │ Agent 自主 Bash
       ▼
项目级 Skill 脚本
       │ HTTP
       ▼
8010 OAG
├── BGE-M3
├── LanceDB cosine Top-K
└── 本体图检索
```

浏览器不得直接连接 8010、LanceDB 或后续的 NebulaGraph。首版 Agent Console 和
OpenCode 在同一可信主机运行；8010 和数据库可独立运行。

## 4. Agent Profile 与进程模型

- 一个 Profile Revision 对应一个逻辑 ACP 入口：
  `WS /agents/:profileId/acp`。
- 一个活跃 WebSocket 连接对应一个 `opencode acp` 子进程。
- 每个 Profile 同时只允许一个活跃 WebSocket 客户端。
- 一个 OpenCode 进程可以管理该 Profile 下的多个 Session。
- 浏览器为每个已连接 Profile 复用一条 ACP 连接，并按
  `profileId + sessionId` 把 `session/update` 路由到独立会话状态。
- 不同 Profile 可以同时连接和执行；切换可见会话不会取消后台 Profile 的当前轮次。
- 首版同一 Profile 同时只允许一轮 `session/prompt`，但其多个 Session 可以同时保留
  和切换。该限制来自当前客户端每条 ACP 连接只有一个 Permission resolver，不是 ACP
  的 Session 能力限制。
- Session 永久绑定创建它的 Profile Revision，不能在会话中切换测试路径。
- 正式 Profile Revision 不可变，并拥有独立的 OpenCode 状态目录。
- `dev` Profile 可以修改，但其历史明确标记为非严格可复现。

WebSocket 断开时，Bridge 终止对应的 ACP 进程组；下次连接创建新进程，历史由
OpenCode 的 `session/list` 与 `session/load` 恢复。断线可能中止当前尚未完成的一轮，
但避免跨连接复用 JSON-RPC ID、旧响应或待处理 Permission。Bridge 不做消息缓冲或
协议级重放，也不引入 Gateway 会话数据库。

未连接该 Profile 时，UI 为 `session/list` 建立一个短生命周期 ACP 连接，读取完成后
立即关闭；创建或加载会话时再建立正式连接。该 Profile 已有活跃连接时，创建、加载和
刷新 Session 都复用同一连接，避免触发 Bridge 的同 Profile 第二连接拒绝。UI 不实现
本地伪删除。当前 ACP 没有删除持久 Session 的标准方法，因此正式删除通过窄幅 Bridge
扩展 `DELETE /agents/:profileId/sessions/:sessionId` 完成：只接受同源 loopback 请求，
校验 OpenCode Session ID，并使用所属 Profile 的 cwd、配置 overlay 和独立
`OPENCODE_DB` 执行无 shell 的 `opencode session delete`。浏览器请求必须通过 Origin
校验；无 Origin 的调用只用于本机 loopback 客户端。删除前 Profile 不能有任何在途
ACP 请求。Bridge 以 Profile 级 maintenance lock 原子覆盖检查、关闭空闲 ACP 进程、
CLI 删除和释放锁；锁内拒绝重连及同 Profile 的第二次删除。CLI 到期先终止进程组，再
升级为强制终止，因此请求和关停时间有界。前端把这次断开标记为预期维护，失效删除前
的旧 `session/list` generation，删除后重新加载原可见会话并刷新事实源；后续权威列表
若再次返回同一 Session，UI 必须如实显示，不能用永久 tombstone 掩盖异常复现。同一条
Session 的重复加载请求复用一个进行中的 `session/load`；历史重放完成前不能向该
Session 发送 Prompt，避免重复事件或重放与新一轮交错。

每个 Profile 必须至少设置独立的 `OPENCODE_DB`。`OPENCODE_CONFIG_DIR` 只作为配置
覆盖层，不能被当作阻止全局或项目配置加载的安全沙箱。具体实测结果见
[OpenCode ACP 能力矩阵](acp-capability-matrix.md)。

OpenCode 会在 `OPENCODE_CONFIG_DIR` 自动生成 `.gitignore`、包清单或依赖目录，因此
Bridge 不能把受版本控制或受发布锁保护的 Profile 源目录直接设为该变量。每次启动前，
Bridge 只把 Profile 声明的 OpenCode 配置文件同步到该 Profile 的可写
`.runtime/opencode/<id>/config/`，并把这个运行时目录设为 `OPENCODE_CONFIG_DIR`。
Skill 仍从只读 Profile Bundle 发现；OpenCode 生成物只留在已忽略的 runtime state。

## 5. 安全边界

Agent 被允许执行 Bash，因此 ACP 入口接近远程终端能力。

- 首版强制只监听 loopback；不能通过环境变量改成内网或公网地址。
- WebSocket 校验浏览器 `Origin`；默认只接受同源 Console 和本地 Vite 开发地址。
- 浏览器只能选择服务端白名单中的 `profileId`，不能提交命令、工作目录或环境变量。
- Bridge 校验 Session cwd 必须与 Profile 一致，并拒绝客户端注入 MCP Server。
- Bridge 拒绝客户端切换模型、Mode 或 Session 配置；这些值属于 Profile 测试基线。
- Profile 只引用环境变量名；密钥值只注入后端进程。
- OpenCode 子进程不继承宿主全部环境，只得到最小系统变量与 Profile 明确声明的变量。
- Agent stdout 专用于 ACP NDJSON，运行日志必须写 stderr。
- UI 对 tool output、Markdown 和图标签进行安全处理，不执行任意 HTML/脚本。
- ACP Permission 事件是交互能力，不是主机安全隔离边界。
- 首版不支持公网、多租户或用户级权限隔离。

## 6. 可观测性边界

首版完整展示 ACP 能观察到的执行：

- 用户消息和 Agent 消息；
- Agent 主动输出的 thought chunk；
- Agent 主动输出的可变 Plan（只展示，不把它当成固定 Workflow）；
- Tool Call 的开始、更新、完成、错误、输入和输出；
- 权限请求、取消和完成状态；
- UI 在线观察到的调用耗时；
- 实时 Agent 回答成功完成时，浏览器当地完成时间和从 `session/prompt` 调用到响应的
  客户端观测总耗时；
- 结构化本体 artifact。

Tool 卡片保存归并后的当前状态；现有 Traffic Monitor 诊断组件不进入 Demo 的固定
Profile 导航，也不是持久审计日志。历史事实源始终是 OpenCode，浏览器内存不承担长期
Trace 或合规留存。

Skill 通过 Bash 调用检索脚本时，ACP 只观察到 Bash Tool Call。首版不把 embedding、
Top-K 和图算法伪装成多个 Agent Tool Call。需要内部阶段追踪时，在 8010 中加入
OpenTelemetry 或另行定义 `ontology.trace.v1`。

OpenCode 1.17.16 的原生 Tool Part 虽然存有开始和结束时间，ACP Adapter 并未投影这些
字段；历史加载后无法恢复精确耗时。ACP 也不会投影所有 OpenCode 私有 Part。因此本
设计称其为“完整的 ACP 可观察执行”，不称为 OpenCode 原生历史的无损镜像。
同理，`session/load` 不提供每轮 Agent 回答的权威完成时间和总耗时；实时页脚在重新
加载历史后消失是诚实的信息边界，不能用 Session `updatedAt` 或加载耗时伪造。

## 7. UI 复用策略

首版基于 [formulahendry/acp-ui](https://github.com/formulahendry/acp-ui) 的 Web
实现，固定到：

```text
version: 0.1.16
commit: cd9c3cb464a4b321bff652101953a64c07473e31
license: MIT
```

只修改以下边界：

1. Agent 列表来自 ACP Bridge `/agents`，不允许浏览器配置任意命令或地址。
2. Session 列表以 Agent 的 `session/list` 为事实源。
3. 保留 ACP Tool Call 的 `rawInput`、`rawOutput`、状态与时间。
4. 增加 `ontology.subgraph@v1` 的轻量 artifact renderer。
5. 移除上游默认启用的 Azure Application Insights；内部数据不得发送到第三方。
6. 对 Markdown 输出进行 HTML 消毒；不能直接信任 Agent 或 Tool 返回的 HTML。
7. Prompt 等长任务不能沿用普通 JSON-RPC 请求的短超时。
8. UI 不维护自己的 Session 数据库；每个固定 Profile 分组通过 `session/list` 刷新。
9. Agent 最终消息若整体是 JSON object/array，或以合法的 `json`/`application-json`
   fenced object/array 收尾，UI 只在渲染时提取 JSON 并重新缩进为 `<pre><code>`，
   放入标题为“查询Plan”的可折叠卡片；末尾 fence 之前的 Markdown 仍照常显示，
   ACP chunk、内存消息和 OpenCode Session 中的原始文本保持不变。
10. 单页保留一个 `ChatView`。固定 Profile 以项目分组展示，每组只有只读信息和新建
    对话两个 Profile 操作；组内合并打开会话与可恢复历史，不能改变既有 Session 的
    Profile 绑定。
11. 每个打开会话拥有独立消息、Tool Call、回放和运行状态；当前会话键只决定
    `ChatView` 投影。后台 Session 事件仍按 `sessionId` 写入其自身状态。
12. 冷启动的新 Session 若在用户切换到其他 Profile 或会话后才创建完成，只加入打开
    会话列表，不抢占当前 `ChatView`。
13. `/agents` 仅增加经过审查的 Model ID、Retrieval 参数和 Ontology ID 等脱敏元数据，
    用于 Profile 信息卡；不返回 endpoint、密钥、环境变量名、命令或状态目录。
14. Session 行的垃圾桶按钮调用 Profile-aware 删除端点；运行或等待 Permission 的
    Profile 禁止删除。删除活动会话后优先选择同组相邻会话；删除其他历史会话后，
    原可见会话应在维护断开后自动恢复。
15. 实时成功回答末尾显示当地完成时间和总耗时；取消不显示 `Completed`，历史回放不
    伪造时序。
16. Thinking、Skill 加载、Execute/Bash 和普通 Tool 使用四种语义图标，不能都投影成
    终端图标。图标只帮助快速扫描，不改变 ACP 事件类别或 Agent 调用行为。
17. Tool Call 整卡、ACP Plan 和完整 Assistant JSON 都可展开/折叠；折叠只影响展示，
    不丢弃 Tool 输入、输出、状态、artifact 或消息原文。
18. Tool UI 不展示通用的 `ACP content` 面板，但底层 Tool Call 的 `content` 字段必须
    保留，供 `rawOutput` 缺失或 artifact 位于 `content` 时继续识别结构化结果。
19. Tool Call、ACP Plan 与“查询Plan”等形式化卡片的标题只占一行，超出宽度时省略；
    标题元素使用 `title` 暴露全文，完整命令仍可从展开后的 Input 查看。
20. 桌面端 Session 行压缩上下留白以提高历史列表密度；移动端不能直接复用紧凑尺寸，
    Session 行和行内操作仍保持至少 44 px 的触控目标。

上游当前 Tool Call 卡片会丢弃 `rawInput` 和 `rawOutput`，Session 列表也主要保存在
浏览器 localStorage。这两点与本设计的 Agent-authority 原则冲突，因此必须进行上述
窄幅修正。UI 不引入 `@ontology/viz`，图仅是对话内的小型 SVG 预览。

上游还直接使用 `v-html` 渲染 `marked` 的输出；`marked` 本身不负责清理原始 HTML。
衍生版必须使用 DOMPurify 或等价方案处理结果。Bridge 端点由服务端 Catalog 提供，
浏览器 localStorage 不保存 Agent Token、内网地址或环境变量。

JSON 自动格式化是展示层投影，不是协议转换。整条消息为完整、可解析且顶层是
object/array 时，或消息末尾是带 `json`/`application-json` 标记、内容为合法
object/array 的 fenced code block 时，JSON 部分进入“查询Plan”折叠卡。后一种形式中
fence 前的说明继续按安全 Markdown 渲染。流式传输尚未闭合、JSON 标量、非末尾 fence、
普通 Markdown 和无效 JSON 继续走安全 Markdown 路径。格式化后的 JSON 内容必须作为
文本转义，不能重新解释其中可能出现的 HTML；任何分支都不改写 Store 或 OpenCode
保存的消息原文。

形式化内容统一采用“单行摘要 + 可折叠正文”的信息层级。Tool Call 摘要保留语义图标、
名称、状态和可用耗时，展开后展示 Input、Output 与 artifact；ACP Plan 和查询 Plan
采用同一交互语言。通用 `ACP content` 不再单独复制成第三块正文，以避免与 Output
重复，但该字段仍留在内存事件投影中，artifact 提取器可以继续读取它。

多会话状态同样只是在线展示投影。浏览器内存保存当前页面打开的 Conversation，
OpenCode 仍是持久历史事实源；刷新页面后通过 `session/list` 和 `session/load` 恢复，
不新增前端会话数据库。后台 Profile 出错或断开时，只降级该 Profile 的会话，不清空
其他 Profile 或当前正常会话。全局 Permission 对话框必须标识请求所属 Profile 和
Session，并把选择结果送回原 ACP 连接。

## 8. 双基线验证与验收

项目保留一个最小 OpenCode CLI 预检层：

```text
同一问题 + deepseek/deepseek-v4-flash
  ├─ oag
  │    Agent 关键词
  │      → BGE-M3 Top 5 本体实体
  │      → 命中实体作为锚点
  │      → Steiner 最小连通子图
  │      → data-query-plan.v1
  └─ direct-context
       Prompt 内嵌完整精简 YAML 本体
         → 禁止全部 Tool
         → data-query-plan.v1
```

两条路径都由 OpenCode Agent 生成查询任务。实例数据查询引擎当前仍是未接入的黑盒，
因此禁止把查询计划伪装成答案。运行器只显式选择模型 ID，并复用 OpenCode 用户级认证；
模型不可用就停止，不提供 fallback。

事件流、Tool Call、最终 JSON 和耗时写入 ignored artifacts。该层用于检查索引、模型
认证和 Agent 语义，不作为最终验收。

最终合格标准是同样两条配置通过 Agent Console 的 WebUI 实际运行：

```text
Browser
  → Profile Catalog
    ├─ baseline-oag
    │    → WebSocket Bridge → OpenCode ACP
    │      → Skill → Bash wrapper → 8010 OAG
    │      → Tool Call 卡 + data-query-plan.v1
    └─ baseline-direct-context
         → WebSocket Bridge → OpenCode ACP
         → Prompt sidecar 中的完整 YAML 本体
         → 无 Tool Call + data-query-plan.v1
```

两个 Profile 固定同一模型 ID，但使用各自的 OpenCode Session 数据库。UI 分别调用，
不做同步广播；用户必须能从页面看到实际消息和工具事件，并在断开后从 OpenCode
`session/list`/`session/load` 恢复历史。只有该链路通过，双基线才标记为合格。

该合格标准验证的是端到端接线：必需 Tool 路径、检索载荷、子图和查询计划均在 WebUI
可观察。OAG Profile 不设置固定 `steps`，本机 Demo 中 Bash 保持开放，让 Agent 能在
观察后反思并继续调用；模型自主产生的额外 Tool 尝试也按真实状态展示，但非关键调用
不掩盖已经成功的必需路径。在线 Tool 耗时由 UI 观测；实时最终回答显示浏览器当地
完成时间和整轮总耗时。历史通过 `session/load` 重放时，OpenCode `1.17.16` 不投影
原生 Tool 时间戳，卡片显示 `Timing unavailable`，回答不显示伪造的完成页脚，均属于
已知预期。

开放任意 Bash 与“OAG 是唯一Ontology来源”之间存在不可消除的软边界：在同一用户、
无文件系统沙箱的进程里，Agent 可以绕过 wrapper 读取仓库中的示例 TTL。UI 必须完整
显示这种行为。出现绕行的 Session 仍可证明 ACP/WebUI 接线，但不能视为语义隔离有效的
OAG 基线，也不能用于路径效果结论。

## 9. 首版不做

- Agent 同步广播和自动结果对比；
- 同一 Profile 内多轮 Prompt 并发；
- 跨 Profile 共享或迁移 Session；
- 自有消息/Trace 数据库；
- 完整图分析器和可编辑图；
- 公网、多用户、SSO；
- Agent Runtime 容器化；
- 强行展示模型未通过 ACP 输出的隐藏思维过程。

## 10. 实现原则

1. 文档和 Schema 先于代码。
2. 优先复用 ACP SDK、acp-ui 和 OpenCode 原生能力。
3. Bridge 保持薄传输层；只做 Profile、Origin、cwd、MCP 注入和资源上限等窄幅门控，
   不复制或改写 Agent 语义。
4. 发现上游能力与设计不符时，先更新本文和决策记录，再修改实现。
5. Python 代码始终通过当前项目的 uv 环境执行。

## 11. 主要资料

- [Agent Client Protocol](https://agentclientprotocol.com/)
- [ACP transport](https://agentclientprotocol.com/protocol/v1/transports)
- [ACP session setup、load 与 resume](https://agentclientprotocol.com/protocol/v1/session-setup)
- [ACP session list](https://agentclientprotocol.com/protocol/v1/session-list)
- [ACP tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls)
- [OpenCode ACP 文档](https://opencode.ai/docs/acp/)
- [OpenCode ACP Adapter 源码](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/acp/agent.ts)
- [acp-ui 固定源码版本](https://github.com/formulahendry/acp-ui/tree/cd9c3cb464a4b321bff652101953a64c07473e31)
