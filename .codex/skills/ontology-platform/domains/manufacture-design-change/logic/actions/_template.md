# Action Logic Template

metadata_id:
- `<action-id>`

用途:
- `<这个 action 负责什么>`

输入:
- `<Class.property or bound_value>`

输出:
- `<output_name>`

调用能力:
- `query_instances_by_type(...)`
- `query_instances_by_path(...)`
- `func(...)`
- `action(...)`

执行逻辑:
1. 先说明要读取哪些对象和关系。
2. 再说明如何调用 function/action 完成编排。
3. 如果存在循环、汇总或分支，需要明确写出触发条件。
4. 最后说明如何返回结果。

中止条件:
- `<failure-case>`
