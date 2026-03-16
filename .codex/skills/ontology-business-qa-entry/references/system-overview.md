# 本体问答系统总览

这个 skill 把本体系统看成三个分离但协作的层。

## 0. Domain 组织方式

这个 skill 采用 `domain pack` 组织方式。

每个 domain 都放在：
- `domains/<domain-id>/manifest.json`
- `domains/<domain-id>/schema/`
- `domains/<domain-id>/logic/`

这意味着：
- 一个 domain 的 schema 和 logic 在同一目录下统一管理
- agent 可以先发现 domain，再按 manifest 定位文件
- 新 domain 可以直接插拔，不需要改主入口结构

## 1. 数据模型层

数据模型层只描述：
- 有哪些点类型
- 有哪些边类型
- 每种点有哪些关键属性
- 哪些点和边可以作为查询入口

这一层回答的是：
- 数据世界里“有什么”
- 节点之间“怎么连”

这一层不负责：
- 业务计算
- 业务流程编排
- 新能力生成

## 2. 能力元数据层

能力元数据层只描述：
- 有哪些 `function`
- 有哪些 `action`
- 它们的输入输出是什么
- 它们适用于什么对象和业务目标

这一层回答的是：
- 系统“能做什么”
- 当前问题“是否有现成功能可以做”

这一层不负责：
- 表达具体逻辑体
- 代替真实执行

## 3. 逻辑层

逻辑层单独管理 function/action 的具体逻辑体。

逻辑层放在每个 domain 内部，例如：
- `domains/<domain-id>/logic/functions/`
- `domains/<domain-id>/logic/actions/`

这一层回答的是：
- 一个 function 到底如何计算
- 一个 action 到底如何控制流程、做判断、做循环、调用其他能力

## 4. 基本表达规则

为了保证所有推理都与本体对齐，统一使用以下表达：

- 属性：`Class.property`
- 边：`Class -EDGE-> Class`
- 函数调用：`func(arg1, arg2, ...)`
- 动作调用：`action(arg1, arg2, ...)`
- 绑定结果：`binding_name.field`

不要写：
- 模糊属性名
- 模糊函数名
- 省略中间对象的路径
- 纯自然语言式“差不多够”“大概是这个对象”

## 5. 本 skill 的角色

这个 skill 不是某个单独业务场景的实现体，而是本体系统的主入口规范。

它负责：
- 对问题分类
- 对 domain 做发现与选择
- 指导先看哪一层
- 指导如何判断现有能力是否足够
- 指导如何在能力不足时补能力草案

它不负责：
- 直接定义所有业务函数
- 直接承载所有领域逻辑
- 绕开本体给出未经约束的业务结论
