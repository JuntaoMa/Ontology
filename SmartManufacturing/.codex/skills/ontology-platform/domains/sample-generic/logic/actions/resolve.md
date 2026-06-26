# Action Logic

metadata_id:
- `resolve`

用途:
- 围绕一个样例对象读取关联上下文和事件，并生成摘要报告。

输入:
- `SampleObject.id`

输出:
- `SampleReport`

调用能力:
- `query_instances_by_type(...)`
- `query_instances_by_path(...)`
- `normalize(...)`
- `assess(...)`
- `summarize(...)`

执行逻辑:
1. 先读取目标 `SampleObject`。
2. 再通过路径模板读取关联的 `SampleContext` 和 `SampleEvent`。
3. 调用 `normalize(...)` 生成统一上下文。
4. 调用 `assess(...)` 生成条件评估结果。
5. 调用 `summarize(...)` 生成最终摘要。
6. 返回 `SampleReport`。

中止条件:
- `SampleObject.id` 不存在
- 找不到关联上下文
- 找不到关联事件
