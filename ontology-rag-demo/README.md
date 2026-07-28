# Ontology RAG Demo

这是一个单进程、单项目级虚拟环境的本体 RAG 验证工程：

```text
问题
  ├─ Embedding（快速示例或 BGE-M3）→ LanceDB cosine Top 5
  ├─ 本体锚点 → NetworkX 近似最小连通子图
  └─ 合并证据 → Qwen/OpenAI-compatible API
```

第一阶段不启动 NebulaGraph。图检索接口与存储实现解耦，端到端基线通过后再增加
NebulaGraph 适配器。

Agent 测试控制台采用 OpenCode + ACP 的 Agent-centric 架构，设计和实现状态见：

- [Agent Console 系统设计](docs/agent-console/system-design.md)
- [Profile 与 Artifact 协议](docs/agent-console/protocols.md)
- [开发与验证](docs/agent-console/development.md)
- [OpenCode ACP 能力矩阵](docs/agent-console/acp-capability-matrix.md)
- [实现决策记录](docs/agent-console/decisions.md)
- [两条查询规划基线](baselines/README.md)

## 目录

```text
ontology-rag-demo/
├── .env.example              # 只含变量名和非敏感默认值
├── .python-version           # Python 3.13.7
├── pyproject.toml
├── uv.lock
├── examples/smart-building/ # 可提交的虚构楼宇本体与示例文档
├── src/ontology_rag_demo/
├── tests/
├── data/source/              # 按数据集隔离的运行时副本，不提交
├── state/                    # 按数据集隔离的 LanceDB 数据，不提交
└── artifacts/                # 评估产物，不提交
```

## 1. 创建环境

所有 Python 依赖都由当前目录下的 uv 项目管理：

```bash
cd ontology-rag-demo

uv python install 3.13.7
uv sync --locked
```

禁止在子模块中再次执行 `uv init`，也不要使用 `pip install` 修改 `.venv`。

## 2. 配置环境变量

```bash
cp .env.example .env
chmod 600 .env
```

在 `.env` 中填写真实的 `QWEN_BASE_URL`、`QWEN_API_KEY` 和 `QWEN_MODEL`。
`.env` 已被 Git 忽略；应用不会自动读取仓库内的任何密钥文件，运行时由 uv 显式注入：

```bash
uv run --locked --env-file .env ontology-rag smoke
```

也可以由部署系统直接注入环境变量，不创建 `.env`。

## 3. 准备内置示例数据

准备命令读取 `SOURCE_ONTOLOGY_PATH` 和 `SOURCE_DOCUMENT_PATHS`，将源文件复制到被
忽略的 `data/source/smart-building/`。默认输入是仓库内可提交的虚构智能楼宇本体与运维说明，因此
全新 clone 不依赖 3GPP 或其他外部业务材料：

```bash
uv run --locked --env-file .env ontology-rag prepare
```

默认选择：

- `examples/smart-building/ontology.ttl`
- `examples/smart-building/documents/operations-guide.txt`

测试真实或私有本体时，只在被忽略的 `.env` 中覆盖 `SOURCE_ONTOLOGY_PATH`、
`SOURCE_DOCUMENT_PATHS`、`ONTOLOGY_PATH`、`DOCUMENTS_DIR` 和 `LANCEDB_URI`，
为不同数据集使用独立运行目录；不要提交这些运行时副本。

## 4. 构建 LanceDB 本体实体索引

默认 `deterministic` embedding 只用于快速打通流程，不下载模型权重：

```bash
uv run --locked --env-file .env ontology-rag build-index
```

每个本体实体使用以下三行文本构建向量，不混入文档块或边文本：

```text
{name}
{label}
{comment}
```

进行检索质量评估时，在 `.env` 中切换到 BGE-M3；首次运行会从 Hugging Face 下载
`BAAI/bge-m3`：

```dotenv
EMBEDDING_BACKEND=bge-m3
EMBEDDING_MODEL=BAAI/bge-m3
```

Mac M1 可在 `.env` 中设置：

```dotenv
EMBEDDING_DEVICE=mps
```

先检查当前 PyTorch 运行环境：

```bash
uv run --locked python -c \
  'import torch; print(torch.backends.mps.is_built(), torch.backends.mps.is_available())'
```

只有第二项为 `True` 时才启用 MPS。如果 MPS 不可用或遇到不支持的算子，先使用
`cpu` 完成基线验证。`deterministic` 后端只用于单元测试和无模型 smoke check，
不能用于评估 RAG 质量。

## 5. 启动 API

```bash
uv run --locked --env-file .env ontology-rag serve
```

接口：

```text
GET  /health
POST /v1/retrieval/vector
POST /v1/retrieval/graph
POST /v1/retrieval/oag
POST /v1/answer
```

`/health` 在本体文件存在时返回 `ontology_sha256`，供不可变 Agent Profile 校验实际
加载的本体输入；响应不返回文件路径。

示例：

```bash
curl -fsS http://127.0.0.1:8010/health

curl -fsS \
  -H 'Content-Type: application/json' \
  -d '{"question":"温度传感器所在的房间属于哪个建筑？","trace":true}' \
  http://127.0.0.1:8010/v1/answer
```

## 6. 验证

```bash
uv run --locked pytest
uv run --locked ruff check .
uv run --locked --env-file .env ontology-rag smoke
```

`/health` 和 `smoke` 只返回“是否已配置”，不会输出 API 地址、模型名或密钥。

## 配置安全边界

- API 地址、密钥和内网模型名只从环境变量读取。
- 内置虚构示例可以提交；真实源材料、`.env`、模型权重、LanceDB 状态和评估产物均不提交。
- `.env.example` 不包含真实内网地址、令牌或内部模型标识。
- HTTP 请求异常不会把 Authorization header 写入日志。
- 公开提交前可执行 `git status --ignored` 确认运行材料处于 ignored 状态。
