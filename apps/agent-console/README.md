# Ontology Agent Console

一个面向本体 RAG 测试的 ACP Web UI。它复用 `acp-ui` 的核心对话能力，并增加一层很薄的
同源 WebSocket-to-stdio Bridge；OpenCode 仍然拥有 Session、历史、Agent 循环、Skill、
模型和工具。

相关文档：

- [`UPSTREAM.md`](UPSTREAM.md)
- [`../../ontology-rag-demo/docs/agent-console/system-design.md`](../../ontology-rag-demo/docs/agent-console/system-design.md)
- [`../../ontology-rag-demo/docs/agent-console/protocols.md`](../../ontology-rag-demo/docs/agent-console/protocols.md)
- [`../../ontology-rag-demo/docs/agent-console/module-reference.md`](../../ontology-rag-demo/docs/agent-console/module-reference.md)
- [`../../ontology-rag-demo/docs/agent-console/development.md`](../../ontology-rag-demo/docs/agent-console/development.md)

## 运行模型

- Profile 是服务端校验的固定测试方案配置；浏览器不能修改命令、cwd、模型或环境变量。
- Session 属于 OpenCode。前端只保存当前页面的展示投影，刷新后通过
  `session/list` 和 `session/load` 恢复。
- 每个已连接 Profile 复用一条 WebSocket 和一个 `opencode acp` 进程；不同 Profile
  可以并行执行，同一 Profile 的 Prompt 首版串行。
- 单页只显示一个对话窗口；切换可见 Session 不会停止其他 Profile 的后台执行。
- 持久删除通过窄幅 OpenCode 扩展接口完成：
  `DELETE /agents/:profileId/sessions/:sessionId`。ACP 本身没有持久 Session 删除方法。

这是 Web-only 应用，不包含桌面传输、浏览器端 Agent 设置、传输事件诊断页或前端
Session 数据库。Profile、Prompt、Skill 与配置通过 Git 版本化复现。

## 本地验证

从仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm --filter ontology-agent-console typecheck
pnpm --filter ontology-agent-console test
pnpm --filter ontology-agent-console build
```

只读检查一个 Profile 的 ACP 接线：

```bash
pnpm --filter ontology-agent-console probe:acp -- \
  --profile ontology-rag-demo/profiles/baseline-direct-context/profile.yaml
```

Probe 只执行 `initialize` 和 `session/list`，不会创建、加载、恢复、发送 Prompt 或修改
Session。

构建后启动：

```bash
OAG_BASE_URL=http://127.0.0.1:8010 \
  pnpm --filter ontology-agent-console start
```

打开 `http://127.0.0.1:4310`。`baseline-direct-context` 不依赖 8010；
`baseline-oag` 需要先按
[`development.md`](../../ontology-rag-demo/docs/agent-console/development.md)
启动 BGE-M3/LanceDB OAG 服务。WebUI 实际创建、运行、切换、恢复和删除 Session 是最终
验收标准，Probe 只用于启动前 smoke check。
