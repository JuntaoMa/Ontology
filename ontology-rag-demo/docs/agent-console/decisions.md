# Agent Console 实现决策记录

## ADR-001：OpenCode 是唯一 Agent Runtime

- 状态：接受
- 决策：Session、历史、工具和 Agent 循环均由 OpenCode 管理。
- 结果：ACP Bridge 不建立消息数据库，不把 ACP 转换为 OpenAI Chat API。

## ADR-002：必须使用 ACP

- 状态：接受
- 决策：内部版 OpenCode 无法直接接入目标 Web UI，因此浏览器通过 ACP Bridge 连接
  `opencode acp`。

## ADR-003：Profile 而非 Workflow

- 状态：接受
- 决策：配置声明 Agent、模型、Skill、工具参数和数据版本，不声明固定执行步骤。

## ADR-004：可信单用户与固定 Profile 白名单

- 状态：被 ADR-023 收紧
- 原决策：首版只监听本机或受控内网；浏览器不能提交命令、cwd 或环境变量。
- 当前约束：首版只允许 loopback；“受控内网”也必须等认证和主机隔离设计完成后再开放。

## ADR-005：一 Profile 一持久进程

- 状态：被 ADR-017 取代
- 原决策：每个 Profile 按需启动一个持续运行的 ACP 子进程，同时只允许一个客户端。

## ADR-006：Profile YAML 是可执行清单

- 状态：接受
- 决策：Gateway 直接读取、校验并执行 Profile；说明和运行配置不维护两份。

## ADR-007：Session 绑定不可变 Profile Revision

- 状态：接受
- 决策：正式 Profile 拥有独立 OpenCode 状态目录；保留可变 `dev` Profile。

## ADR-008：轻量子图 Artifact

- 状态：接受
- 决策：Bash stdout 使用 `ontology-artifact.v1`，UI 只提供小型 SVG 预览，不引入
  `@ontology/viz`。

## ADR-009：复用 acp-ui 的 Web 能力

- 状态：接受
- 上游：`formulahendry/acp-ui` `0.1.16`
  (`cd9c3cb464a4b321bff652101953a64c07473e31`)。
- 决策：固定版本进行浅分叉，不修改 ACP 会话语义。

## ADR-010：移除上游遥测

- 状态：实现中发现并采纳
- 事实：固定版本的 acp-ui 默认启用 Azure Application Insights，并内置第三方
  instrumentation connection string。
- 决策：Web 衍生版完全移除该依赖和调用。
- 原因：本系统可能显示内部 Prompt、Agent 名称和工具错误，不能默认向第三方发送任何
  运行遥测。

## ADR-011：补齐上游 Tool 原始数据和 Agent Session 列表

- 状态：实现中发现并采纳
- 事实：
  - 上游 `ToolCallInfo` 只保存标题、类型、状态和位置，丢弃 ACP 的 `rawInput`、
    `rawOutput`；
  - 上游 Web UI 主要使用 localStorage 中的 Session 索引，而没有把
    `session/list` 作为事实源。
- 决策：
  - 保留并展示 ACP Tool Call 原始输入输出；
  - Session Catalog 从 Agent 的 `session/list` 获取；
  - 浏览器状态只作为非权威 UI 偏好，不作为 Session 事实源。
- 原因：满足“OpenCode 拥有历史、UI 只投影”的系统边界。

## ADR-012：不从 OpenCode 私有数据库补齐 ACP 信息

- 状态：实测后采纳
- 事实：OpenCode 1.17.16 的 ACP Adapter 不投影 Tool 原生时间戳和部分私有 Part。
- 决策：在线耗时由 UI 临时计算；历史耗时缺失时明确标记，不让 Bridge 读取 OpenCode
  数据库进行语义补丁。
- 原因：保持 ACP 边界和未来 Agent 可替换性。

## ADR-013：每个 Profile 使用独立 `OPENCODE_DB`

- 状态：实测后采纳
- 事实：相同 cwd 且共用数据库时，`session/list` 会混合不同 Profile 的 Session。
- 决策：Bridge 为每个 Profile 注入不同的绝对 `OPENCODE_DB`，正式 Revision 不复用。
- 注意：`OPENCODE_CONFIG_DIR` 是覆盖层，不是安全沙箱；Profile 探针仍需核对实际加载
  的项目级和全局配置。

## ADR-014：所有富文本在浏览器中消毒

- 状态：上游审查后采纳
- 事实：acp-ui 0.1.16 使用 `v-html(marked.parse(...))`，而 `marked` 不清理原始 HTML。
- 决策：使用 DOMPurify 处理 Markdown 结果；Tool 原始输出默认放在纯文本代码块中；
  artifact 标签只通过 `textContent`/Vue 文本插值显示。
- 原因：Agent、Tool 和本体标签均是不可信输入。

## ADR-015：长 Prompt 不使用普通请求超时

- 状态：上游审查后采纳
- 事实：acp-ui 的通用 JSON-RPC 请求有 60 秒超时，长时间 Agent Prompt 可能仍在正常
  工作却被 UI 判定失败。
- 决策：`session/prompt` 不设置普通短超时；依靠 ACP Cancel、连接关闭和 Profile
  运行限制控制。初始化、能力探针和短管理请求保留明确超时。

## ADR-016：浏览器不保存 Agent 地址或凭据

- 状态：上游审查后采纳
- 事实：acp-ui Web 默认把 Agent URL 和 Header 写入 localStorage。
- 决策：衍生版只从同源 `/agents` 获取固定 Profile Catalog；不展示 Agent 设置页，
  不在浏览器保存 Token、命令、cwd、内网地址或环境变量。

## ADR-017：ACP 子进程与 WebSocket 连接同生命周期

- 状态：实现中修正并采纳
- 事实：浏览器断线后若继续复用原 stdio ACP 进程，新客户端会重置 JSON-RPC 请求 ID；
  旧响应、断线期间事件和待处理 Permission 可能被错误匹配。正确复用需要 Bridge 保存
  和解释协议状态。
- 决策：一个活跃 WebSocket 对应一个 ACP 子进程；连接关闭后终止进程。新连接创建新
  进程，通过 Agent 的 `session/list` 和 `session/load` 恢复历史。
- 代价：页面断线会中止尚未完成的一轮。
- 原因：保持 Bridge 透明和无状态，比实现不可靠的短期消息缓冲更安全、简单。

## ADR-018：本地 Catalog 返回 Profile cwd

- 状态：实现约束下采纳
- 事实：ACP `session/new` 和 `session/load` 要求客户端提供 Agent 主机上的绝对 cwd；
  Bridge 若隐藏并代填该值，就必须解析和改写 ACP 语义。
- 决策：首版本地 `/agents` 返回固定 Profile cwd，UI 不允许用户修改；不返回命令、
  配置目录、状态目录或环境变量。
- 约束：仅适用于已经接受的 loopback/可信网络模式。公网或多用户版本必须重新设计，
  不能直接暴露主机路径。

## ADR-019：上游依赖采用兼容安全补丁版本

- 状态：依赖审计后采纳
- 事实：acp-ui 0.1.16 的锁定依赖及最初脚手架版本中，`ws`、`ajv`、`yaml`、
  Vite/PostCSS 已有对应安全公告。
- 决策：保留 acp-ui 源码基线和 ACP SDK 版本，但将这些基础依赖升级到兼容的已修复
  补丁版本；提交前重新运行生产依赖审计。
- 边界：审计同时报告的其他现有 Workspace 应用问题不在本任务中顺带修改。

## ADR-020：Session Catalog 使用短生命周期 ACP 连接

- 状态：实现中采纳
- 事实：Bridge 坚持一个 WebSocket 对应一个 ACP 子进程；未进入对话前仍需要读取
  OpenCode 的 `session/list`。
- 决策：选择 Profile 时建立短生命周期连接，执行 `initialize` 和分页
  `session/list` 后关闭；创建或加载会话时再建立正式连接。已有活跃会话时复用该连接。
- 结果：不增加 Session 后端或协议多路复用；代价是进入会话前多启动一次轻量 ACP
  进程。
- 补充：当前 ACP 没有删除持久 Session 的标准方法。UI 不做本地伪删除；后续
  ADR-035 采用窄幅 Profile-aware Bridge 端点调用 OpenCode 原生 CLI。

## ADR-021：Profile 发布采用严格 Bundle 与外部本体摘要

- 状态：实现中采纳
- 决策：`dev` Profile 可变；正式 Revision 由发布器复制小型配置、Skill 和脚本，
  扫描敏感内容与数据文件，并生成逐文件 SHA-256 lock。本体、LanceDB、模型和密钥不
  复制进 Bundle，只记录本体逻辑标识和调用方提供的 SHA-256。
- 结果：Profile 可以迁移和审计，同时不会把真实业务本体源材料或私有配置带入仓库。

## ADR-022：OpenCode 配置源与可写运行目录分离

- 状态：真实运行后修正并采纳
- 事实：OpenCode 会在 `OPENCODE_CONFIG_DIR` 自动创建 `.gitignore`、包清单和依赖；
  直接指向 Profile 源目录会污染 `dev`，也会使不可变 Bundle 的 exact-file lock 失效。
- 决策：Profile 中的 `opencode.config` 是受版本控制的单一配置源。Bridge 启动前将它
  同步到 Profile 独立 state 下的 `config/`，并仅把该可写目录设为
  `OPENCODE_CONFIG_DIR`。Skill 路径通过只读 `ONTOLOGY_PROFILE_DIR` 指向 Bundle。
- 结果：OpenCode bootstrap 生成物可被忽略和复用，正式 Bundle 不发生运行时写入；
  发布器也只复制声明的配置文件，不遍历配置目录中的生成物。

## ADR-023：首版强制 loopback，并门控 Session 参数

- 状态：安全审查后采纳
- 事实：开放 Bash 的 ACP 入口等同远程代码执行；仅依靠 Origin 或“受控内网”不足以
  支撑无认证监听。直接 ACP 客户端还可以绕过 UI，提交其他 cwd 或注入 MCP Server。
- 决策：首版 Bridge 只允许 `127.0.0.1`/`::1`，WebSocket 必须带允许的 Origin；
  `session/new`、`session/load`、`session/resume`、`session/fork` 和 `session/list` 的
  cwd 必须等于 Profile 固定 cwd；所有可携带 `mcpServers` 的 Session setup 请求都
  禁止注入非空列表。Profile 已固定模型和默认 Agent，首版同时拒绝客户端
  `session/set_model`、`session/set_mode` 和 `session/set_config_option`。
  Bridge 只校验，不改写 JSON-RPC。
- 结果：当前版本明确是本机 Demo；受控内网部署也要等认证和主机隔离设计完成后再开放。

## ADR-024：Profile 声明必须映射为实际运行变量

- 状态：一致性审查后采纳
- 事实：若模型、endpoint、Top-K 和图算法只写在 YAML，而配置与脚本继续硬编码，
  Profile 会成为误导性的双份说明。
- 决策：Bridge 从 Profile 解析环境引用，并注入规范化的
  `ONTOLOGY_MODEL_*`、`ONTOLOGY_RETRIEVAL_ENDPOINT`、`ONTOLOGY_VECTOR_TOP_K` 和
  `ONTOLOGY_GRAPH_ALGORITHM`；OpenCode 配置和 Skill wrapper 只消费这些变量。
  本体文件位置只属于 8010，不再注入可执行 Bash 的 Agent 进程。
- 补充：子进程不继承宿主全部环境，只继承最小运行环境和 Profile 明确声明的变量。

## ADR-025：执行视图不是独立审计日志

- 状态：实现边界复核后采纳
- 事实：OpenCode 是历史事实源；UI 的 Tool 卡片表示 ACP 更新归并后的当前状态，
  Traffic Monitor 仅保留最近 500 条传输事件。首版又明确不引入第二套会话数据库。
- 决策：对话页完整展示当前连接中 ACP 可观察的消息、计划、工具状态和 artifact；
  Traffic Monitor 明确定位为有界诊断视图，不宣称是不可丢失、可追责的审计日志。
- 结果：刷新后的权威历史仍从 OpenCode `session/list`/`session/load` 读取；需要长期
  Trace 时，应由 OpenCode 或独立可观测系统提供，不能把浏览器内存当作事实源。

## ADR-026：断开时终止整个 ACP 进程树

- 状态：生命周期审查后采纳
- 事实：Agent 可通过 Bash 启动子进程。只向 `opencode acp` 主进程发送信号，不能保证
  它启动的命令同时退出，可能留下继续访问模型或 8010 的孤儿进程。
- 决策：POSIX 下以独立进程组启动 ACP Runtime，连接关闭时先发 `SIGTERM`，短暂等待后
  对进程组发 `SIGKILL`；Windows 保留直接终止子进程的兼容路径。
- 边界：这是本机 Demo 的资源回收策略，不替代容器、cgroup 或主机级沙箱。

## ADR-027：ACP 探针复用 Profile 运行映射但使用临时配置 Overlay

- 状态：实现中采纳
- 事实：手工向探针重复传入 cwd、OpenCode 配置目录和状态数据库，容易与实际 Bridge
  运行环境漂移；同时 OpenCode 会向 `OPENCODE_CONFIG_DIR` 写入 bootstrap 文件。
- 决策：`probe:acp -- --profile <profile.yaml>` 通过同一 Profile Loader 获取命令、
  cwd、必需环境变量和规范化的 `ONTOLOGY_*` 变量。探针继续使用 Profile 的
  `OPENCODE_DB` 读取真实 Session，但把配置复制到 `state_dir` 下的唯一临时 overlay，
  退出后删除。
- 约束：Profile 模式不接受命令、cwd 或环境覆盖；它应在 Console 启动前运行，避免
  两个 ACP 进程同时操作同一 Profile 状态。

## ADR-028：不可变 Profile 在检索前校验 OAG 本体摘要

- 状态：外部输入一致性审查后采纳
- 事实：Bundle lock 只能证明 Profile、配置和 Skill 未变；若 lock 中的本体 SHA-256
  只是发布者声明，就不能证明 8010 当前读取的是同一份本体。
- 决策：8010 `/health` 返回实际 `ONTOLOGY_PATH` 文件的 SHA-256。不可变 Profile 将
  lock 中的摘要注入 `ONTOLOGY_EXPECTED_SHA256`，Skill wrapper 在每次检索前比对；
  缺失或不一致时拒绝执行。可变 `dev` Profile 不做此门控。
- 边界：该摘要验证本体源文件，不证明 LanceDB 索引、外部实例数据或黑盒查询引擎与
  本体来自同一次构建；这些输入以后需要独立 manifest。

## ADR-029：先用 OpenCode CLI 固定双基线语义，再发布为 ACP Profile

- 状态：已完成，作为 WebUI 验收前置检查保留
- 目标：用同一问题和同一模型验证两种本体上下文路径，一条由 Agent 提取关键词后调用
  OAG，另一条把完整的小型本体直接放入 Agent prompt。当前输出都是数据查询任务，不
  查询实例数据，也不生成业务答案。
- 决策：第一轮使用两个受版本控制的 OpenCode Agent 配置和一个 uv 运行器。模型固定为
  `deepseek/deepseek-v4-flash`，只复用当前系统用户的 OpenCode 认证；项目不复制
  provider、API 地址或密钥。运行前模型不可用时立即失败，禁止静默换模型。
- OAG 语义：LanceDB 只索引本体实体，每条向量文本严格为
  `name\nlabel\ncomment`，不混入文档块或边文本。Agent 给出的关键词用 BGE-M3
  召回 Top 5，命中实体直接作为 Steiner 最小连通子图的锚点。
- Direct-context 语义：Prompt 直接包含完整的精简 YAML 示例本体，并在配置层禁止全部
  工具。本体文件读取、Skill 和 OAG 调用都不属于这条路径。
- 记录：原始 OpenCode JSON 事件流、最终 `data-query-plan.v1`、耗时和 OAG 日志写入
  Git ignored artifacts。首轮不做自动优劣比较。
- 边界：CLI 运行器是语义与接线验证工具，不替代 ACP Bridge 或 Web UI。两条路径稳定
  后再把同样的 Agent 配置发布成可由 Console 选择的 Profile，避免现在同时修改
  Profile credential schema 和基线语义。

## ADR-030：双基线以 WebUI 实际运行作为合格标准

- 状态：已验证采纳
- 事实：CLI 已证明模型、BGE-M3、LanceDB、OAG 和 Prompt 语义可运行，但没有覆盖
  Profile Catalog、WebSocket Bridge、OpenCode ACP Session、Tool Call 投影和页面渲染，
  因此不能再把 CLI 成功称为完整基线验收。
- 决策：新增 `baseline-oag` 与 `baseline-direct-context` 两个独立 Profile，固定同一个
  `deepseek/deepseek-v4-flash` 模型并复用当前系统用户的 OpenCode 认证。两者使用独立
  `state_dir` 和 Session 数据库；UI 分别创建会话、发送同一个问题，不做同步广播。
- Profile 语义：模型声明区分由 Profile 定义的自有 endpoint 与 OpenCode 已知模型；
  认证区分环境变量密钥与 OpenCode 用户认证。Direct-context 允许空 Skill、无
  Retrieval、空必需环境变量；OAG Profile 只要求 8010 endpoint。
- 配置资产：OpenCode Prompt 继续保留为独立、人类可读的 Markdown 文件。Profile 显式
  声明 sidecar 资产，Bridge、ACP 探针和发布器把它们与 `opencode.jsonc` 一起复制到可写
  overlay；不得退回到把长 Prompt 内联进程序或 JSONC。
- 合格条件：浏览器必须能选择两个 Profile；两边都成功完成 `session/new` 和
  `session/prompt`；OAG 页面出现完成的 Skill/Bash Tool 历史与最终
  `data-query-plan.v1`；direct-context 页面没有 Tool 卡且输出同一协议；断开后
  OpenCode Session 仍可被列出和加载。CLI 运行器只保留为索引和模型预检。
- Agent 自主性：OAG Profile 不设置固定 `steps`，也不使用 wrapper-only Bash 白名单。
  本机 Demo 按既有安全边界开放 Bash，由 Skill 和 Agent Prompt 描述推荐路径；Agent
  可根据观察反思和继续调用，实际事件完整投影到页面。
- 边界：首版仍不增加并排比较、自动评分或自有历史数据库；页面展示
  和历史事实继续来自 OpenCode ACP。当前合格标准验证流程连通性，不把查询计划业务
  正确性、模型附带过渡语或非关键 Tool 权限拒绝混入接线判定；这些事实仍必须在 UI
  中完整可见。客户端可以显示当前在线轮次的观测耗时，但不把它写成 OpenCode 权威
  历史。

## ADR-031：loopback OAG 请求显式绕过系统代理

- 状态：已验证采纳
- 事实：macOS 上的 Python `urllib` 即使没有继承 `HTTP_PROXY`，仍可能读取系统代理
  设置。Bridge 的安全环境白名单原先同时移除了 `NO_PROXY/no_proxy`，导致 Agent
  wrapper 把 `127.0.0.1:8010` 请求发送到系统代理并收到 HTTP 502；同一命令在保留
  loopback 绕行时能返回真实 Top-5 和子图。
- 决策：当 Profile 的 Retrieval endpoint 是 loopback HTTP(S) 地址时，Bridge 在子
  进程环境中设置固定的 `NO_PROXY/no_proxy=localhost,127.0.0.1,::1`。不直接继承
  宿主完整绕行列表，避免把可能包含内网主机名的环境信息扩大到 Agent。
- 验证：回归测试覆盖固定映射；最终 WebUI OAG Session 的 wrapper 返回 HTTP 200、
  5 条 BGE-M3 命中、5 节点/4 边子图和 `data-query-plan.v1`。

## ADR-032：区分 WebUI 接线合格与基线语义隔离

- 状态：真实 WebUI 运行后采纳
- 事实：开放 Bash 的 OAG Session 在成功完成多次 wrapper 检索后，自主使用 `grep`
  读取了示例 TTL。页面完整记录了这些调用，但它绕过了“OAG 是唯一Ontology来源”的
  Prompt 约束。只要 Agent 与 OAG、示例本体处于同一用户可读文件系统，Prompt 不能
  提供强隔离。
- 决策：WebUI 接线合格表示 Profile、ACP Session、Skill、Bash、8010、artifact、最终
  消息和历史恢复均可观察地工作。若轨迹出现直接本体读取，则额外标记“基线语义污染”；
  该 Session 不用于 OAG 与 direct-context 的效果比较。
- 边界：首版保留用户已选择的开放 Bash 和 Agent 自主控制，不新增 wrapper-only
  Tool、容器或文件系统沙箱。未来需要严格实验隔离时，应把它作为独立门控能力，而
  不是隐藏或改写已发生的 Agent 轨迹。

## ADR-033：完整 JSON 只在展示层格式化

- 状态：接受
- 事实：两条基线故意要求模型输出裸 `data-query-plan.v1` JSON，以保持结果可直接
  解析；acp-ui 的 Markdown 渲染会把这种裸 JSON 当作普通段落并折叠缩进。
- 决策：最终 Agent 消息若整体是合法 JSON object/array，或以合法的
  `json`/`application-json` fenced object/array 收尾，UI 在渲染时使用两空格缩进，
  把 JSON 部分放入标题为“查询Plan”的可折叠安全代码块；末尾 fence 之前的 Markdown
  说明保留在卡片之外。ACP 事件、Session Store 和 OpenCode 历史仍保留 Agent 原始
  输出，不给 Prompt 增加 Markdown fence，也不改写消息内容。
- 安全边界：JSON 字符串按纯文本转义后再进入 HTML；流式未闭合 JSON、标量、非末尾
  fence、普通 Markdown 和无效 JSON 继续走现有 `marked` 加 DOMPurify 路径。

## ADR-034：单页按 Profile 复用 ACP 连接并路由多 Session

- 状态：WebUI 验证后采纳
- 事实：ACP 的 `session/prompt`、`session/cancel`、`session/update` 和
  `session/request_permission` 都携带 `sessionId`；OpenCode ACP 能在一个进程中管理
  多个 Session。现有“必须断开才能切 Agent”来自前端唯一 `acpClient`、唯一
  `currentSession` 和唯一消息数组，不是 ACP 或 Bridge 的限制。
- 决策：浏览器维护 `Profile -> AcpClientBridge` 和
  `(Profile, Session) -> ConversationState` 两级在线状态。每个 Profile 最多一条
  WebSocket/ACP 连接，同 Profile 的 Session 复用该连接；不同 Profile 可以同时连接
  和执行。`activeConversationKey` 只决定唯一 `ChatView` 显示哪条会话，后台事件继续
  按 `profileId + sessionId` 写入原会话。
- UI：固定 Profile 直接作为项目分组，每组提供只读信息和新建对话；组内合并已打开
  会话与可恢复 Session，不再保留全局 Profile Selector、独立的 Open/History 分组或
  断开按钮。不引入标签页框架、并排结果、同步广播或前端 Session 数据库。
- 并发边界：第一版允许不同 Profile 的 Prompt 真并行，同一 Profile 同时只允许一轮
  Prompt。当前 `AcpClientBridge` 每条连接只有一个 Permission resolver；同 Profile
  并发轮次可能覆盖权限交互。以后若需要解除限制，先把 Permission 改为按请求或
  Session 路由并补充 OpenCode 并发验证。
- 持久性：打开会话和运行状态只存在浏览器内存；页面刷新后仍以 OpenCode
  `session/list`/`session/load` 为事实源。后台 Profile 断线或报错不能清空其他
  Profile 的会话。
- 验证：同页启动 Direct-context 后，在其运行中创建 OAG Session；Direct 在后台完成，
  OAG 独立展示 Skill、Bash、子图和最终消息。相同 OAG 连接可再创建第二个 Session，
  另一轮执行时显示串行门控。刷新后仍通过 `session/list`/`session/load` 恢复历史。

## ADR-035：固定 Profile 项目侧栏、真实删除与在线完成元信息

- 状态：真实 WebUI 视觉与交互验证后采纳
- 事实：用户已接受项目式 Profile 侧栏原型。ACP `0.13.1` 没有持久 Session 删除；
  只移除浏览器行会在刷新后复现。OpenCode CLI 提供
  `opencode session delete <sessionID>`。同时，ACP 历史不投影每轮回答的权威完成时间
  和总耗时。
- UI 决策：每个 Catalog Profile 固定为一个可折叠分组；Profile 级操作只有脱敏信息
  与新建对话。Session 行保留独立状态点和直接垃圾桶按钮；活动/运行/等待权限状态不
  与删除图标共用区域。侧栏整体可折叠，单页仍只有一个可见 `ChatView`，其他 Profile
  可在后台继续执行。
- 删除决策：新增同源 loopback
  `DELETE /agents/:profileId/sessions/:sessionId`。Bridge 只接受严格 OpenCode Session
  ID，禁止请求体，使用 Catalog 所属 cwd、配置 overlay 与独立 `OPENCODE_DB`，并以
  参数数组而非 shell 启动 CLI。Profile 级 maintenance lock 在任一 ACP 请求在途、
  重连或同 Profile 删除进行中时返回 409，并原子覆盖关闭空闲 ACP 子进程、CLI 删除
  和释放锁。删除进程使用 TERM → 短 grace → KILL 的有界进程组终止。UI 将维护断开
  视为预期，失效删除前的旧列表 generation，成功后恢复原会话或选择相邻会话并刷新
  事实源；不保留会掩盖异常复现的永久 tombstone。
- Profile 信息：`/agents` 只增加 Model ID/source、Retrieval Top-K/算法和 Ontology ID
  等经过审查的非敏感字段；endpoint、密钥、环境变量名、命令、配置路径与状态目录仍
  不返回浏览器。
- 时序决策：实时 `session/prompt` 使用单调时钟计算客户端观测总耗时，成功响应用
  `Date.now()` 记录浏览器当地完成时间。`cancelled` 不显示 Completed。历史
  `session/load` 不使用 Session `updatedAt` 或加载耗时伪造页脚。
- 验证：在 1280×720、DPR 2 的同一浏览器视口对照静态稿；Profile/Session 标题左缘
  差为 0px，文件夹与标题中心差 0.5px，状态点和 28px 删除按钮间距 6px。实际 WebUI
  验证了侧栏/分组折叠、信息卡、删除确认及焦点恢复、实时完成页脚，并通过新建空闲
  Session → 删除 → 刷新不复现的持久删除检查。

## ADR-036：紧凑 Session 列表与形式化输出层级

- 状态：接受
- 事实：当前桌面 Session 行的文字与上下边界留白过大；Thinking、Skill 加载和 Tool
  执行都使用终端图标，无法快速辨别事件类型。Tool Call、ACP Plan 与最终 JSON 的展示
  结构也不一致，通用 `ACP content` 面板经常重复 Output。
- 密度决策：桌面 Session 行把上下留白压缩到原布局约一半，但不压缩标题字号或状态
  语义；移动端保持至少 44 px 的 Session 行和行内操作触控目标。
- 图标决策：Thinking、Skill 加载、Execute/Bash、普通 Tool 各使用语义不同的图标。
  分类只影响 UI，不修改 ACP Tool Call，也不通过图标推断新的执行步骤。
- 折叠决策：Tool Call 整卡、ACP Plan 和完整 Assistant JSON 均采用可展开/折叠的
  摘要结构；最终 JSON 摘要固定命名为“查询Plan”。折叠状态是临时 UI 偏好，不写回
  OpenCode Session。
- 标题决策：形式化卡片标题固定一行，溢出使用省略号；标题节点通过 `title` 提供全文。
  Tool 的完整命令仍在展开后的 Input 中，不依赖被截断的摘要。
- ACP 内容决策：Tool UI 只展示明确的 Input、Output 和结构化 artifact，不再提供
  通用 `ACP content` 面板。Store 仍保留底层 `content`，artifact 提取可以在
  `rawOutput` 不含标记时从该字段读取，因而这是去重展示而不是协议数据丢弃。
