## ADDED Requirements

### Requirement: Domain shall define Object as first-class semantic resources
每个 domain SHALL 使用 `Object` 作为业务语义对象的标准定义方式，而不是仅以底层图节点或混合 schema 结构表达对象信息。

#### Scenario: Object 使用最小语义字段定义
- **WHEN** 一个 domain 定义新的业务对象
- **THEN** 该对象必须在 `ontology/objects.json` 中声明 `id`、`name`、`summary`、`properties`、`identityFields` 和 `mainDisplayFields`

### Requirement: Domain shall define Link as first-class semantic resources
每个 domain SHALL 使用 `Link` 作为对象之间语义关系的标准定义方式，并将其与 `Object` 分开管理。

#### Scenario: Link 明确声明关系两端
- **WHEN** 一个 domain 定义新的对象关系
- **THEN** 该关系必须在 `ontology/links.json` 中声明 `id`、`name`、`summary`、`fromObject`、`toObject` 和 `cardinality`

### Requirement: Semantic resources shall be stored independently from runtime helpers
语义资源 SHALL 独立存放在 `ontology/` 目录中，不能与查询辅助信息或逻辑体混放。

#### Scenario: Domain 目录按语义资源拆分
- **WHEN** agent 读取一个 domain 的本体核心结构
- **THEN** 它应当能够通过 domain manifest 定位到 `ontology/objects.json` 与 `ontology/links.json`，并且这些文件不包含路径模板、统一入口或逻辑体内容
