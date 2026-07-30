# Raw data

本目录保留 Dataset 的原始来源材料。当前 Smart Building 示例本体是人工编写的最小
测试数据，因此没有额外的原始文件。

真实 Dataset 可在这里保留原始规范、映射表或预处理输入；Runtime 创建时会连同本体
一起复制快照，但 Profile 只有在自身 `dataset_contract` 允许时才应读取这些材料。
