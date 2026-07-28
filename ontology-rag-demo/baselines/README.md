# Query-planning baselines

两条基线使用同一个问题、同一个模型
`deepseek/deepseek-v4-flash` 和同一个 `data-query-plan.v1` 输出结构，只改变
Agent 获得本体上下文的方式：

| Baseline | 本体上下文 | 工具调用 |
| --- | --- | --- |
| `oag` | Agent 关键词 → BGE-M3 Top 5 → 命中实体作为锚点 → Steiner 最小连通子图 | `ontology-retrieval` Skill + 本地 8010 OAG |
| `direct-context` | Agent prompt 内嵌完整的精简 YAML 测试本体 | 禁止全部工具 |

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

## 完整运行

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
