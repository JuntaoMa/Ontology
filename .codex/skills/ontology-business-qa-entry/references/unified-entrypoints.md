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
- schema 文件位置
- logic 文件位置
- domain 简述

适用问题：
- 已经选中 domain，准备读取该 domain 具体内容

## 4. `get_data_model_detail(domain_id, model_id)`

用途：
- 获取某个 domain 内节点类型或边类型的详细信息

输入：
- `domain_id`
- `model_id`

返回：
- 类型说明
- 关键属性
- 可连接的边
- 常见查询入口

适用问题：
- 查询类问题
- 需要对齐对象和属性

## 5. `get_capability_metadata(domain_id, capability_id)`

用途：
- 获取某个 function 或 action 的元数据信息

输入：
- `domain_id`
- `capability_id`

返回：
- 类型：function 或 action
- 输入
- 输出
- 适用场景
- 逻辑层位置

适用问题：
- 判断现有能力是否够用
- 准备做流程编排

## 6. `get_path_templates(domain_id, start_type, target_type_or_goal)`

用途：
- 获取从某类对象出发到目标对象或目标事实的推荐路径模板

输入：
- `domain_id`
- `start_type`
- `target_type_or_goal`

返回：
- 关系路径模板
- 字段绑定模板
- 适用条件

适用问题：
- 查询类问题
- 已知业务流程类问题中的数据读取阶段

## 7. `query_instances_by_type(domain_id, node_type, filters)`

用途：
- 在某个 domain 内按节点类型和过滤条件读取实例数据

输入：
- `domain_id`
- `node_type`
- `filters`

返回：
- 匹配实例集合
- 关键字段绑定

适用问题：
- 查询类问题
- 已知业务流程类问题中的直接实例读取阶段

## 8. `query_instances_by_path(domain_id, anchor_binding, path_template_id, filters)`

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

## 9. `assess_problem_capability_fit(domain_id, problem_statement)`

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

## 10. `draft_new_capability(domain_id, problem_statement)`

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
