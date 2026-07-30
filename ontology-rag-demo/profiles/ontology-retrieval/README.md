# 检索增强本体上下文

该 Profile 在 Runtime 初始化时为 Dataset 本体中的实体构建 LanceDB 索引。Agent 自主
提取关键词并通过随 Profile 打包的 Skill 调用本地检索脚本，得到实体 Top-K 和这些
锚点的近似 Steiner 连通子图，再生成数据查询计划。

默认使用无需下载模型的 `deterministic` backend 便于打通流程。质量测试时，在创建
Runtime 前设置：

```bash
export EMBEDDING_BACKEND=bge-m3
export EMBEDDING_MODEL=BAAI/bge-m3
export EMBEDDING_DEVICE=cpu
```

Initializer 会把实际 backend、模型名、向量维度和本体摘要记录在 Runtime 的
`state/retrieval/metadata.json`。查询阶段的 backend、模型、max length 和 normalize
以该元数据为准；`EMBEDDING_DEVICE` 与 `EMBEDDING_BATCH_SIZE` 仍是每次执行的运行参数。

索引和图只覆盖具名 Class/Property 以及 URI 之间的 `subClassOf`、`subPropertyOf`、
domain、range、equivalent/inverse 和对象属性 domain-range 连接；不会展开 blank-node
Restriction 或 OWL class expression。当前元数据未锁定 Hugging Face revision，质量
试验应使用受控模型缓存或不可变本地模型快照。

`graph_algorithm: minimum_connected_subgraph` 是测试流的概念名称；当前实际实现固定为
NetworkX `approximation.steiner_tree(method="mehlhorn")`，属于近似算法而非精确最小
Steiner tree。实现标识会写入索引元数据和检索返回。
