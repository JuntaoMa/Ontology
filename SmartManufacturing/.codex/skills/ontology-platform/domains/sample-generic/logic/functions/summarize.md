# Function Logic

metadata_id:
- `summarize`

用途:
- 把条件评估结果整理成面向展示的摘要结构。

输入:
- `condition_assessment`

输出:
- `summary_report`

依赖:
- `assess(...)`

处理规则:
1. 读取 `condition_assessment` 中的命中结果、原因和关键字段。
2. 生成简短摘要，明确说明条件是否成立。
3. 返回 `summary_report`。

失败条件:
- `condition_assessment` 缺失
