## ADDED Requirements

### Requirement: 系统必须提供通用的本体业务问答入口 skill
系统 MUST 提供一个通用入口 skill，用于处理本体约束下的业务问题，而不是只服务某一个固定业务场景。

#### Scenario: 从任意业务问题进入系统
- **WHEN** 用户提出一个需要基于本体数据、函数和动作回答的业务问题
- **THEN** 系统先进入通用入口 skill，再决定应该进入哪个 domain

### Requirement: 入口 skill 必须先做问题分类
系统 MUST 在读取具体 domain 之前，先将问题分类为 `查询类问题`、`已知业务流程类问题`、`能力缺口业务流程类问题` 或 `新能力定义类问题`。

#### Scenario: 判断设计变更第三批次物料可用周期问题
- **WHEN** 用户询问第三批次切换时的新物料可用周期
- **THEN** 系统将其识别为 `已知业务流程类问题`

#### Scenario: 判断设计变更第三批次旧物料报废成本问题
- **WHEN** 用户询问第三批次切换时的旧物料报废成本
- **THEN** 系统将其识别为 `能力缺口业务流程类问题`

### Requirement: 入口 skill 必须先发现 domain 再加载业务细节
系统 MUST 通过 domain 注册表发现可用业务域，并仅在选定 domain 后读取该 domain 的 manifest、schema 和 logic。

#### Scenario: 进入设计变更 domain
- **WHEN** 用户提出设计变更相关业务问题
- **THEN** 系统先发现 `design-change-material-readiness`，再读取其 manifest 和对应文件

### Requirement: 入口 skill 的统一入口必须使用格式化自然语言定义
系统 MUST 用格式化自然语言文本定义统一入口，而不是把主规范建立在脚本或数据库语法上。

#### Scenario: 查看统一入口
- **WHEN** agent 读取 `discover_domains()` 或 `draft_new_capability(...)` 的说明
- **THEN** 能直接看到用途、输入、输出和适用问题，而不是只看到代码接口

### Requirement: 入口 skill 输出必须采用简洁业务 agent 报告结构
系统 MUST 将最终处理结果收敛为简洁报告，至少包含 `分析结论`、`问题判断` 和 `逻辑流程` 三部分。

#### Scenario: 输出已知业务流程报告
- **WHEN** 系统完成第三批次物料可用周期分析
- **THEN** 输出精简业务 agent 报告，并在逻辑流程中说明用到的工具、目的和结果

#### Scenario: 输出能力缺口报告
- **WHEN** 系统完成第三批次旧物料报废成本分析
- **THEN** 输出精简业务 agent 报告，并明确指出缺失 capability 与新增 capability 草案
