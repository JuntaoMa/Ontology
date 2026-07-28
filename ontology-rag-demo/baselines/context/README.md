# Direct-context baseline

这条基线不调用 OAG、脚本、Skill 或任何其他工具。`prompt.md` 直接包含
`smart-building-sample` 的完整精简 TBox；Agent 只根据该上下文把用户问题转换为
`data-query-plan.v1` JSON，不查询实例数据，也不回答问题。

`opencode.jsonc` 固定选择 `deepseek/deepseek-v4-flash`，但不重复定义 provider、
API 地址或密钥。OpenCode 会按正常配置合并规则使用用户级配置和
`opencode auth login` 已保存的 DeepSeek 认证。若全局配置中没有名为
`deepseek/deepseek-v4-flash` 的可用模型，应先停止运行并由用户补充配置，不能静默
换用其他模型。

从 `ontology-rag-demo` 目录运行：

```bash
OPENCODE_CONFIG=baselines/context/opencode.jsonc \
  opencode run --agent ontology-direct-context \
  "温度传感器所在的房间属于哪个建筑？"
```

配置使用 OpenCode 的 `{file:./prompt.md}` 替换语法；文件内容会在启动时成为 Agent
prompt。它不是运行期的 `read` 或 Skill 调用，因此测试过程没有本体检索步骤。配置在
全局和 Agent 两层都将 `permission.*` 设为 `deny`，确保结果只来自用户问题和已内嵌
本体。
