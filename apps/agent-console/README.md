# Ontology Agent Console

一个面向本体 RAG 测试的 ACP Web UI。它复用 `acp-ui` 的核心对话能力，并增加一层很薄的
同源 WebSocket-to-stdio Bridge；OpenCode 仍然拥有 Session、历史、Agent 循环、Skill、
模型和工具。

运行平台为 macOS、Linux 或 WSL。原生 Windows 暂不支持，因为 Runtime/Session 删除
必须确认完整 POSIX 进程组停止后才能释放文件边界。

相关文档：

- [`UPSTREAM.md`](UPSTREAM.md)
- [`../../ontology-rag-demo/docs/agent-console/system-design.md`](../../ontology-rag-demo/docs/agent-console/system-design.md)
- [`../../ontology-rag-demo/docs/agent-console/protocols.md`](../../ontology-rag-demo/docs/agent-console/protocols.md)
- [`../../ontology-rag-demo/docs/agent-console/module-reference.md`](../../ontology-rag-demo/docs/agent-console/module-reference.md)
- [`../../ontology-rag-demo/docs/agent-console/development.md`](../../ontology-rag-demo/docs/agent-console/development.md)

## 运行模型

- Profile 是可分享的完整测试流，Dataset 是独立测试输入。
- Runtime 是一个已物化的 `Profile × Dataset` 项目，ID 为
  `<profile-id>--<dataset-id>`；左侧项目和 ACP 工作目录都以 Runtime 隔离。
- Session 属于该 Runtime 的 OpenCode。前端只保存展示投影，刷新后通过
  `session/list` 和 `session/load` 恢复。
- 每个已连接 Runtime 复用一条 WebSocket 和一个 `opencode acp` 进程；不同 Runtime
  可在后台并行，同一页面只显示一个当前会话。
- Session 持久删除使用
  `DELETE /runtimes/:runtimeId/sessions/:sessionId`；ACP 本身没有等价方法。
- Runtime 删除会先停止 Initializer 和 ACP 进程树，再经路径校验原子移入
  `.runtime/trash/`；不会修改源 Profile、Dataset 或其他 Runtime。
- 创建入口会热重载 Profile/Dataset Catalog，并过滤已存在的确定性组合；Runtime 标题
  来自创建时快照，不依赖当前源 Catalog。

这是 Web-only 应用，不包含桌面传输、浏览器端 Agent 设置、传输事件诊断页或前端
Session 数据库。Profile、Dataset、Prompt、Skill 与配置通过 Git 版本化复现，
`.runtime/` 是本机可重建产物。

## 本地验证

从仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm --filter ontology-agent-console typecheck
pnpm --filter ontology-agent-console test
pnpm --filter ontology-agent-console build
```

启动开发服务：

```bash
pnpm dev:agent-console
```

打开 `http://127.0.0.1:5173`。页面先选择 Profile 和 Dataset 创建 Runtime；
Bridge 默认监听 `127.0.0.1:4310`。

只读检查一个已经创建的 Runtime 的 ACP 接线：

```bash
pnpm --filter ontology-agent-console probe:acp -- \
  --runtime ontology-rag-demo/.runtime/projects/direct-context--smart-building
```

Probe 只执行 `initialize` 和 `session/list`，不会创建、加载、恢复、发送 Prompt 或修改
Session。构建后可执行 `pnpm --filter ontology-agent-console start`，并直接打开
`http://127.0.0.1:4310`。

默认 `ontology-retrieval` Profile 使用离线确定性向量用于流程冒烟。需要 BGE-M3 时，
在启动 Console 前设置 `EMBEDDING_BACKEND=bge-m3` 等环境变量；LanceDB 索引由 Runtime
Initializer 写入该 Runtime 自己的 `state/`，不再依赖 8010 常驻服务。
