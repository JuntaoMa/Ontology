## ADDED Requirements

### Requirement: Function and Action logic shall be stored outside capability metadata
每个 domain 的 function/action 具体逻辑 SHALL 独立存放在 `logic/` 目录中，能力元数据只保留标识、边界、依赖和逻辑定位信息。

#### Scenario: 元数据不直接承载完整逻辑体
- **WHEN** agent 读取 `ontology/functions.json` 或 `ontology/actions.json`
- **THEN** 它应当只能看到能力元数据和 `logicRef`，而不能在元数据文件中直接读取完整逻辑体正文

### Requirement: Logic bodies shall use rigorous and unambiguous structured natural language
function/action 的逻辑体 SHALL 使用结构化自然语言表达，并且必须保持严谨、无歧义、可审查。

#### Scenario: 逻辑体显式引用本体元素和能力调用
- **WHEN** 一个逻辑体引用对象属性、关系路径、函数调用或动作调用
- **THEN** 它必须使用显式引用形式，例如 `Class.property`、`Class -LINK-> Class`、`func(arg1, arg2, ...)` 和 `action(arg1, arg2, ...)`

#### Scenario: 逻辑体避免模糊描述
- **WHEN** 一个逻辑体描述判断条件、依赖对象或输出结论
- **THEN** 它不能使用“差不多够”“一些属性”“调用那个函数”这类模糊表述，而必须明确说明条件、依赖和结果

### Requirement: The skill shall provide positive and negative examples for logic authoring
主入口 skill SHALL 提供结构化自然语言逻辑体的正反例，以约束 agent 生成的逻辑文本。

#### Scenario: Skill 提供逻辑表达示例
- **WHEN** agent 需要新建或改写 function/action 逻辑体
- **THEN** skill 参考文档必须提供至少一组合格示例和一组合格性不足的反例，用于指导生成和审查
