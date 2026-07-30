# Agent Console 开发、迁移与验证

状态：双基线 WebUI 已打通

## 1. 前置条件

- macOS 或 WSL；
- Node.js `22.13` 或更高版本，以及仓库声明的 pnpm；
- OpenCode；当前验证版本为 `1.17.16`；
- uv；
- Python `3.13.7`。

Python 环境只使用 `ontology-rag-demo` 根目录的 uv 项目：

```bash
cd ontology-rag-demo
uv python install 3.13.7
uv sync --locked
```

不要在服务或 Job 子目录创建第二套虚拟环境。

## 2. 配置

复制只含公开默认值的模板：

```bash
cd ontology-rag-demo
cp .env.example .env
chmod 600 .env
```

`.env` 已被 Git 忽略。OAG 命令用 `uv --env-file` 显式读取它；Console 启动时需要把
Profile 引用的变量放入当前 shell：

```bash
set -a
source ontology-rag-demo/.env
set +a
```

Profile 所需变量无需另列清单。服务端会从 Model 和 Retrieval 等字段中的
`{env: NAME}` 自动推导需求；例如 `baseline-oag` 只引用 `OAG_BASE_URL`。

双基线使用已配置在当前系统用户 OpenCode 中的模型和认证：

```bash
opencode models deepseek
```

输出必须包含 `deepseek/deepseek-v4-flash`。项目不会复制 OpenCode provider、API 地址
或密钥，也不会在模型缺失时静默替换。

## 3. 启动 8010 OAG

### 3.1 准备数据与索引

全新 clone 默认使用可提交的虚构楼宇本体。进行 BGE-M3 基线验证前，在忽略的 `.env`
中确认：

```dotenv
SOURCE_ONTOLOGY_PATH=examples/smart-building/ontology.ttl
SOURCE_DOCUMENT_PATHS=examples/smart-building/documents/operations-guide.txt
ONTOLOGY_PATH=data/source/smart-building/ontology.ttl
DOCUMENTS_DIR=data/source/smart-building/documents
EMBEDDING_BACKEND=bge-m3
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_DEVICE=cpu
EMBEDDING_BATCH_SIZE=2
EMBEDDING_NORMALIZE=true
LANCEDB_URI=state/baseline-oag-bge-m3/lancedb
LANCEDB_TABLE=ontology_entities_v1
VECTOR_TOP_K=5
API_HOST=127.0.0.1
API_PORT=8010
OAG_BASE_URL=http://127.0.0.1:8010
```

然后执行：

```bash
cd ontology-rag-demo
uv sync --locked
uv run --locked --env-file .env ontology-rag prepare
uv run --locked --env-file .env ontology-rag build-index
```

`build-index` 首次会下载 `BAAI/bge-m3`。已经有完整缓存后才能自行启用离线模式。
无模型 smoke check 可临时使用 `EMBEDDING_BACKEND=deterministic`，但它不能用于检索
质量评估。

### 3.2 启动与检查

```bash
cd ontology-rag-demo
uv run --locked --env-file .env ontology-rag serve
```

在另一个终端验证：

```bash
curl -fsS http://127.0.0.1:8010/health
```

应确认 `embedding_backend=bge-m3`，并且 `ontology_ready`、`lancedb_ready`、
`vector_index_ready` 都为 `true`。`ontology_sha256` 是当前本体文件摘要，不包含路径。

## 4. Profile smoke

Probe 只接受一个位于 `profiles/` Catalog 下的 Profile：

```bash
pnpm --filter ontology-agent-console probe:acp -- \
  --profile ontology-rag-demo/profiles/baseline-direct-context/profile.yaml
```

要检查 OAG Profile，先按第 2 节 source 环境，再执行：

```bash
pnpm --filter ontology-agent-console probe:acp -- \
  --profile ontology-rag-demo/profiles/baseline-oag/profile.yaml
```

Probe 复用生产 Loader、环境映射和配置 overlay，只调用 ACP `initialize` 与
`session/list`，输出能力和 Session 数量。它不会创建、加载、恢复、发送 Prompt 或修改
Session，也不支持命令/cwd/env 覆盖。

## 5. 启动 Agent Console

### 5.1 开发模式

从仓库根目录：

```bash
pnpm install --frozen-lockfile

set -a
source ontology-rag-demo/.env
set +a

pnpm --filter ontology-agent-console dev
```

默认地址：

```text
Vite UI:    http://127.0.0.1:5173
ACP Bridge: http://127.0.0.1:4310
```

Vite 将 `/health`、`/agents` 和相应 WebSocket 代理到 Bridge。

### 5.2 构建模式

```bash
pnpm --filter ontology-agent-console build

set -a
source ontology-rag-demo/.env
set +a

pnpm --filter ontology-agent-console start
```

打开 `http://127.0.0.1:4310`。Bridge 直接托管 `dist-web`。

可用部署变量：

| 变量 | 默认值/约束 |
| --- | --- |
| `AGENT_PROFILES_DIR` | `ontology-rag-demo/profiles` |
| `AGENT_CONSOLE_STATIC_DIR` | `apps/agent-console/dist-web` |
| `AGENT_CONSOLE_PORT` | `4310` |
| `AGENT_CONSOLE_HOST` | `127.0.0.1`，只允许 loopback |
| `AGENT_CONSOLE_ALLOWED_ORIGINS` | 同源 4310 与本地 Vite 5173 |

Catalog 只加载名为 `profile.yaml` 或 `profile.yml` 的文件。
`profiles/dev/profile.example.yaml` 只是自定义兼容模型 Profile 的模板，不会默认出现在
页面中。

## 6. WebUI 验收

CLI 或 Probe 成功不能替代浏览器验收。保持 8010 和 Console 运行，在
`http://127.0.0.1:4310` 对两个 Profile 使用同一问题：

```text
温度传感器所在的房间属于哪个建筑？
```

至少检查：

1. `baseline-direct-context` 能创建 Session、发送问题并得到
   `data-query-plan.v1`；页面不出现 Tool Call。
2. Direct-context 运行时切到 `baseline-oag` 并创建对话；前一 Profile 应继续后台执行。
3. OAG 轨迹包含 Skill/Bash、5 条向量命中、`minimum_connected_subgraph` 子图和最终
   `data-query-plan.v1`。
4. Profile 之间的消息、Tool、Permission、loading 和错误不会串流；同一 Profile 的
   第二轮 Prompt 在第一轮完成前被串行门控。
5. Thinking、Skill、Execute/Bash 和普通 Tool 图标不同；Tool、ACP Plan 与最终
   “查询Plan”均可展开/折叠，折叠不会丢失原始输入输出。
6. 完整 JSON 或消息末尾合法 JSON fence 显示为格式化“查询Plan”，但 Agent 原文不被
   修改。
7. 实时成功回答显示当地完成时间和客户端观测全轮耗时；取消或历史重放不伪造该信息。
8. 页面刷新后，从相应 Profile 选择 Session，`session/load` 能恢复消息、Tool 输出和
   子图。
9. 新建一个空闲测试 Session，确认删除后刷新页面不再出现；有在途请求的 Profile
   不允许删除。
10. 折叠侧栏和 Profile 分组、查看 Profile 信息、切换不同 Session；唯一可见对话窗口
    与后台运行状态保持一致。

OAG Profile 允许 Agent 自主 Bash。若轨迹显示 Agent 直接读取本体文件，接线仍然可见，
但该 Session 应标记为“基线语义污染”，不能用于两条路径的效果比较。

## 7. 测试与代码检查

```bash
pnpm --filter ontology-agent-console typecheck
pnpm --filter ontology-agent-console test
pnpm --filter ontology-agent-console build

cd ontology-rag-demo
uv run --locked pytest
uv run --locked ruff check .
```

修改 Profile、Prompt、Skill、Bridge 或 UI 行为时，先更新本文、系统设计、协议或 ADR，
再修改代码和测试。

## 8. 迁移到另一台机器

1. clone 同一个 Git commit，安装 Node.js、pnpm、uv、Python 3.13.7、OpenCode。
2. 在 `ontology-rag-demo` 执行 `uv sync --locked`，在仓库根执行
   `pnpm install --frozen-lockfile`。
3. 从 `.env.example` 创建被忽略的 `.env`，只在目标机器填写 endpoint 和密钥。
4. 执行 `prepare`、`build-index`、`serve`，确认 8010 `/health`。
5. 在目标系统用户中配置 OpenCode 模型/认证，并用 `opencode models` 确认模型可见。
6. source `.env`，执行 Profile Probe、Console build 和 start。
7. 按第 6 节做真实 WebUI 验收。

以下内容不迁移：`.env`、`.runtime/`、LanceDB `state/`、模型缓存和真实业务源材料。
它们应在目标环境重新注入或构建。需要复现实验时记录 Git commit、OpenCode 版本、
Profile revision、本体摘要和运行环境；无需维护第二套方案元数据。
