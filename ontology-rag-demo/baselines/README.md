# Query-planning baselines

CLI 运行器用于模型、索引和语义预检；双基线的最终合格标准是通过 Agent Console
WebUI 分别创建 ACP Session 并实际完成同一问题。CLI 成功不能替代 WebUI 验收。

两条基线使用同一个问题、同一个模型
`deepseek/deepseek-v4-flash` 和同一个 `data-query-plan.v1` 输出结构，只改变
Agent 获得本体上下文的方式：

| Baseline | 本体上下文 | 工具调用 |
| --- | --- | --- |
| `oag` | Agent 关键词 → BGE-M3 Top 5 → 命中实体作为锚点 → Steiner 最小连通子图 | `ontology-retrieval` Skill + 本地 8010 OAG |
| `direct-context` | Agent prompt 内嵌完整的精简 YAML 测试本体 | 禁止全部工具 |

WebUI 中对应的 Profile ID 为 `baseline-oag` 和
`baseline-direct-context`。两者分别运行，不做同步广播或自动结果比较。

默认问题记录在 [questions.yaml](questions.yaml)：

```text
温度传感器所在的房间属于哪个建筑？
```

## 前置检查

Python 环境仍由项目级 uv 管理：

```bash
uv sync --locked
```

两条基线复用当前系统用户的 OpenCode 认证，不读取项目内的模型密钥，也不定义
provider。运行器会先确认下列模型存在；不存在时立即停止，不会切换到免费模型或其他
模型：

```bash
opencode models deepseek
```

目标模型必须包含：

```text
deepseek/deepseek-v4-flash
```

## CLI 预检

从 `ontology-rag-demo` 目录运行：

```bash
uv run --locked python baselines/run.py
```

第一次执行 OAG 基线会下载 `BAAI/bge-m3`，然后以严格的三行文本建立 LanceDB：

```text
{name}
{label}
{comment}
```

索引仅包含本体实体；不会写入示例文档，也不会为边或三元组生成向量。图结构只在
Top-5 命中成为锚点后参与最小连通子图计算。

运行器设置 `HF_HUB_DISABLE_XET=1`，使用 Hugging Face 标准 HTTP 下载。这可以避开
部分代理或安全网关下 Xet 分片长时间停在固定大小的问题，同时仍下载同一个官方模型。

可单独运行：

```bash
uv run --locked python baselines/run.py --baseline oag
uv run --locked python baselines/run.py --baseline direct-context
```

已有 BGE-M3 索引时：

```bash
uv run --locked python baselines/run.py --skip-index
```

Apple Silicon 可尝试 `--embedding-device mps`；首轮建议使用默认 `cpu`，减少算子兼容
差异。

每次运行把以下内容写入被 Git 忽略的
`artifacts/baselines/<UTC timestamp>/`：

- `manifest.json`：问题、模型、两条基线及结果摘要；
- `<baseline>/trace.jsonl`：OpenCode 原始事件流和工具调用；
- `<baseline>/result.json`：解析后的查询任务；
- `<baseline>/metadata.json`：Agent、耗时和退出码；
- `oag.log`：本地 OAG 服务日志。

运行器不会保存 OpenCode 认证文件或环境变量值。

## WebUI 验收

WebUI 验收必须同时满足：

1. 页面可选择两个基线 Profile，并分别创建 OpenCode ACP Session；
2. 对两个 Session 原样发送 `questions.yaml` 中的同一个问题；
3. OAG 基线页面显示完成的 Skill/Bash Tool 历史，最终输出的
   原始结果包含 5 条 `hits` 和 `graph`，并显示最小连通子图卡；最终消息包含
   `schema_version=data-query-plan.v1`、`baseline=oag`；
4. Direct-context 页面没有 Tool Call，最终输出同一协议且 `baseline` 为
   `direct-context`；
5. 断开连接后，两个 Profile 的 Session 都能通过页面重新列出和加载。

首版验收关注端到端接线，不自动评判查询计划正确性。Agent 自主产生的额外工具调用
必须在 UI 中如实记录；OAG Profile 不设置固定 `steps`，本机 Demo 开放 Bash。若必需
的 Skill、OAG wrapper 和最终计划已成功，额外的非关键调用不单独判为流程失败。
实时 Tool 卡有观测耗时；OpenCode `1.17.16` 的
`session/load` 不重放原生 Tool 时间戳，因此历史卡片显示 `Timing unavailable`。

注意：开放 Bash 后，“只经 OAG 获取本体”不能靠 Prompt 硬保证。若 WebUI 轨迹出现
直接读取 TTL、LanceDB 或实现文件，该 Session 只证明端到端接线成功，必须标记为
“基线语义污染”，不得用于两条路径的效果比较。严格隔离需要后续增加工具门控或进程
沙箱。

具体启动和浏览器验收步骤见
[Agent Console 开发与验证](../docs/agent-console/development.md)。
