# Function Logic

metadata_id:
- `normalize`

用途:
- 将 `SampleObject` 与 `SampleContext` 整理成统一上下文，供后续条件评估使用。

输入:
- `SampleObject.id`
- `SampleObject.name`
- `SampleObject.status`
- `SampleContext.category`
- `SampleContext.priority`

输出:
- `normalized_context`

依赖:
- `SampleObject`
- `SampleContext`

处理规则:
1. 读取 `SampleObject` 与 `SampleContext` 的关键字段。
2. 将对象身份、对象状态、上下文类别和优先级整理到统一结构中。
3. 返回 `normalized_context`，不直接做业务判断。

失败条件:
- `SampleObject` 缺失
- `SampleContext` 缺失
