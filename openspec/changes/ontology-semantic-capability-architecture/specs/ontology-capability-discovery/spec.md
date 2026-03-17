## ADDED Requirements

### Requirement: Domain shall expose a heterogeneous discovery view across semantic and capability resources
每个 domain SHALL 提供一套统一的发现视图，使 agent 可以从 `Object`、`Link`、`Function`、`Action` 中任一资源出发，发现其相关的依赖资源。

#### Scenario: 从业务对象发现相关能力
- **WHEN** agent 已经识别出某个业务问题锚定到一个 `Object`
- **THEN** 它应当能够通过发现视图定位读取该对象、修改该对象或以该对象为入口的 function/action，而不需要逐个扫描全部能力元数据

### Requirement: Capability discovery edges shall be derived from metadata declarations
统一发现视图中的能力依赖关系 SHALL 由 `functions.json` 与 `actions.json` 的依赖声明派生生成，而不是作为独立主编辑内容手工维护。

#### Scenario: Capability 依赖变更后更新发现视图
- **WHEN** 一个 function 或 action 的依赖声明发生变化
- **THEN** 发现视图中的相关依赖边必须依据最新元数据更新，以避免与元数据漂移

### Requirement: Query helpers shall remain outside ontology core
查询入口、路径模板和发现视图 SHALL 放在 `runtime/` 中，而不能与 `Object`、`Link`、`Function`、`Action` 混为同级本体核心资源。

#### Scenario: Runtime 与 ontology core 分层存放
- **WHEN** domain 提供统一入口或路径模板
- **THEN** 这些内容必须位于 `runtime/entrypoints.json`、`runtime/path-templates.json` 或同类运行时辅助文件中，而不能写入 `ontology/objects.json`、`ontology/links.json`、`ontology/functions.json` 或 `ontology/actions.json`
