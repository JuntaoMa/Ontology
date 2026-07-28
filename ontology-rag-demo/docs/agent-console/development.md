# Agent Console 开发与验证

状态：实施中

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

```bash
cd ontology-rag-demo
UV_CACHE_DIR=.uv-cache uv run --locked --env-file .env ontology-rag serve
```

验证：

```bash
curl -fsS http://127.0.0.1:8010/health
```

响应中的 `ontology_sha256` 是当前 `ONTOLOGY_PATH` 文件摘要，不包含源路径。不可变
Profile 的 Skill wrapper 会在检索前用它核对发布锁；`dev` Profile 没有固定摘要，
因此仍适合快速迭代。

### 阶段 C：Agent Console

开发模式将使用 Vite，并把 `/agents`、`/health` 和 WebSocket 代理到 ACP Bridge。构建模式
由 Bridge 直接托管静态文件。

安装并锁定 Node 依赖：

```bash
pnpm install --frozen-lockfile
```

在已经 `source ontology-rag-demo/.env` 的同一个终端启动 Bridge 和 Vite：

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
pnpm --filter ontology-agent-console start
```

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

### 阶段 D：发布不可变 Profile

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
