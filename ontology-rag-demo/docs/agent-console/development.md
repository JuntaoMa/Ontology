# Agent Console 开发与验证

状态：已按 Runtime 架构实现

## 1. 共享环境

在 macOS、Linux 或 WSL 中运行。原生 Windows 首版明确拒绝启动，因为尚无等价的
Job Object/递归进程树确认实现，不能在子进程状态未知时安全删除 Runtime 或 Session。

整个 Demo 只使用根 uv 项目：

```bash
cd ontology-rag-demo
uv python install 3.13.7
uv sync --locked
```

Profile 不能创建自己的 `.venv` 或嵌套 `pyproject.toml`。Profile 自带 Python 程序统一
通过：

```bash
uv run --project ontology-rag-demo --locked --no-sync python <profile-script>
```

Node 依赖仍由仓库根 pnpm workspace 管理：

```bash
pnpm install --frozen-lockfile
```

OpenCode 由运行机器预先安装并管理模型凭据。当前已核验 `1.17.16`：

```bash
opencode --version
opencode models | grep 'deepseek/deepseek-v4-flash'
```

Profile 只声明 Model ID；不会把全局 OpenCode API Key、认证内容或 provider 配置复制进
Git。内部改版 OpenCode 必须先按
[ACP 能力矩阵](acp-capability-matrix.md)复验。

## 2. 编写 Dataset

新 Dataset 直接创建在两级目录：

```text
ontology-rag-demo/datasets/<dataset-id>/
├── dataset.yaml
├── <ontology-file>.ttl
└── raw_data/                 # 可选
```

示例：

```yaml
schema_version: 1
id: smart-building
title: Smart Building Sample
description: 可提交的虚构楼宇本体。
ontology_file: building.ttl
raw_data_dir: raw_data
```

检查：

- Dataset ID 与目录名一致；
- 本体文件是 Dataset 根的直接普通文件；
- `raw_data/` 可省略；
- 不使用 public/private 子目录；
- 不包含 symlink；
- Dataset 内其他安全普通文件也会进入快照；复杂来源材料统一整理进 `raw_data/`，避免
  根目录失去可读性；
- 敏感 Dataset 目录以精确 ignore/exclude 规则保护，并用
  `git status --ignored` 验证。

## 3. 编写 Profile

Profile 是完整可分享测试流：

```text
ontology-rag-demo/profiles/<profile-id>/
├── profile.yaml
├── README.md
├── opencode/
├── skills/
├── tools/
├── retrieval/
└── tests/
```

并非每个 Profile 都必须包含所有可选目录，但其运行路径不能引用其他 Profile 或
`../_shared`。测试特有 Prompt、Skill、算法实现应随 Profile 打包；依赖版本由根 uv
项目统一提供。Profile v2 不管理常驻 sidecar；需要服务型组件时应先定义显式 endpoint
和 readiness 协议。

Profile 不得包含本体、Dataset ID、真实 endpoint、密钥、LanceDB、模型权重或 Session。
Direct-context Profile 必须用 Initializer 从 Runtime Dataset 快照生成上下文，不能把
某个具体本体长期写死在 Profile Prompt。

Profile、Skill 与 Initializer 按可信本机代码审查。它们不得调用 `setsid`、创建
detached grandchild 或遗留后台 daemon；当前 Supervisor 只对自己创建的 POSIX 进程组
提供有界回收保证。需要执行不可信代码时必须另加容器/cgroup 等 OS 级隔离。

Profile 测试至少覆盖：

- manifest/schema；
- Initializer 在临时 Runtime 中的输出；
- Tool/Skill 相对路径；
- Retrieval/Tool 请求与错误；
- Profile 中不存在 symlink、仓库外路径、嵌套环境或生成缓存；
- 输出协议与安全上限。

## 4. Runtime 创建

WebUI 创建流程：

1. 页面初始侧栏只列已经创建的 Runtime，不列全部 Profile。
2. 点击创建入口；UI 重新加载 Profile/Dataset Catalog 与 Runtime 列表，只保留尚未
   存在的 Profile × Dataset 组合。
3. UI 调用 `POST /runtimes`。
4. 新 Runtime 以 `initializing` 显示；此时不能创建 Session。
5. Initializer 成功且 staging 原子提升后状态变为 `ready`。
6. 用户在 Runtime 分组内创建第一个 OpenCode Session。

HTTP 验证：

```bash
curl -fsS http://127.0.0.1:4310/profiles
curl -fsS http://127.0.0.1:4310/datasets
curl -fsS http://127.0.0.1:4310/runtimes

curl -fsS \
  -H 'Content-Type: application/json' \
  -d '{"profile_id":"ontology-retrieval","dataset_id":"smart-building"}' \
  http://127.0.0.1:4310/runtimes
```

预期物化目录：

```text
ontology-rag-demo/.runtime/projects/
└── ontology-retrieval--smart-building/
    ├── runtime.yaml
    ├── workspace/
    │   ├── profile/
    │   ├── dataset/
    │   └── generated/
    ├── opencode/
    └── state/
```

必须检查：

- `workspace/profile` 和 `workspace/dataset` 是普通文件快照，不是 symlink；
- OpenCode cwd 是 `workspace/`；
- manifest 摘要对应创建时源文件；
- manifest 固化创建时 Profile/Dataset 标题；修改源 Catalog 标题不重命名历史 Runtime；
- 修改源 Profile/Dataset 不会改变已创建 Runtime；
- 重复创建相同组合返回 `409`，不覆盖已有快照。
- 修改、新增或删除源条目后再次请求 `/profiles`、`/datasets`，只有完整 Catalog 校验
  成功才切换；失败时旧 Catalog 继续可用，已有 Runtime 不丢失。

## 5. Runtime 与 Session WebUI 验收

1. 侧栏顶层只出现已创建 Runtime；项目标题使用 manifest 固化的 Profile title，
   Dataset title 作为标签，旧 manifest 回退到 Runtime 快照。
2. Profile/Dataset 只出现在创建 Runtime 对话框和 Runtime 信息卡。
3. Runtime `ready` 后可以创建多个 OpenCode Session。
4. 不同 Runtime 可以后台并行；切换可见 Session 不串消息、Tool 或 Permission。
5. 刷新页面后从 Runtime 的 `session/list`/`session/load` 恢复。
6. Session 删除只影响该 Runtime 的 OpenCode DB，不删除 Runtime 快照。
7. `initializing`、`initialization_failed`、`deleting` 和 `delete_failed` 均有明确状态，
   不显示为普通可运行项目。

## 6. Runtime 删除验收

只使用可重建的测试 Runtime，不以源 Profile/Dataset 目录作为测试目标。

### 正常路径

1. 创建 Runtime 和一个 Session。
2. 启动一次 ACP，再触发 Runtime 删除。
3. 确认新连接被拒绝，受管进程按有界顺序停止。
4. 确认 Runtime 目录原子移动到 `.runtime/trash/` 后才从侧栏消失。
5. 确认 trash 最终清理，Profile 和 Dataset 源文件保持逐字节不变。

### 失败路径

- Initializer 运行中删除：先 Cancel/TERM/KILL，再处理 staging。
- ACP Prompt 运行中删除：必须停止进程树，不能先删 DB。
- manifest ID 与目录不一致：拒绝删除。
- Runtime 目录或父路径出现 symlink：拒绝删除。
- rename 前注入失败：Runtime 保留，可重试。
- trash 清理失败：Runtime 仍视为已删除，记录 `cleanup_failed` 并在维护流程重试。
- 服务重启遇到遗留 staging：标记 `initialization_failed`，不自动发布。

每个删除测试都要断言以下源文件和环境未变化：

```text
profiles/**
datasets/**
.venv/**
pyproject.toml
uv.lock
其他 .runtime/projects/*
```

## 7. 查询 Plan JSON/Graph 验收

对合法 `data-query-plan.v1`：

1. “查询Plan”卡片默认可查看格式化 JSON。
2. JSON/Graph 切换不改变 Agent 消息字符串或 Store。
3. Graph 包含 Task、Target、Projection 和 Filter 节点。
4. `joins` 生成 relation 边；`ontology_evidence` 生成独立 evidence 样式边。
5. 相同实体合并节点并保留多种角色。
6. Graph 不请求检索工具，也不把 Tool 返回的 ontology subgraph 混入查询计划。
7. 非法字段或超过 120 节点/240 边时 Graph 禁用，JSON 不丢失。
8. 历史 `session/load` 后能够从同一 Agent 原文重新生成相同展示投影。

## 8. 通用测试

```bash
pnpm --filter ontology-agent-console typecheck
pnpm --filter ontology-agent-console test
pnpm --filter ontology-agent-console build

cd ontology-rag-demo
uv run --locked --no-sync pytest
uv run --locked --no-sync ruff check .
```

Runtime Manager 测试按以下模块拆分：

- Profile/Dataset Catalog；
- snapshot copier 与 symlink/path gate；
- Initializer/进程组 supervisor；
- Runtime manifest/state recovery；
- Runtime 删除提交与 trash cleanup；
- ACP Runtime 路由；
- Query Plan projection；
- WebUI 创建、状态和删除交互。

## 9. 迁移与分享

分享 Profile 时只打包：

```text
profiles/<profile-id>/**
```

接收方还需要兼容的根 uv lock/runtime API，但不需要发送 Dataset、`.runtime`、State、
Session 或密钥。Dataset 独立迁移到 `datasets/<dataset-id>/`。

迁移后重新创建 Runtime；不要复制 `.runtime/projects/` 作为部署方式。Runtime 是本机
物化产物，Profile 和 Dataset 才是可审查输入。
