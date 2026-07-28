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

- 状态：接受
- 决策：首版只监听本机或受控内网；浏览器不能提交命令、cwd 或环境变量。

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
- 补充：当前 ACP 没有删除持久 Session 的标准方法，UI 不提供伪删除按钮。

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

- 状态：本地基线实施中采纳
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
