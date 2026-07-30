# Ontology Agent Test Console

这是一个以 OpenCode Agent 为核心、通过 ACP 接入 WebUI 的本体测试环境。测试方案以
Profile 打包，本体输入以 Dataset 管理；用户在页面上选择两者创建 Runtime 项目，再在
项目内创建多个 OpenCode Session。

```text
Profile × Dataset
       │ 创建并初始化
       ▼
Runtime project
├── Profile / Dataset 普通文件快照
├── OpenCode 独立 cwd、配置和 Session DB
├── LanceDB 等 Profile 私有状态
└── 多个 Session
       │ ACP
       ▼
Agent Console WebUI
```

当前包含两条可直接运行的测试流：

- `direct-context`：初始化时把具名 TBox 投影精简为 YAML 并注入 Prompt；
- `ontology-retrieval`：初始化时建立实体向量索引，Agent 通过 Skill 获取 Top-5 和
  NetworkX 近似 Steiner 连通子图，再生成查询 Plan。

检索 Profile 默认使用无需下载模型的 deterministic embedding 打通流程。切换到
BGE-M3 后仍使用同一个 Profile；差异记录在每个 Runtime 的索引元数据中。

## 目录

```text
ontology-rag-demo/
├── profiles/
│   ├── direct-context/
│   └── ontology-retrieval/
├── datasets/
│   └── smart-building/
│       ├── dataset.yaml
│       ├── building.ttl
│       └── raw_data/
├── docs/agent-console/
├── tests/
├── pyproject.toml
├── uv.lock
└── .runtime/                 # 本机物化项目，忽略提交
```

Profile 自带 Prompt、Skill、Tool、检索实现和初始化入口，但共享根 uv 环境，不创建嵌套
`.venv`。Dataset 固定为 `datasets/<dataset-id>/` 两级结构，本体文件直接放在 Dataset
根目录，复杂来源材料可放入 `raw_data/`。

## 安装

要求 macOS、Linux 或 WSL，Python `3.13.7`、uv、Node.js `22.13+`、pnpm，以及支持
ACP 的 OpenCode。原生 Windows 暂不启动 Console：当前删除安全依赖 POSIX 进程组，
Windows 用户应在 WSL 中运行。
当前能力矩阵已核验 OpenCode `1.17.16`；内部改版需提供相同的 ACP 与 Runtime 隔离能力。

```bash
cd ontology-rag-demo
uv python install 3.13.7
uv sync --locked

cd ..
pnpm install --frozen-lockfile

opencode --version
opencode models | grep 'deepseek/deepseek-v4-flash'
```

整个 Demo 只有 `ontology-rag-demo/.venv` 一个 Python 环境。不要在 Profile、Dataset
或 `.runtime/` 内执行 `uv init`、`uv venv` 或 `pip install`。

两个内置 Profile 都声明模型 `deepseek/deepseek-v4-flash`，但不复制 API Key：
模型注册和凭据继续由本机 OpenCode 配置管理。上面的模型检查无结果时，应先按所用
OpenCode 版本完成模型配置，再启动 Console；不能只迁移本仓库来替代凭据配置。

## 启动 WebUI

默认无需 `.env`：

```bash
cd /path/to/repository
pnpm dev:agent-console
```

开发模式打开 `http://127.0.0.1:5173/`；构建后由 Bridge 直接托管时使用
`http://127.0.0.1:4310/`。页面左侧只显示已经创建的 Runtime：

1. 点击“新建项目”；
2. 选择一个 Profile 和一个 Dataset；
3. 等待 Runtime 从“初始化中”变为“就绪”；
4. 在该项目中创建对话并提问。

创建入口每次打开都会刷新两个源 Catalog，并隐藏已经存在的 Profile × Dataset 组合；
源目录新增测试流或 Dataset 后不需要重启 Console。

生产式本地启动：

```bash
pnpm build:agent-console
pnpm --filter ontology-agent-console start
```

Runtime ID 固定为 `<profile-id>--<dataset-id>`。同一组合只创建一个 Runtime，但其中
可以有多个 Session；不同 Runtime 可在后台独立执行。

删除 Session 只删除该 Runtime 内的 OpenCode Session。删除项目会先停止其 ACP/初始化
进程，再将 Runtime 原子移动到 `.runtime/trash/` 后清理；不会删除源 Profile、源
Dataset、根 uv 环境或其他 Runtime。若 Session 删除维护正在运行，项目删除会返回忙，
不会越过尚未登记完成的子进程。

## 使用 BGE-M3

复制可选环境示例并在启动 Console 前 source：

```bash
cd ontology-rag-demo
cp .env.example .env
chmod 600 .env

set -a
source .env
set +a

cd ..
pnpm dev:agent-console
```

把 `.env` 中的 `EMBEDDING_BACKEND` 改为：

```dotenv
EMBEDDING_BACKEND=bge-m3
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_DEVICE=cpu
```

Mac 可在 PyTorch MPS 可用时设置 `EMBEDDING_DEVICE=mps`。创建 Runtime 时会把
backend、model、max length 和 normalize 固化进索引元数据；之后修改这些语义配置不会
静默改变已建索引，需要从 UI 删除并重建。`EMBEDDING_DEVICE` 与
`EMBEDDING_BATCH_SIZE` 仍是每次查询读取的执行参数。

当前索引元数据记录 Embedding Model ID，但尚未锁定 Hugging Face revision/commit。
质量对比应使用受控模型缓存或不可变本地快照，并在权重变化后删除、重建 Runtime。

## 添加 Dataset

```text
datasets/<dataset-id>/
├── dataset.yaml
├── <ontology-file>.ttl
└── raw_data/                 # 可选
```

示例 manifest：

```yaml
schema_version: 1
id: my-dataset
title: My Dataset
description: 用于某项测试的本体。
ontology_file: ontology.ttl
raw_data_dir: raw_data
```

`id` 必须与目录名一致。本体必须是 Dataset 根下的普通文件；不使用
`datasets/public/` 或 `datasets/private/`。真实业务材料应对具体 Dataset 目录设置精确
Git ignore/exclude，并用 `git status --ignored` 核验。

## 添加 Profile

Profile v2 的最小结构：

```text
profiles/<profile-id>/
├── profile.yaml
├── opencode/
├── tools/
├── skills/                   # 可选
├── retrieval/                # 可选
└── tests/                    # 推荐
```

Profile 不能声明具体 Dataset、本体路径、Runtime 路径、密钥或状态目录。需要的路径由
Runtime Manager 通过受控环境变量注入；所有命令均以 argv 启动，不经过 shell。

完整字段和初始化协议见
[配置与数据协议](docs/agent-console/protocols.md)。

## 验证

```bash
cd ontology-rag-demo
uv run --locked --no-sync pytest
uv run --locked --no-sync ruff check .

cd ..
pnpm test:agent-console
pnpm build:agent-console
```

详细设计与运维入口：

- [系统设计](docs/agent-console/system-design.md)
- [配置与数据协议](docs/agent-console/protocols.md)
- [开发与验证](docs/agent-console/development.md)
- [模块与接口](docs/agent-console/module-reference.md)
- [OpenCode ACP 能力矩阵](docs/agent-console/acp-capability-matrix.md)
- [决策记录](docs/agent-console/decisions.md)

## 安全边界

- OpenCode 模型和凭据沿用本机 OpenCode 配置，不写入 Profile。
- Runtime API 和浏览器不返回绝对路径、命令、环境变量或密钥。
- `.env`、`.runtime/`、模型权重和 Python/Node 缓存均不提交。
- Profile/Dataset 创建快照时拒绝 symlink、路径穿越和特殊文件。
- Runtime 的 OpenCode cwd、Session DB、配置、索引和状态彼此隔离。
