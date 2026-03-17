# Function Logic

metadata_id:
- `assess`

用途:
- 根据归一化上下文与样例事件判断某个显式条件是否成立。

输入:
- `normalized_context`
- `SampleEvent.eventType`
- `SampleEvent.createdAt`

输出:
- `condition_assessment`

依赖:
- `SampleEvent`
- `normalize(...)`

处理规则:
1. 读取 `normalized_context` 中的优先级和对象状态。
2. 如果 `SampleEvent.eventType` 与当前上下文类别匹配，则标记条件命中。
3. 如果事件不匹配，则返回未命中结果，并保留原因说明。
4. 返回 `condition_assessment`。

失败条件:
- `normalized_context` 缺失
- `SampleEvent` 缺失
