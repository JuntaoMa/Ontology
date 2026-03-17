# 逻辑层格式

逻辑层不放在 ontology JSON 中，而放在每个 domain 自己的目录中管理：
- `domains/<domain-id>/logic/functions/`
- `domains/<domain-id>/logic/actions/`

`Function` / `Action` 的 metadata 只保留元数据信息。具体逻辑统一在当前 domain 的逻辑层文件里表达。

## 1. Function 逻辑体

一个 function 逻辑文件至少包含：
- 对应的 metadata id
- 输入
- 输出
- 依赖
- 处理规则
- 失败条件

逻辑体建议使用严谨、无歧义的结构化中文。它不需要强制压缩成固定 DSL，但必须满足：
- 输入来源清楚
- 输出结果清楚
- 依赖对象、关系和能力清楚
- 判断条件清楚
- 汇总和返回规则清楚

## 2. Action 逻辑体

一个 action 逻辑文件至少包含：
- 对应的 metadata id
- 输入
- 输出
- 调用能力
- 执行逻辑
- 失败与中止条件

逻辑体建议使用结构化中文，允许自然的步骤表达、判断、循环和汇总，但必须保持严谨和无歧义。

## 3. 统一语法要求

- 属性必须写成 `Class.property`
- 路径必须写成 `Class -LINK-> Class`
- 函数必须写成 `func(arg1, arg2, ...)`
- 动作必须写成 `action(arg1, arg2, ...)`
- 不允许使用模糊变量名、模糊依赖或模糊条件

## 4. 推荐结构

一个合格的逻辑体通常可以使用这样的结构：

- `用途`
- `输入`
- `输出`
- `依赖`
- `处理规则`
- `失败条件`

如果是 action，还可以加入：

- `调用能力`
- `执行逻辑`
- `中止条件`

## 5. 正反例

正例：

```text
如果 InventoryLot.availableQty 足以覆盖当前需求，则该制造件的准备周期为 0。
否则，如果 PurchaseOrder.promisedAt 已知，则准备周期为 Context.now 到 PurchaseOrder.promisedAt 的时长。
否则，准备周期按 MPart.procurementLeadHours 与 MPart.certificationLeadHours 的总和计算。
```

正例：

```text
上层装配件的准备周期，取其所有直接下级件准备完成时间中的最大值，再加上 MPart.assemblyLeadHours。
```

反例：

```text
如果库存差不多够，就直接用。
```

反例：

```text
看一下这个物料的一些属性，然后调用那个周期函数。
```

## 6. 当前阶段的定位

当前快速版中，逻辑层可以先写成格式化自然语言，不要求先编译成代码。
但是逻辑层必须满足：
- 能读
- 能审
- 能映射到本体元素
- 能区分查询、计算和编排
