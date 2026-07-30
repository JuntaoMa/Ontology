# Ontology Agent Console 系统设计

状态：已按 Runtime 架构实现

边界：可信单用户、本机 loopback、OpenCode 为唯一 Agent Runtime

## 1. 核心概念

| 概念 | 含义 | 是否可分享 |
| --- | --- | --- |
| Profile | 一套完整测试流实现，可包含 Agent 配置、Prompt、Skill、Tool、Retrieval、Initializer 和测试 | 是 |
| Dataset | 与测试流独立的数据输入，包含一个本体文件和可选 `raw_data/` | 可独立决定 |
| Runtime | Profile 与 Dataset 在本机物化后的可运行实例；同时承担 WebUI 中“项目”的显示语义 | 否 |
| Session | Runtime 下由 OpenCode 持久化的对话和 Agent 历史 | 否 |

不再单独定义 Project 或 Binding。二者的用途合并进 Runtime manifest。Profile 不绑定
具体本体；Dataset 不绑定测试流。

Runtime ID 固定为：

```text
<profile-id>--<dataset-id>
```

同一对 Profile/Dataset 在一台主机上最多有一个 Runtime。Profile 或 Dataset 源发生
变化时，现有 Runtime 仍使用创建时快照；需要显式删除并重新创建。若要同时保留不同
实现版本，应使用不同 Profile ID。

## 2. 目标与非目标

首版目标：

1. 用户从 Profile Catalog 和 Dataset Catalog 选择一对输入。
2. 服务端调用 Profile Initializer，在 `.runtime/projects/` 中创建 Runtime。
3. WebUI 只显示已经创建的 Runtime，以及各 Runtime 下的 OpenCode Session。
4. OpenCode 自主管理上下文、Skill、Tool、Permission 和多轮执行。
5. Profile 可以通过 Skill/Tool 调用自身携带的有限任务实现。
6. UI 展示 ACP 事件、子图 artifact，以及查询计划的 JSON/Graph 两种视图。

首版不实现测试结果自动评分、多用户权限、前端历史数据库、任意插件安装、跨主机调度或
复杂图编辑工作台。Profile v2 也不管理常驻 sidecar；若以后需要服务型检索器，应新增
带明确 endpoint 与 readiness 协议的版本，而不是把“进程未立即退出”当成健康状态。

## 3. 事实源与职责

| 模块 | 权威职责 |
| --- | --- |
| Profile Catalog | 可分享测试流源文件 |
| Dataset Catalog | 本体和原始数据源文件 |
| Runtime Manager | Profile/Dataset 快照、Initializer 生命周期、Runtime manifest、删除 |
| OpenCode | Runtime 下的 Session、历史、Agent 循环、模型、工具和 Permission |
| ACP Bridge | Runtime 白名单、WebSocket/stdio 转发、请求门控、进程回收 |
| Web UI | Runtime 创建入口、Session 交互和 ACP 展示投影 |

WebUI 不把 Profile 当成项目，也不显示尚未创建的 Profile 分组。侧栏顶层分组是 Runtime
的显示名，Session 是其 OpenCode 子资源。

## 4. 源目录与 Runtime 快照

源目录：

```text
ontology-rag-demo/
├── profiles/
│   └── <profile-id>/
│       ├── profile.yaml
│       ├── opencode/
│       ├── skills/
│       ├── tools/
│       ├── retrieval/
│       └── tests/
└── datasets/
    └── <dataset-id>/
        ├── dataset.yaml
        ├── <ontology-file>.ttl
        └── raw_data/          # 可选
```

Dataset 只有 `datasets/<dataset-id>/` 两级结构，不按 public/private 分目录。本体文件
直接位于 Dataset 目录；`dataset.yaml` 显式声明其文件名。敏感 Dataset 通过具体目录的
Git ignore/exclude 策略保护，目录结构本身不表达敏感级别。

物化结果：

```text
ontology-rag-demo/.runtime/
├── projects/
│   └── <profile-id>--<dataset-id>/
│       ├── runtime.yaml
│       ├── workspace/                # OpenCode cwd
│       │   ├── profile/              # Profile 创建时复制快照
│       │   ├── dataset/              # Dataset 创建时复制快照
│       │   └── generated/            # Initializer 生成物
│       ├── opencode/
│       │   ├── opencode.db
│       │   └── config/
│       ├── state/                    # LanceDB 等 Profile 私有状态
│       └── logs/
├── staging/                          # 初始化中的候选 Runtime
└── trash/                            # 已逻辑删除、待物理清理
```

约束：

- OpenCode cwd 必须是 Runtime 的 `workspace/`，不能是仓库根或 Profile 源目录。
- Profile 和 Dataset 都复制为普通文件快照；不创建 symlink，也不保留指向源目录的
  可写引用。
- Loader 拒绝源目录中的符号链接、路径穿越、设备文件、嵌套环境，以及
  `__pycache__`、`*.pyc`、测试缓存、`node_modules` 等生成物。
- OpenCode 配置从 `workspace/profile/opencode/` 复制到
  `<runtime>/opencode/config/`，`OPENCODE_DB` 固定在 Runtime 内。
- Profile Tool 使用 `ONTOLOGY_PROFILE_DIR=workspace/profile`，
  Dataset 使用 `ONTOLOGY_DATASET_DIR=workspace/dataset`，运行状态使用
  `ONTOLOGY_RUNTIME_STATE_DIR=<runtime>/state`。
- Runtime manifest 记录创建时的 Profile/Dataset 标题、Profile revision、两份快照摘要、
  创建时间和状态；侧栏标题不依赖当前源 Catalog。描述从 Runtime 内已校验快照投影，
  对浏览器只返回脱敏字段。

## 5. Runtime 初始化

WebUI 的“创建项目”入口从两个只读 Catalog 中选择 Profile 与 Dataset。每次打开入口都会
重新读取 Catalog 与 Runtime 列表，并过滤已经存在的确定性组合；服务端仍以 `409`
作为并发和绕过 UI 时的最终防线。随后调用：

```text
POST /runtimes
```

服务端流程：

1. 只接受 Catalog 中已校验的 `profile_id` 和 `dataset_id`，计算确定性 Runtime ID。
2. 对该 ID 取得独占 initialization lock；已有 Runtime 返回冲突，不静默覆盖。
3. 在 `.runtime/staging/<runtime-id>--<nonce>/` 创建候选目录。
4. 将 Profile 和 Dataset 逐文件复制到 `workspace/`；复制过程拒绝 symlink 和越界。
5. 写入 pending `runtime.yaml`，状态为 `initializing`。
6. 以无 shell、固定参数、最小环境运行 Profile 声明的 Initializer。Initializer 只能
   写候选 Runtime；例如 Direct-context 可把 Dataset 本体转换为 Prompt context，
   Retrieval Profile 可准备索引。
7. 验证生成文件和 manifest 后，将 staging 目录原子 rename 到
   `.runtime/projects/<runtime-id>`，状态切换为 `ready`。

创建是异步操作。初始化中的 Runtime 可在 UI 显示进度，但不能创建 Session。初始化失败
保留脱敏错误状态，不返回 stdout、内部路径或密钥；用户可以删除失败实例后重试。服务
重启时，遗留 staging manifest 从 `initializing` 转为 `initialization_failed`，不能
自动提升为 ready。

## 6. ACP 与 Session

- `WS /runtimes/:runtimeId/acp` 是 Runtime 的 ACP 入口。
- 一个 Runtime 最多有一条活跃 WebSocket 和一个 `opencode acp` 进程。
- OpenCode 的 cwd 固定为该 Runtime 的 `workspace/`。
- 不同 Runtime 可以并行；同一 Runtime 的 Prompt 首版串行。
- Session 由 OpenCode 写入该 Runtime 的 `opencode.db`，不能跨 Runtime 移动。
- WebUI 按 `runtimeId + sessionId` 路由 `session/update`；当前可见窗口只影响展示。
- 页面刷新后通过 Runtime 的 `session/list` 和 `session/load` 恢复。
- ACP 没有持久 Session 删除方法，因此 Session 垃圾桶继续使用 Runtime-aware
  OpenCode CLI 扩展。

## 7. Runtime 删除

Runtime 删除是高风险操作，必须以 Runtime 为唯一删除边界：

```text
DELETE /runtimes/:runtimeId
```

### 7.1 锁与停止顺序

1. 取得 Runtime exclusive deletion lock；拒绝新 ACP、Session 删除和 Initializer。
2. 状态切换为 `deleting`。
3. 若 Initializer 仍在运行，先 Cancel，再按 TERM → grace → KILL 有界终止进程组。
4. 取消或终止该 Runtime 的 ACP 进程及其子进程，拒绝待处理 Permission。
5. 只有确认所有受管进程组停止后，才进入文件系统提交阶段。

若 Session 删除维护已经取得该 Runtime 的锁，Runtime 删除返回 `runtime_busy`，不能越过
尚未完成注册的 Session CLI 子进程；若服务端发现上次中断后仍登记的 Session 删除进程，
则先完成回收再重试删除。服务关闭时先拒绝新的 POST/DELETE，并排空已经接受的 mutation，
再关闭进程管理器，避免关闭阶段产生未受管的新任务。

### 7.2 删除目标校验

服务端不能直接信任 URL、manifest 或环境变量中的路径。rename 前必须同时确认：

- Runtime ID 满足规范格式，且等于目录名和 manifest ID；
- 目标是 canonical `.runtime/projects/<runtime-id>` 或受管 staging 目录的直接子项；
- 从 `.runtime` 到目标不存在 symlink；
- 目标不是 `.runtime`、`projects/`、`staging/`、`trash/` 或其他 Runtime；
- `profile_id`、`dataset_id` 与 Runtime ID 一致；
- trash 目标是同一 `.runtime` 文件系统内、唯一且不存在的直接子项。

任何检查失败都必须停止删除，不能尝试“修正”或扩大路径。

### 7.3 原子提交与清理

已有文件系统 Runtime 目标时，逻辑删除的提交点是：

```text
rename(
  .runtime/projects/<runtime-id>,
  .runtime/trash/<runtime-id>--<timestamp>--<nonce>
)
```

rename 成功后 Runtime 立即从 Catalog/侧栏消失，原 ID 在本次清理完成前仍保留 reservation。
物理递归清理只允许针对刚刚生成并再次校验的 trash 直接子目录；不得按照 manifest 中的
源路径删除。初始化刚被取消且 staging 目录尚未创建时没有文件系统目标，服务端只释放
该 Runtime 的内存 reservation，不执行伪造的 rename。

### 7.4 失败与恢复

- 停止进程、路径校验或 rename 之前失败：Runtime 保留在原位置，状态写为
  `delete_failed`，保存脱敏错误码；用户可检查后重试。
- staging Runtime 删除失败：保留 `initialization_failed`/`delete_failed`，不得提升为
  ready。
- rename 已成功但物理清理失败：逻辑删除仍成立，不自动恢复 Runtime；trash 项标记为
  `cleanup_failed`，由服务下次启动时的清理器重试；当前没有单独的 maintenance API。
- 进程状态不确定时宁可保留 Runtime，也不能先删文件。
- 服务重启时扫描 staging/trash，只处理满足同样路径约束并带合法 manifest 的目录。

Runtime 删除永远不能删除：

- `profiles/<profile-id>/**`；
- `datasets/<dataset-id>/**`；
- 其他 Runtime；
- 根 `.venv`、`uv.lock`、`pyproject.toml`；
- Agent Console、共享运行库、模型缓存和 Git 文件；
- manifest 中记录的任何仓库外路径。

## 8. WebUI

侧栏只显示已创建 Runtime：

```text
Runtime display name
  ├── New conversation
  ├── Session A
  └── Session B
```

Profile/Dataset Catalog 只出现在创建 Runtime 对话框。打开对话框会刷新两个源 Catalog
和 Runtime 列表；已存在的 Profile × Dataset 组合不再作为可创建选项。Runtime 信息卡
显示创建时快照中的 Profile/Dataset 标题与描述、revision、快照摘要和状态；不显示
源路径、endpoint、命令或密钥。

唯一 ChatView 支持不同 Runtime 后台执行。删除 Session 与删除 Runtime 是两个不同
操作和确认文案，不能共用按钮或误导用户。

## 9. 查询 Plan JSON/Graph

当 Agent 最终消息包含合法 `data-query-plan.v1` object 时，“查询Plan”卡片提供
`JSON` 与 `Graph` 切换：

- JSON 视图格式化显示 Agent 原始 JSON。
- Graph 视图只从 `query_tasks`、`targets`、`joins`、`filters`、`projections` 和
  `ontology_evidence` 生成临时展示投影。
- Store、ACP chunk 和 OpenCode 历史始终保留 Agent 原文；切换、布局和图坐标不写回。
- Graph 不调用检索工具、不补充本体关系、不推断缺失字段，也不替代
  `ontology.subgraph` Tool artifact。
- 结构无效或超过安全上限时禁用 Graph，JSON 仍完整可用。

详细映射见 [配置与数据协议](protocols.md)。

## 10. 安全与复现

- Profile 可公开分享，但不包含 Dataset、密钥、模型权重或 Runtime。
- Dataset 是否敏感由部署者决定，不通过目录层级推断。
- Profile/Dataset 源由 Git commit、revision 和摘要复现；Runtime manifest 固定创建时
  快照。
- 浏览器不保存 Session、Runtime 源路径、Agent endpoint 或凭据。
- Runtime Manager 启动的进程使用固定 argv、无管理层 shell 和最小环境；Agent 仍可按
  Profile 权限自主使用 Bash。
- Profile、Skill 和 Initializer 是可信本机代码。Supervisor 能确认自己创建的 POSIX
  进程组及其普通后代退出，但不能约束恶意代码通过 `setsid`/detached grandchild 逃离
  原进程组。因此 Profile 不得启动脱管后台进程；若要运行不可信 Profile，必须在本设计
  之外增加容器、cgroup/subreaper 或等价 OS 级 containment，不能把当前回收逻辑称为
  安全沙箱。
- 当前仍是 loopback 单用户 Demo；公网或多租户部署必须重新设计认证和隔离。
