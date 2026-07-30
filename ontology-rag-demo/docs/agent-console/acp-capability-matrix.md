# OpenCode ACP 能力矩阵

核验日期：2026-07-27
核验版本：OpenCode `1.17.16`
核验方式：向 `opencode acp` stdin 发送 NDJSON JSON-RPC；不输出现有会话正文

## 1. 已验证能力

| 能力 | 1.17.16 | 首版用途 |
| --- | --- | --- |
| stdio NDJSON | 支持 | ACP Bridge 的下游传输 |
| `initialize` | 支持 | 读取真实版本与能力 |
| `loadSession` capability | 支持 | UI 恢复历史 |
| `session/list` | 支持 | Agent 作为 Session Catalog 事实源 |
| `session/load` | 支持 | 重放消息、思考片段和工具调用 |
| `session/resume` | 支持 | 恢复会话运行上下文，不用于重建 UI 历史 |
| `session/close` | 支持 | 关闭当前 ACP 连接中的会话映射 |
| `session/fork` | 支持 | 首版不启用 |
| `session/prompt` | 支持 | 对话 |
| `session/cancel` | 支持 | 取消本轮执行 |
| Permission | 支持 | `session/request_permission` |
| Tool Call 原始输入输出 | 支持 | 命令、结果和 artifact 展示 |

`initialize` 返回的具体能力必须由 UI 动态读取，不得仅依据本表硬编码。内部版 OpenCode
可能与本机版本不同。

ACP `0.13.1` 没有持久 Session 删除方法。Console 的垃圾桶操作不是伪装成 ACP：
loopback Bridge 使用所属 Profile 的独立 `OPENCODE_DB` 执行
`opencode session delete <sessionID>`。Profile 级 maintenance lock 会先排除在途
ACP 请求和重连，再关闭空闲 ACP 进程并以有界子进程执行删除；UI 随后恢复原可见会话。

## 2. `load` 与 `resume`

- `session/load` 从 OpenCode 持久层读取历史，并把消息和 Tool Call 重新投影为 ACP
  `session/update`；UI 恢复历史必须使用它。
- `session/resume` 用于恢复 Agent 的模型、Mode 和运行上下文，不向客户端完整重放历史；
  不能替代 `session/load`。

只读核验确认 `session/load` 能重放以下关键事件类型：

- `user_message_chunk`；
- `agent_message_chunk`；
- `agent_thought_chunk`；
- `tool_call`；
- `tool_call_update`；
- `available_commands_update`。

## 3. 已知信息损失

OpenCode 原生历史比 ACP 投影更丰富。1.17.16 的 ACP Adapter：

- Tool Part 原生持久层包含 `time.start` 和 `time.end`，ACP Tool Call 映射未发送这些字段；
- 未投影部分 OpenCode 私有 Part，例如 step start/finish、snapshot、patch、retry、
  compaction、agent/subtask；
- 因此，重载后的 UI 无法恢复精确工具耗时，也不能宣称完整复刻 OpenCode 原生事件流。

首版处理：

- 在线调用耗时由 UI 根据当前收到的 Tool Call/Update 计时；
- 历史重放没有时间戳时明确显示 `Timing unavailable`；
- 实时成功回答可以显示浏览器当地完成时间和 `session/prompt` 客户端观测总耗时；
  历史重放不提供这两个字段，因此不显示回答完成页脚；
- 不在 ACP Bridge 中读取 OpenCode 私有数据库补齐事件；
- 如果未来必须无损展示，优先推动内部 OpenCode ACP Adapter 增加标准化字段。

## 4. Permission 行为

OpenCode 通过 `session/request_permission` 请求客户端选择 `once`、`always` 或 `reject`。
客户端若不实现该请求，OpenCode 会拒绝操作。当前测试 Profile 可以将 Bash 设置为允许，
但 UI 和探针仍必须正确响应其他 Permission 请求。

## 5. Profile 状态隔离

本机版本支持以下环境变量：

- `OPENCODE_DB`：指定独立的 OpenCode 数据库文件；
- `OPENCODE_CONFIG_DIR`：指定 Profile 配置目录；
- `OPENCODE_AUTH_CONTENT`：通过环境变量注入认证内容。

首版每个 Profile 至少设置不同的绝对 `OPENCODE_DB`，否则相同 cwd 下的
`session/list` 会混合多个 Profile 的会话。

`OPENCODE_CONFIG_DIR` 是配置覆盖层，不自动阻止项目级或全局配置加载。Profile 发布与
能力探针必须验证最终加载边界；不能把该变量误认为安全沙箱。缓存可以共享，但正式
Profile 的数据库、配置和 Skill 内容必须版本化。

## 6. 版本注意事项

本机安装版本是 `1.17.16`；开发时不能假设部署环境版本相同。Bridge 启动后记录
`initialize.agentInfo` 和 capability 名称，但不记录 Prompt、密钥或工具输出。

`opencode acp --port` 启动的是 ACP Adapter 内部使用的 OpenCode HTTP server；对 ACP
客户端暴露的稳定传输仍然是 stdin/stdout NDJSON，不代表浏览器可以直接连接该端口。

## 7. 参考源码

- [OpenCode 1.17.16 ACP 命令](https://github.com/anomalyco/opencode/blob/v1.17.16/packages/opencode/src/cli/cmd/acp.ts)
- [OpenCode 1.17.16 ACP Service](https://github.com/anomalyco/opencode/blob/v1.17.16/packages/opencode/src/acp/service.ts)
- [OpenCode 1.17.16 ACP Event 映射](https://github.com/anomalyco/opencode/blob/v1.17.16/packages/opencode/src/acp/event.ts)
- [OpenCode 1.17.16 Tool 映射](https://github.com/anomalyco/opencode/blob/v1.17.16/packages/opencode/src/acp/tool.ts)
- [OpenCode 1.17.16 Permission](https://github.com/anomalyco/opencode/blob/v1.17.16/packages/opencode/src/acp/permission.ts)
