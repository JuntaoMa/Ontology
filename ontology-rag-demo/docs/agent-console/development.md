# Agent Console 开发与验证

状态：双基线 WebUI 已打通，继续迭代

## 1. 前置条件

- macOS 或 WSL；
- Node.js `22.13` 或更高版本；
- 仓库声明的 pnpm 版本；
- OpenCode，当前开发机验证版本为 `1.17.16`；
- uv；
- Python `3.13.7`；
- 8010 OAG 所需的本地数据和环境变量。

Python 命令始终在项目目录使用 uv：

```bash
cd ontology-rag-demo
UV_CACHE_DIR=.uv-cache uv sync --locked
UV_CACHE_DIR=.uv-cache uv run --locked pytest
```

## 2. 开发阶段

### 阶段 A：ACP 能力探针

先把 Demo Profile 所需变量注入当前 shell。`.env` 已被 Git 忽略，`source` 后只对当前
终端及其子进程生效：

```bash
set -a
source ontology-rag-demo/.env
set +a
```

在接入 UI 前执行只读探针。推荐直接传入 Agent Profile；探针会使用 Profile 已校验的
命令、参数和固定 cwd，并从当前 shell 读取 Profile 声明的必需变量：

```bash
pnpm --filter ontology-agent-console probe:acp -- \
  --profile ontology-rag-demo/profiles/dev/profile.yaml
```

若要验证一个已经存在的 Session 的历史投影，可额外传入：

```bash
--load-session EXISTING_SESSION_ID
```

Profile 模式与 Bridge 使用同一组运行映射：

- `runtime.command`、`runtime.args` 和 `runtime.cwd` 不能被 CLI 覆盖；
- 缺少 `environment.required` 中的任意变量时，在启动 OpenCode 前失败；
- 模型、检索和本体声明转换为规范的 `ONTOLOGY_MODEL_*`、
  `ONTOLOGY_RETRIEVAL_ENDPOINT`、`ONTOLOGY_VECTOR_TOP_K`、
  `ONTOLOGY_GRAPH_ALGORITHM` 和 `ONTOLOGY_ID`；
- `OPENCODE_DB` 仍指向该 Profile 的独立状态数据库，使 `session/list` 和
  `session/load` 能看到 Console 使用的同一批 Session；
- 每次探针把受版本控制的 OpenCode 配置复制到 `state_dir` 下的唯一临时
  `config/` overlay。OpenCode 的 bootstrap 文件只能写入该 overlay，探针退出后删除，
  不得修改 `dev` 或不可变 Release Bundle。

`--profile` 不能和 `--command`、`--arg`、`--cwd`、`--env` 混用。原有显式命令模式
继续保留，主要用于测试其他 ACP 实现：

```bash
pnpm --filter ontology-agent-console probe:acp -- \
  --command opencode \
  --arg acp \
  --cwd /absolute/path/to/project
```

这一步只统计 `session/update` 类型，不输出消息、命令或 Tool 结果。端到端验收仍需验证：

- `initialize`；
- `session/new`；
- `session/prompt`；
- `session/cancel`；
- Tool Call 和 Tool Call Update；
- `session/list`；
- `session/load`；
- Permission 请求与回复。

探针输出只保存能力名称和成功/失败，不保存 Prompt、工具输出、API 地址或密钥。
本机实测基线见 [OpenCode ACP 能力矩阵](acp-capability-matrix.md)。

### 阶段 B：8010 OAG

双基线验收固定使用仓库中的简短示例本体、BGE-M3、LanceDB 和 CPU。首次迁移到新
机器时，在终端 1 从项目目录执行：

```bash
cd ontology-rag-demo
UV_CACHE_DIR=.uv-cache uv sync --locked

export SOURCE_ONTOLOGY_PATH=examples/smart-building/ontology.ttl
export SOURCE_DOCUMENT_PATHS=examples/smart-building/documents/operations-guide.txt
export ONTOLOGY_PATH=data/source/smart-building/ontology.ttl
export DOCUMENTS_DIR=data/source/smart-building/documents
export EMBEDDING_BACKEND=bge-m3
export EMBEDDING_MODEL=BAAI/bge-m3
export EMBEDDING_DEVICE=cpu
export EMBEDDING_BATCH_SIZE=2
export EMBEDDING_NORMALIZE=true
export LANCEDB_URI=state/baseline-oag-bge-m3/lancedb
export LANCEDB_TABLE=ontology_entities_v1
export VECTOR_TOP_K=5
export API_HOST=127.0.0.1
export API_PORT=8010
export HF_HUB_DISABLE_XET=1
export TOKENIZERS_PARALLELISM=false

UV_CACHE_DIR=.uv-cache uv run --locked ontology-rag prepare
UV_CACHE_DIR=.uv-cache uv run --locked ontology-rag build-index
UV_CACHE_DIR=.uv-cache uv run --locked ontology-rag serve
```

`build-index` 第一次会下载 `BAAI/bge-m3`。不要在新机器首次构建时设置
`HF_HUB_OFFLINE=1`；已有完整缓存后才可自行启用离线模式。后续复用同一索引时，只需
重新导出这些非敏感配置并执行最后一条 `serve` 命令。

验证：

```bash
curl -fsS http://127.0.0.1:8010/health
```

至少确认 `embedding_backend` 为 `bge-m3`，并且 `ontology_ready`、
`lancedb_ready`、`vector_index_ready` 均为 `true`。响应中的
`ontology_sha256` 是当前 `ONTOLOGY_PATH` 文件摘要，不包含源路径。不可变 Profile
的 Skill wrapper 会在检索前用它核对发布锁；可变 Profile 没有固定摘要，适合快速
迭代。

### 阶段 C：Agent Console

开发模式将使用 Vite，并把 `/agents`、`/health` 和 WebSocket 代理到 ACP Bridge。构建模式
由 Bridge 直接托管静态文件。

安装并锁定 Node 依赖：

```bash
pnpm install --frozen-lockfile
```

开发 `dev` Profile 时，在已经 `source ontology-rag-demo/.env` 的同一个终端启动
Bridge 和 Vite：

```bash
pnpm --filter ontology-agent-console dev
```

默认地址：

```text
Vite UI:    http://127.0.0.1:5173
ACP Bridge: http://127.0.0.1:4310
```

生产构建与本地启动：

```bash
pnpm --filter ontology-agent-console build
OAG_BASE_URL=http://127.0.0.1:8010 \
  pnpm --filter ontology-agent-console start
```

双基线复用当前系统用户已经配置的 OpenCode provider 和认证，不需要项目内的 Qwen
密钥。启动前必须确认模型可见：

```bash
opencode models deepseek
```

输出必须包含 `deepseek/deepseek-v4-flash`。只有 `baseline-oag` 使用
`OAG_BASE_URL`；`baseline-direct-context` 不需要检索服务。

生产依赖审计：

```bash
pnpm --filter ontology-agent-console audit --prod
```

pnpm 的 audit 结果按整个 Workspace lockfile 汇总；判断本应用是否受影响时必须检查
finding 的依赖路径。当前审计中没有指向 `apps__agent-console` 的 finding；报告的
Vite/esbuild/ECharts 项均来自既有 `apps__ontology-validation`，不在本任务中顺带升级。

Bridge 默认读取 `ontology-rag-demo/profiles/`。可用非敏感环境变量
`AGENT_PROFILES_DIR`、`AGENT_CONSOLE_PORT` 和 `AGENT_CONSOLE_ALLOWED_ORIGINS`
覆盖部署位置。`AGENT_CONSOLE_HOST` 在首版只能取 loopback 地址；非回环地址会拒绝启动。

### 阶段 D：权威双基线 WebUI 验收

CLI 运行器和 ACP 探针只做预检，不能替代浏览器验收。在终端 1 保持 8010 运行、终端 2
保持 4310 运行，然后打开 `http://127.0.0.1:4310`，使用同一个问题：

```text
温度传感器所在的房间属于哪个建筑？
```

依次检查：

1. 选择 `baseline-direct-context`，点击 `New conversation` 并原样发送问题。页面没有
   Tool Call 卡，最终消息包含 `data-query-plan.v1`、`baseline=direct-context` 和
   原始问题。
2. 点击 `Disconnect`，选择 `baseline-oag`，新建会话并发送完全相同的问题。
3. OAG 页面至少出现成功完成的 `ontology-retrieval` Skill 和 wrapper Bash 调用。
   Bash 原始输出包含 5 条 `hits`、`graph`，并出现
   `minimum_connected_subgraph` 轻量子图卡；当前示例预期为 5 节点、4 边。
4. OAG 最终消息包含 `data-query-plan.v1`、`baseline=oag` 和原始问题。当前阶段验证
   流程连通性，不把查询计划的业务正确性或模型是否附带过渡语作为接线失败。
5. 本机 Demo 的 OAG Profile 开放 Bash，不用固定 `steps` 或 wrapper-only 白名单阻断
   Agent 的观察、反思和后续调用。Agent 自主提出的额外工具调用不得隐藏；UI 必须
   如实显示成功、失败或权限拒绝。只要必需的 Skill、OAG wrapper 和最终计划成功，
   额外的非关键调用不否定首版流程验收。
6. 两个 Profile 分别 `Disconnect`，刷新 `OpenCode sessions`，再点击刚才的 Session。
   `session/load` 后应恢复用户消息、Agent 消息、工具状态、原始输出、子图和最终结果。

在线执行时 Tool 卡显示 UI 观测到的耗时。OpenCode `1.17.16` 在
`session/load` 重放时不投影 Tool 的原生时间戳，所以恢复后的卡片显示
`Timing unavailable`；这是已知信息损失，不是验收失败。

开放 Bash 时，Prompt 中的“OAG 是唯一Ontology来源”只是软约束。若轨迹显示 Agent
直接读取 TTL、LanceDB 或其他本体实现文件，WebUI 接线仍可判为通过，但该 Session
必须标记为“基线语义污染”，不能用于两条路径的效果比较。要硬保证黑盒边界，必须另行
引入 wrapper-only Tool、进程沙箱或文件系统隔离；首版按已接受的 Agent 自主性暂不做。

### 阶段 E：发布不可变 Profile

`dev` Profile 用于快速迭代。固定测试基线时，把它发布成包含 SHA-256 lock 的新 Bundle：

```bash
pnpm --filter ontology-agent-console profile:publish -- \
  --profile ontology-rag-demo/profiles/dev/profile.yaml \
  --release-id baseline-v1 \
  --revision v1 \
  --ontology-sha256 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

最后一个参数必须替换为实际删减本体文件的 SHA-256；发布器不会复制本体源材料，也不会
覆盖已有 Release。

## 3. MVP 验收

双基线是否合格以“阶段 D”的浏览器实测为准。通用能力还必须满足：

1. `/agents` 只返回服务端 Profile 白名单和脱敏信息。
2. UI 能为指定 Profile 创建 OpenCode Session。
3. Agent 能自主加载 ontology retrieval Skill。
4. Agent 能调用 Bash 脚本访问 8010。
5. UI 展示 Bash 命令、状态、原始输出和错误。
6. `ONTOLOGY_ARTIFACT:` 子图能够显示为轻量 SVG 卡片。
7. Agent 可以根据 Tool 结果继续调用工具或生成最终回答。
8. Cancel 能停止当前 Prompt。
9. 页面重载后通过 `session/list` 和 `session/load` 恢复历史。
10. WebSocket 断开或 Profile 进程异常退出后能够报告故障；重新连接会创建新进程，
    并可从 OpenCode 恢复已有 Session。
11. 日志、HTTP 响应和前端状态不包含密钥或真实内网地址。

## 4. 上游偏差记录

实现中若发现已固定的开源上游与本设计不一致，必须：

1. 在 `decisions.md` 中记录事实和影响；
2. 更新 `system-design.md` 或 `protocols.md`；
3. 再修改代码和测试；
4. 在上游版本升级时重新核对这些偏差。
