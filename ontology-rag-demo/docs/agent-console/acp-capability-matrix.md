# OpenCode ACP 能力矩阵

核验日期：2026-07-27

核验版本：OpenCode `1.17.16`

核验方式：向 `opencode acp` stdin 发送 NDJSON JSON-RPC；不输出已有 Session 正文

## 1. 已验证能力

| 能力 | 1.17.16 | Console 用途 |
| --- | --- | --- |
| stdio NDJSON | 支持 | Bridge 的下游传输 |
| `initialize` | 支持 | 协议、Agent 信息与能力协商 |
| `session/list` | 支持 | OpenCode Session Catalog |
| `session/new` | 支持 | 新建对话 |
| `session/load` | 支持 | 重放持久历史 |
| `session/resume` | 支持 | 恢复 Agent 运行上下文；UI 不用它重建历史 |
| `session/close` | 支持 | 关闭当前 ACP 连接中的映射 |
| `session/fork` | 支持 | 首版 UI 不启用 |
| `session/prompt` | 支持 | 对话 |
| `session/cancel` | 支持 | 取消当前轮 |
| Permission | 支持 | `session/request_permission` |
| Tool 原始输入输出 | 支持 | Input、Output 与 artifact 展示 |

`initialize` 返回的能力由 UI 动态读取，不能仅按本表硬编码。内部 OpenCode 版本可能与
本机不同。

## 2. `load`、`resume` 与历史

- `session/load` 从 OpenCode 持久层读取历史，并把内容重新投影为
  `session/update`；UI 恢复对话必须使用它。
- `session/resume` 恢复模型、Mode 和运行上下文，但不会向客户端完整重放历史，不能
  替代 `session/load`。

只读核验确认 `session/load` 可重放：

- `user_message_chunk`；
- `agent_message_chunk`；
- `agent_thought_chunk`；
- `plan`；
- `tool_call`；
- `tool_call_update`；
- `available_commands_update`。

OpenCode 原生历史比 ACP 投影更丰富。1.17.16 的 Adapter 没有投影 Tool Part 的原生
开始/结束时间，也未投影部分私有 Part（如 step、snapshot、patch、retry、compaction
和 subtask）。因此：

- 在线 Tool 与整轮耗时只是浏览器观察值；
- 历史重放不能恢复精确 Tool 耗时；
- 历史回答不显示伪造的完成时间或全轮耗时；
- Bridge 不读取 OpenCode 私有数据库补齐事件。

## 3. Permission 与请求生命周期

OpenCode 通过 `session/request_permission` 提供 `once`、`always` 或 `reject` 等选项。
客户端若不回应，Agent 操作不能继续。

当前浏览器 ACP 适配器显式管理待处理 JSON-RPC：

- 普通请求有界超时；
- `session/prompt` 不使用普通短超时，依靠 Cancel 或连接关闭终止；
- WebSocket 关闭时拒绝全部待处理请求并取消 Permission；
- 首版同一 Profile 同时只运行一轮 Prompt，避免单连接 Permission 归属冲突。

## 4. Profile 状态隔离

本机 OpenCode 支持：

- `OPENCODE_DB`：指定 Session 数据库；
- `OPENCODE_CONFIG_DIR`：指定配置 overlay；
- `OPENCODE_AUTH_CONTENT`：通过环境变量注入认证内容。

Console 不要求 Profile 手写这些路径。服务端为 Profile `<id>` 派生：

```text
ontology-rag-demo/.runtime/opencode/<id>/
├── opencode.db
└── config/
```

每次启动前，Bridge 将 Git 中的 `opencode.jsonc` 和显式资产同步到 `config/`，并保留
OpenCode 自己的 dependency bootstrap 文件。不同 Profile 使用不同 `OPENCODE_DB`，
否则同一 cwd 下的 `session/list` 会混合会话。

`OPENCODE_CONFIG_DIR` 是覆盖层，不是阻止全局或项目配置加载的安全沙箱。Profile、
Prompt、Skill 与配置通过 Git 版本化；运行目录被忽略。

## 5. 连接与删除

- 稳定的浏览器入口是 Bridge 的 `WS /agents/:profileId/acp`。
- `opencode acp --port` 的端口属于 Adapter 内部 OpenCode HTTP server，不是浏览器
  ACP 服务端口。
- 一条 WebSocket 对应一个 `opencode acp` 进程；断线后终止进程，下次连接通过
  `session/list`/`session/load` 恢复。
- ACP `0.13.1` 没有持久 Session 删除方法。Console 的垃圾桶使用明确的 OpenCode
  扩展端点，由 Bridge 在所属 Profile 状态中执行
  `opencode session delete <sessionId> --pure`，不伪装成 ACP 方法。

Profile Probe 只执行 `initialize` 和 `session/list`，用于检查实际 Profile 命令、
overlay、环境和能力，不创建或修改 Session。

## 6. 参考源码

- [OpenCode 1.17.16 ACP 命令](https://github.com/anomalyco/opencode/blob/v1.17.16/packages/opencode/src/cli/cmd/acp.ts)
- [OpenCode 1.17.16 ACP Service](https://github.com/anomalyco/opencode/blob/v1.17.16/packages/opencode/src/acp/service.ts)
- [OpenCode 1.17.16 ACP Event 映射](https://github.com/anomalyco/opencode/blob/v1.17.16/packages/opencode/src/acp/event.ts)
- [OpenCode 1.17.16 Tool 映射](https://github.com/anomalyco/opencode/blob/v1.17.16/packages/opencode/src/acp/tool.ts)
- [OpenCode 1.17.16 Permission](https://github.com/anomalyco/opencode/blob/v1.17.16/packages/opencode/src/acp/permission.ts)
