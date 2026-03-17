# 本体问答系统总览

这个 skill 把本体系统看成“本体核心 + 运行时辅助层 + 逻辑层”的组合。

## 0. Domain 组织方式

这个 skill 采用 `domain pack` 组织方式。

每个 domain 都放在：
- `domains/<domain-id>/manifest.json`
- `domains/<domain-id>/ontology/`
- `domains/<domain-id>/runtime/`
- `domains/<domain-id>/logic/`

这意味着：
- 一个 domain 的语义资源、能力资源、运行时辅助信息和逻辑体在同一目录下统一管理
- agent 可以先发现 domain，再按 manifest 定位文件
- 新 domain 可以直接插拔，不需要改主入口结构

## 1. 语义面

语义面只描述：
- 有哪些 `Object`
- 有哪些 `Link`
- 每个对象的关键属性、标识字段和主要展示字段
- 对象之间的业务关系是什么

这一面回答的是：
- 数据世界里“有什么”
- 业务对象之间“怎么连”

这一面不负责：
- 业务计算和判断
- 业务流程编排
- 查询辅助路径定义

## 2. 能力面

能力面只描述：
- 有哪些 `Function`
- 有哪些 `Action`
- 它们的输入输出是什么
- 它们依赖哪些对象、关系和其他能力
- 它们负责什么、不负责什么

这一面回答的是：
- 系统“能做什么”
- 当前问题“是否有现成功能可以做”

这一面不负责：
- 承载完整逻辑体正文
- 代替真实运行时查询结果

## 3. 运行时辅助层

运行时辅助层单独管理 agent 使用本体时需要的查询和发现辅助资产，例如：
- `entrypoints.json`
- `path-templates.json`
- `capability-graph.json`

这一层回答的是：
- agent 应该先用哪些统一入口来读本体
- 从一个对象到另一个对象通常怎么查
- 从一个对象如何快速发现相关的 `Function` / `Action`

这一层不负责：
- 定义对象本身的语义
- 代替 function/action 元数据
- 代替逻辑体正文

## 4. 逻辑层

逻辑层单独管理 function/action 的具体逻辑体。

逻辑层放在每个 domain 内部，例如：
- `domains/<domain-id>/logic/functions/`
- `domains/<domain-id>/logic/actions/`

这一层回答的是：
- 一个 function 到底如何计算、归一化、汇总或判断
- 一个 action 到底如何控制流程、做分支、做循环、调用其他能力

## 5. 基本表达规则

为了保证所有推理都与本体对齐，统一使用以下表达：

- 属性：`Class.property`
- 路径：`Class -LINK-> Class`
- 函数调用：`func(arg1, arg2, ...)`
- 动作调用：`action(arg1, arg2, ...)`
- 绑定结果：`binding_name.field`

不要写：
- 模糊属性名
- 模糊函数名
- 省略中间对象的路径
- 纯自然语言式“差不多够”“大概是这个对象”

## 6. 本 skill 的角色

这个 skill 不是某个单独业务场景的实现体，而是本体系统的主入口规范。

它负责：
- 对问题分类
- 对 domain 做发现与选择
- 指导先看语义面还是能力面，再决定是否进入运行时辅助层或逻辑层
- 指导如何判断现有能力是否足够
- 指导如何在能力不足时补能力草案

它不负责：
- 直接定义所有业务函数
- 直接承载所有领域逻辑
- 绕开本体给出未经约束的业务结论
