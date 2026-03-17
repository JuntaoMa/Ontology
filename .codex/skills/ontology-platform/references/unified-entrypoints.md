# 统一入口

这些入口不是具体代码接口，而是本 skill 要先采用的统一操作语义。

## 1. `get_ontology_overview()`

用途：
- 获取当前本体系统总览

返回：
- domain 注册表位置
- 主入口参考文档位置
- domain pack 的组织规则

适用问题：
- 刚进入系统
- 不确定从哪层开始看

## 2. `discover_domains()`

用途：
- 发现当前 skill 中可用的 domain pack

返回：
- domain 列表
- 每个 domain 的简述
- 每个 domain 的 manifest 路径

适用问题：
- 刚进入系统
- 不确定问题属于哪个 domain

## 3. `get_domain_manifest(domain_id)`

用途：
- 获取某个 domain 的 manifest

输入：
- `domain_id`

返回：
- ontology 文件位置
- runtime 文件位置
- logic 文件位置
- domain 简述

适用问题：
- 已经选中 domain，准备读取该 domain 具体内容

## 4. `get_object_catalog(domain_id)`

用途：
- 获取某个 domain 中全部 `Object` 的目录

输入：
- `domain_id`

返回：
- `Object` 列表
- 每个 `Object` 的简述
- 标识字段和主要展示字段

适用问题：
- 查询类问题
- 需要先识别可能相关的对象

## 5. `get_link_catalog(domain_id)`

用途：
- 获取某个 domain 中全部 `Link` 的目录

输入：
- `domain_id`

返回：
- `Link` 列表
- 每个 `Link` 的起点和终点对象
- 每个 `Link` 的简述

适用问题：
- 查询类问题
- 已知业务流程类问题中的关系探索阶段

## 6. `get_object_detail(domain_id, object_id)`

用途：
- 获取某个 `Object` 的详细定义

输入：
- `domain_id`
- `object_id`

返回：
- 类型说明
- 关键属性
- 标识字段
- 主要展示字段
- 与之直接相连的 `Link`

适用问题：
- 查询类问题
- 需要对齐对象与属性

## 7. `get_link_detail(domain_id, link_id)`

用途：
- 获取某个 `Link` 的详细定义

输入：
- `domain_id`
- `link_id`

返回：
- 关系说明
- 起点对象
- 终点对象
- 基数

适用问题：
- 查询类问题
- 需要补全对象间路径时

## 8. `get_function_catalog(domain_id)`

用途：
- 获取某个 domain 中全部 `Function` 的目录

输入：
- `domain_id`

返回：
- `Function` 列表
- 每个 `Function` 的简述
- 每个 `Function` 的主要依赖对象

适用问题：
- 已知业务流程类问题
- 能力发现阶段

## 9. `get_action_catalog(domain_id)`

用途：
- 获取某个 domain 中全部 `Action` 的目录

输入：
- `domain_id`

返回：
- `Action` 列表
- 每个 `Action` 的简述
- 每个 `Action` 的入口对象

适用问题：
- 已知业务流程类问题
- 能力发现阶段

## 10. `get_function_detail(domain_id, function_id)`

用途：
- 获取某个 `Function` 的元数据信息

输入：
- `domain_id`
- `function_id`

返回：
- 输入
- 输出
- 能力边界
- 依赖对象和关系
- 逻辑层位置

适用问题：
- 判断现有能力是否够用
- 准备做流程编排

## 11. `get_action_detail(domain_id, action_id)`

用途：
- 获取某个 `Action` 的元数据信息

输入：
- `domain_id`
- `action_id`

返回：
- 输入
- 输出
- 能力边界
- 入口对象
- 依赖对象、关系和其他能力
- 逻辑层位置

适用问题：
- 判断现有能力是否够用
- 准备做流程编排

## 12. `get_capability_graph(domain_id, anchor_resource_id)`

用途：
- 获取某个 domain 的异构发现图，或围绕某个对象/能力的局部发现视图

输入：
- `domain_id`
- `anchor_resource_id`（可选）

返回：
- 相关 `Object`
- 相关 `Link`
- 相关 `Function`
- 相关 `Action`
- 资源之间的依赖边

适用问题：
- 需要从对象快速发现能力
- 需要从 action 回看依赖对象和函数

## 13. `get_path_templates(domain_id, start_object, target_object_or_goal)`

用途：
- 获取从某类 `Object` 出发到目标对象或目标事实的推荐路径模板

输入：
- `domain_id`
- `start_object`
- `target_object_or_goal`

返回：
- 关系路径模板
- 字段绑定模板
- 适用条件

适用问题：
- 查询类问题
- 已知业务流程类问题中的数据读取阶段

## 14. `query_instances_by_type(domain_id, object_type, filters)`

用途：
- 在某个 domain 内按对象类型和过滤条件读取实例数据

输入：
- `domain_id`
- `object_type`
- `filters`

返回：
- 匹配实例集合
- 关键字段绑定

适用问题：
- 查询类问题
- 已知业务流程类问题中的直接实例读取阶段

## 15. `query_instances_by_path(domain_id, anchor_binding, path_template_id, filters)`

用途：
- 在某个 domain 内根据路径模板读取实例数据

输入：
- `domain_id`
- `anchor_binding`
- `path_template_id`
- `filters`

返回：
- 按路径读取到的实例集合
- 中间路径绑定
- 证据路径

适用问题：
- 查询类问题
- 已知业务流程类问题中的关系扩展阶段

## 16. `assess_problem_capability_fit(domain_id, problem_statement)`

用途：
- 判断一个业务问题能否被当前 function/action 覆盖

输入：
- `domain_id`
- `problem_statement`

返回：
- 问题拆解
- 已匹配能力
- 缺失能力
- 建议进入的处理模式

适用问题：
- 所有业务流程类问题

## 17. `draft_new_capability(domain_id, problem_statement)`

用途：
- 为缺失的 function/action 生成规范化草案

输入：
- `domain_id`
- `problem_statement`

返回：
- `FunctionSpec` 或 `ActionSpec` 草案
- 逻辑体模板入口
- 待复核项

适用问题：
- 能力缺口业务流程类问题
- 新能力定义类问题
