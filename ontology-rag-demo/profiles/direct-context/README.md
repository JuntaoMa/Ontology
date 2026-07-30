# 具名本体上下文

该 Profile 在 Runtime 初始化阶段读取 Dataset 本体快照，把具名 Class/Property 及其
label、comment、URI `subClassOf`、domain、range 投影成精简 YAML，并将该投影完整注入
OpenCode Agent Prompt。它不绑定任何 Dataset，也不读取实例数据。

该轻量投影不展开 blank-node `owl:Restriction`、intersection/union 等复杂 OWL 公理；
包含这些结构的 Dataset 可以初始化，但本 Profile 不应被描述为完整 OWL 语义展开。

初始化产物位于 Runtime 的 `workspace/generated/`；源 Profile 不会被修改。
