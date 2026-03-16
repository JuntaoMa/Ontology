# Action Logic Template

metadata_id:
- `<action-id>`

输入:
- `<Class.property or bound_value>`

输出:
- `<output_name>`

调用能力:
- `query(...)`
- `func(...)`
- `action(...)`

逻辑体:
1. 查询 `<query_call>` 作为 `<binding>`
2. 断言 `<binding>` 存在
3. 调用 `<func_call>` 作为 `<binding>`
4. 如果 `<condition>`
   则
   - `<statement>`
5. 对 `<collection>` 中的每个 `<item>` 执行
   - 调用 `<func_or_action_call>`
   - 将 `<result>` 追加到 `<collection_name>`
6. 返回 `<output_name>`

失败条件:
- `<failure-case>`
