# Function Logic Template

metadata_id:
- `<function-id>`

输入:
- `<Class.property or bound_value>`

输出:
- `<output_name>`

前置约束:
- `<constraint>`

逻辑体:
1. 设 `<var>` = `<expression>`
2. 如果 `<condition>`
   则
   - `<statement>`
3. 否则如果 `<condition>`
   则
   - `<statement>`
4. 否则
   - `<statement>`
5. 返回 `<output_name>`

失败条件:
- `<failure-case>`
